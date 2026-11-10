const { randomUUID } = require('node:crypto');

// Parent/child IPC only. No debug HTTP route is installed in the application.
function requestRecall(child, input, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener('message', message);
      child.removeListener('exit', exit);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const exit = () =>
      fail(new Error('Benchmark API exited during recall audit'));
    const message = (result) => {
      if (result.id !== id) return;
      cleanup();
      if (result.error) reject(new Error(result.error));
      else resolve(result.trace);
    };
    const timeout = setTimeout(
      () => fail(new Error('Recall audit IPC timed out')),
      timeoutMs,
    );
    child.on('message', message);
    child.once('exit', exit);
    try {
      child.send({ kind: 'recall-audit', id, input }, (error) => {
        if (error) fail(error);
      });
    } catch (error) {
      fail(error);
    }
  });
}

function installRecallHandler(child, recall, rerank, merge) {
  const handler = async (message) => {
    if (message.kind !== 'recall-audit') return;
    try {
      const { query, budget, user, finalK = 5 } = message.input;
      if (
        !user?.id ||
        user.role !== 'ADMIN' ||
        !Number.isInteger(budget) ||
        budget < 1 ||
        budget > 100 ||
        !Number.isInteger(finalK) ||
        finalK < 1 ||
        finalK > 20
      )
        throw new Error('Invalid isolated recall audit input');
      const started = performance.now();
      const [keyword, semantic] = await Promise.all([
        recall.recall({ query, topK: budget }, 'keyword', user),
        recall.recall({ query, topK: budget }, 'semantic', user),
      ]);
      const pool = merge(keyword.items, semantic.items);
      const selected = rerank.rerank(query, pool, { topK: finalK });
      child.send({
        id: message.id,
        trace: {
          keyword,
          semantic,
          pool,
          selected,
          elapsedMs: performance.now() - started,
        },
      });
    } catch (error) {
      child.send({ id: message.id, error: error.message });
    }
  };
  child.on('message', handler);
  return () => child.removeListener('message', handler);
}

module.exports = { requestRecall, installRecallHandler };
