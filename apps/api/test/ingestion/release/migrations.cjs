const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { Client } = require('pg');
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const files = [
  '004_pipeline_delivery',
  '005_index_generations',
  '006_document_parse_tasks',
  '007_generation_retention',
  '008_parse_checkpoints',
  '009_index_build_progress',
  '010_index_upgrades',
];
async function pgMigrations(env) {
  const database = 'release_migration';
  await env.source.query('CREATE DATABASE ' + database);
  const url = new URL(env.databaseUrl);
  url.pathname = '/' + database;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const psql = (...args) =>
    env.compose(
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'delivery_test',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      ...args,
    );
  const id = randomUUID(),
    content = randomUUID();
  try {
    await psql(
      '-f',
      '/schema/init/001_document_schema.sql',
      ...files
        .slice(0, 2)
        .flatMap((f) => ['-f', '/schema/migrations/' + f + '.sql']),
    );
    await client.query(
      `INSERT INTO kh_document(id,title,file_name,mime_type,storage_key,content_id,uploader_id,status,parse_status) VALUES($1,'legacy sentinel','legacy.txt','text/plain','original/migration-sentinel',$2,'legacy-user','PUBLISHED','READY')`,
      [id, content],
    );
    const before = (
      await client.query('SELECT * FROM kh_document WHERE id=$1', [id])
    ).rows;
    const apply = () =>
      psql(
        '-f',
        '/schema/migrations/002_add_parse_error.sql',
        '-f',
        '/schema/migrations/003_add_users.sql',
        ...files.flatMap((f) => ['-f', '/schema/migrations/' + f + '.sql']),
      );
    await apply();
    const catalog = async () => ({
      columns: (
        await client.query(
          "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
        )
      ).rows,
      indexes: (
        await client.query(
          "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
        )
      ).rows,
      constraints: (
        await client.query(
          "SELECT conrelid::regclass::text AS relation,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY relation,conname",
        )
      ).rows,
    });
    const first = await catalog();
    await apply();
    assert.deepEqual(await catalog(), first);
    assert.deepEqual(
      (await client.query('SELECT * FROM kh_document WHERE id=$1', [id])).rows,
      before,
    );
    assert.equal(
      (await client.query('SELECT count(*)::int n FROM kh_pipeline_outbox'))
        .rows[0].n,
      0,
    );
    return {
      base: '001 + 004/005',
      applied: '002–010 twice',
      legacyRowUnchanged: true,
      noOutboxCreated: true,
      catalogSha256: digest(first),
      tables: [...new Set(first.columns.map((c) => c.table_name))],
    };
  } finally {
    await client.end();
    await env.source.query('DROP DATABASE ' + database);
  }
}
async function mongoMigrations(env) {
  const db = env.mongo.db('knowbase');
  const body = {
    documentId: randomUUID(),
    contentId: randomUUID(),
    version: 1,
    markdown: '# Legacy evidence\n\nLimit is 731.',
  };
  await db.collection('document_content').insertOne(body);
  // Reproduce pre-fix index names while retaining a real saved body.
  await db
    .collection('document_content')
    .createIndex({ content_id: 1 }, { unique: true });
  await db
    .collection('document_content')
    .createIndex({ document_id: 1, version: 1 });
  const apply = () =>
    env.compose(
      'exec',
      '-T',
      'mongo',
      'mongosh',
      '--quiet',
      '--file',
      '/schema/migrations/002_fix_document_content_indexes.js',
      '--file',
      '/schema/migrations/003_ingestion_indexes.js',
      '--file',
      '/schema/migrations/004_document_evidence.js',
    );
  const indexes = async () => {
    const result = {};
    for (const name of [
      'document_content',
      'document_evidence',
      'document_assets',
      'ingestion_chunks',
      'ingestion_embeddings',
    ])
      result[name] = (await db.collection(name).indexes()).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    return result;
  };
  await apply();
  const first = await indexes();
  await apply();
  assert.deepEqual(await indexes(), first);
  assert.deepEqual(
    await db
      .collection('document_content')
      .findOne({ contentId: body.contentId }),
    body,
  );
  await assert.rejects(
    () =>
      db.collection('document_content').insertOne({ ...body, _id: undefined }),
    (e) => e.code === 11000,
  );
  for (const [collection, record] of [
    [
      'document_evidence',
      { contentId: 'candidate', documentId: 'doc', id: 'fact', ordinal: 0 },
    ],
    ['document_assets', { objectKey: 'asset', documentId: 'doc' }],
    ['ingestion_chunks', { key: 'key', index: 0, documentId: 'doc' }],
    ['ingestion_embeddings', { key: 'vector', documentId: 'doc' }],
  ]) {
    const target = db.collection(collection);
    await target.insertOne(record);
    await assert.rejects(
      () => target.insertOne({ ...record, _id: undefined }),
      (e) => e.code === 11000,
    );
    await target.deleteMany({});
  }
  const ttl = first.ingestion_embeddings.find((i) => i.name === 'expiresAt_1');
  assert.equal(ttl.expireAfterSeconds, 0);
  return {
    applied: '002/003/004 twice using unmodified mongosh scripts',
    legacyBodyUnchanged: true,
    uniquenessRejectedDuplicates: 5,
    ttlSeconds: 0,
    indexes: first,
  };
}
module.exports = { pgMigrations, mongoMigrations };
