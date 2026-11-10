const fs = require('node:fs/promises');
const path = require('node:path');
const { requestRecall } = require('./recall-ipc.cjs');

async function runRecallAudit(
  environment,
  client,
  directory,
  output,
  { split = 'all', budgets = [5, 10, 15, 30, 60] } = {},
  request = requestRecall,
) {
  const questions = JSON.parse(
    await fs.readFile(path.join(directory, 'questions.json'), 'utf8'),
  ).filter((q) => split === 'all' || q.split === split);
  if (!questions.length)
    throw new Error('No questions in selected recall split');
  const rows = [];
  await request(environment.api, {
    query: questions[0].question,
    budget: 15,
    user: client.user,
  });
  for (const budget of budgets) {
    for (const question of questions) {
      const trace = await request(environment.api, {
        query: question.question,
        budget,
        user: client.user,
      });
      rows.push({ id: question.id, budget, ...trace });
    }
    console.log(
      `Recall audit: budget=${budget}, ${questions.length} questions completed`,
    );
    // Keep completed evidence even if a later budget fails.
    await fs.writeFile(
      path.join(output, 'recall-traces.json'),
      JSON.stringify(rows) + '\n',
    );
  }
  // Verify the diagnostic path matches the production HTTP path at its current budget.
  const sample =
    questions.find((question) => question.id === 'kb011') || questions[0];
  let traced = rows.find((row) => row.id === sample.id && row.budget === 15);
  if (!traced)
    traced = await request(environment.api, {
      query: sample.question,
      budget: 15,
      user: client.user,
    });
  const actual = await client.request('/search/hybrid', {
    method: 'POST',
    status: 201,
    body: { query: sample.question, topK: 5 },
  });
  if (
    JSON.stringify(actual.items.map((item) => item.chunkId)) !==
    JSON.stringify(traced.selected.map((item) => item.chunkId))
  )
    throw new Error('Recall diagnostic and production HTTP selection differ');
  return {
    budgets,
    split,
    requests: rows.length,
    http_selection_verified: sample.id,
  };
}

module.exports = { runRecallAudit };
