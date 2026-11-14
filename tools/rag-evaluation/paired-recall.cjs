const fs = require('node:fs/promises');
const path = require('node:path');
const { MODES } = require('./phrase-match.cjs');
const { requestRecall } = require('./recall-ipc.cjs');

function pairedOrder(index, repeat) {
  const rotated = MODES.map((_, i) => MODES[(i + index) % MODES.length]);
  return repeat % 2 ? rotated.reverse() : rotated;
}

async function runPairedRecall(
  api,
  client,
  questions,
  output,
  request = requestRecall,
) {
  if (!questions.length) throw new Error('Paired recall needs questions');
  const groups = [];
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const mode of MODES) {
      const directory = path.join(output, `${mode}-r${repeat + 1}`);
      await fs.mkdir(directory);
      groups.push({ mode, repeat: repeat + 1, directory, rows: [] });
    }
  }
  const save = () =>
    Promise.all(
      groups.map((g) =>
        fs.writeFile(
          path.join(g.directory, 'recall-traces.json'),
          JSON.stringify(g.rows) + '\n',
        ),
      ),
    );
  try {
    for (const mode of MODES) {
      await request(api, {
        query: questions[0].question,
        keywordBudget: 30,
        semanticBudget: 15,
        keywordMatchMode: mode,
        user: client.user,
      });
    }
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const [index, question] of questions.entries()) {
        for (const mode of pairedOrder(index, repeat)) {
          const trace = await request(api, {
            query: question.question,
            keywordBudget: 30,
            semanticBudget: 15,
            keywordMatchMode: mode,
            user: client.user,
          });
          if (trace.keywordMatchMode !== mode)
            throw new Error('Paired trace mode mismatch');
          groups
            .find((g) => g.mode === mode && g.repeat === repeat + 1)
            .rows.push({
              id: question.id,
              budget: 'k30-s15',
              ...trace,
            });
        }
        if ((index + 1) % 25 === 0 || index === questions.length - 1) {
          await save();
          console.log(
            `Paired recall repeat${repeat + 1}: ${index + 1}/${questions.length} questions x3 modes`,
          );
        }
      }
    }
  } catch (error) {
    await save();
    throw error;
  }
  // Public HTTP parity checks only the existing original-query 15:15 path.
  const sample = questions[0];
  const trace = await request(api, {
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
    JSON.stringify(trace.selected.map((i) => i.chunkId)) !==
    JSON.stringify(actual.items.map((i) => i.chunkId))
  )
    throw new Error('Paired baseline differs from production HTTP');
  return groups;
}

module.exports = { pairedOrder, runPairedRecall };
