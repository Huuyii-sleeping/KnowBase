// Explicit local browser exercise; no production data or shared services.
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { AcceptanceEnvironment, root } = require('./environment.cjs');
const { cleanupAll } = require('../complex-quality/delivery-environment.cjs');
async function start(output) {
  await mkdir(output, { recursive: false });
  const env = new AcceptanceEnvironment();
  let web;
  const close = async () => {
    await cleanupAll([() => web?.close(), () => env.close()]);
  };
  try {
    await env.start(output);
    process.chdir(path.join(root, 'apps/web'));
    const { createServer } = await import(
      path.join(root, 'apps/web/node_modules/vite/dist/node/index.js')
    );
    web = await createServer({
      root: path.join(root, 'apps/web'),
      server: {
        host: '127.0.0.1',
        port: 18881,
        strictPort: true,
        proxy: { '/api': { target: env.baseUrl, changeOrigin: true } },
      },
    });
    await web.listen();
    await writeFile(
      path.join(output, 'session.json'),
      JSON.stringify({
        url: 'http://127.0.0.1:18881',
        password: env.password,
        api: env.baseUrl,
        project: env.project,
      }),
      { mode: 0o600 },
    );
    console.log('Isolated browser environment ready on http://127.0.0.1:18881');
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.once(signal, () => {
        close().finally(() => process.exit());
      });
  } catch (error) {
    await close();
    throw error;
  }
}
if (require.main === module)
  start(path.resolve(process.argv[2])).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
