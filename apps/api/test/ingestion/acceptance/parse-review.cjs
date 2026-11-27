const assert = require('node:assert/strict');
const { eventually } = require('./environment.cjs');
const { digest, normalize } = require('./values.cjs');
async function parseAndReview(actors, fixture) {
  const { owner, admin, reader, outsider } = actors;
  let created;
  if (fixture.url)
    created = await owner(
      'POST',
      '/documents/import-web',
      {
        url: fixture.url,
        title: fixture.id,
        team: 'quality',
        visibility: 'TEAM',
      },
      201,
    );
  else {
    const upload = new FormData();
    upload.set('file', new Blob([fixture.data]), fixture.name);
    upload.set('title', fixture.id);
    upload.set('team', 'quality');
    upload.set('visibility', 'TEAM');
    created = await owner('POST', '/documents', upload, 201);
  }
  const id = created.id,
    route = '/documents/' + id;
  const initial = await owner('GET', route);
  let document;
  await eventually(
    async () => {
      document = await owner('GET', route);
      const state = document.ingestion?.task?.state;
      if (['failed', 'canceled', 'superseded'].includes(state))
        throw new Error(`Parse ${state}: ${id}`);
      // Task and body are separate reads; completion can race the current-pointer read.
      return (
        state === 'needs_review' ||
        (state === 'completed' &&
          document.parseStatus === 'READY' &&
          Boolean(document.content))
      );
    },
    'asynchronous parse ' + fixture.id,
    300000,
  );
  assert.equal(document.status, 'DRAFT');
  assert.equal(
    (
      await reader(
        'GET',
        '/search/documents?keyword=' + encodeURIComponent(fixture.id),
      )
    ).items.length,
    0,
  );
  await reader('GET', route, undefined, 403);
  await outsider('GET', route + '/evidence', undefined, 403);
  await outsider('GET', route + '/parse-status', undefined, 403);
  await outsider('GET', route, undefined, 403);
  await owner('POST', route + '/publish', {}, 403);
  await admin('POST', route + '/publish', {}, 422);
  const taskId = document.ingestion.task.id;
  let candidate;
  if (document.ingestion.task.state === 'needs_review') {
    await owner('POST', route + '/submit-review', {}, 422);
    candidate = await owner('GET', route + '/parse-drafts/' + taskId);
    await owner(
      'POST',
      route + '/parse-review',
      { taskId, accept: true, acknowledgeIssues: true, note: ' ' },
      400,
    );
    await reader('GET', route + '/parse-drafts/' + taskId, undefined, 403);
    await owner(
      'POST',
      route + '/parse-review',
      {
        taskId,
        accept: true,
        acknowledgeIssues: false,
        note: '已核对合成原件',
      },
      candidate.ready === true ? 201 : 400,
    );
    // Non-ready candidates require explicit acknowledgment; do not erase quality issues.
    if (candidate.ready !== true)
      await owner(
        'POST',
        route + '/parse-review',
        {
          taskId,
          accept: true,
          acknowledgeIssues: true,
          note: '对照合成原件核对空白、负号、单位及否定；合并关系未确认',
        },
        201,
      );
    document = await owner('GET', route);
    assert.equal(document.version, initial.version + 1);
    assert.equal(document.status, 'DRAFT');
    assert.equal(document.parseStatus, 'READY');
    assert.equal(document.content.markdown, candidate.markdown);
    assert.deepEqual(document.content.quality, candidate.quality);
    await owner(
      'POST',
      route + '/parse-review',
      { taskId, accept: true, acknowledgeIssues: true, note: '不得重复采用' },
      409,
    );
  }
  assert.ok(document.content);
  for (const fact of fixture.facts)
    assert.ok(
      normalize(document.content.markdown).includes(normalize(fact)),
      `${fixture.id} missing ${fact}`,
    );
  for (const forbidden of fixture.forbidden || [])
    assert.ok(!document.content.markdown.includes(forbidden));
  return { id, route, document, candidate };
}
async function rejectReparse(actors, document, route) {
  const { owner, reader } = actors;
  const publishedMarkdown = document.content.markdown;
  const reparse = await owner('POST', route + '/reparse', {}, 202);
  let reparsed;
  await eventually(
    async () => {
      reparsed = await owner('GET', route);
      return (
        reparsed.ingestion?.task?.id === reparse.taskId &&
        reparsed.ingestion.task.state === 'needs_review'
      );
    },
    'published reparse candidate',
    300000,
  );
  assert.equal(reparsed.content.markdown, publishedMarkdown);
  assert.equal(reparsed.status, 'PUBLISHED');
  assert.equal(reparsed.version, document.version);
  const draft = await owner('GET', route + '/parse-drafts/' + reparse.taskId);
  await reader(
    'GET',
    route + '/parse-drafts/' + reparse.taskId,
    undefined,
    403,
  );
  if (draft.assets.length)
    await reader(
      'GET',
      '/storage/object?key=' + encodeURIComponent(draft.assets[0].objectKey),
      undefined,
      403,
    );
  await owner(
    'POST',
    route + '/parse-review',
    {
      taskId: reparse.taskId,
      accept: false,
      acknowledgeIssues: false,
      note: '保留已发布修订，拒绝本次候选',
    },
    201,
  );
  assert.equal((await owner('GET', route)).version, document.version);
  return draft;
}
module.exports = { parseAndReview, rejectReparse };
