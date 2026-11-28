function checkedBudget(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new Error('Recall budgets must be integers in 1..100');
  return value;
}

function budgetPair(keyword, semantic) {
  checkedBudget(keyword);
  checkedBudget(semantic);
  return {
    id: keyword === semantic ? keyword : `k${keyword}-s${semantic}`,
    keyword,
    semantic,
  };
}

function parseRouteBudgets(value) {
  const pairs = value.split(',').map((entry) => {
    if (!/^\d+:\d+$/.test(entry))
      throw new Error('Route budgets must use keyword:semantic pairs');
    return budgetPair(...entry.split(':').map(Number));
  });
  if (new Set(pairs.map((pair) => pair.id)).size !== pairs.length)
    throw new Error('Route budget pairs must be unique');
  return pairs;
}

function resolveBudgets(input) {
  const keyword = input.keywordBudget ?? input.budget;
  const semantic = input.semanticBudget ?? input.budget;
  return budgetPair(keyword, semantic);
}

module.exports = { budgetPair, parseRouteBudgets, resolveBudgets };
