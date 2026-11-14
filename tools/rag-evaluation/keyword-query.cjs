// Experiment only: remove a frozen list of question words from the keyword
// query. Spaces prevent newly adjacent characters from inventing CJK bigrams.
function keywordQueryMode(value) {
  if (!['off', 'trim-question'].includes(value))
    throw new Error('Invalid keyword query mode');
  return value;
}

function keywordQuery(query, mode = 'off') {
  keywordQueryMode(mode);
  if (typeof query !== 'string' || !query.trim())
    throw new Error('Keyword query must be non-empty');
  if (mode === 'off') return query;
  // Quoted names/code and bracketed conditions are deliberately left intact.
  if (query.length > 512 || /[`"'“”‘’「」『』【】（）()[\]]/.test(query))
    return query;
  const reduced = query
    .replace(
      /麻烦问一下|想问一下|请问|为什么|为何|怎么样|怎么|怎样|如何|什么|哪个|哪些|哪种|哪位/g,
      ' ',
    )
    .replace(/吗(?=[，,；;？?。！!]|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Never send an empty or punctuation-only query to the search adapter.
  return (reduced.match(/[\p{L}\p{N}]/gu) || []).length >= 2 ? reduced : query;
}

module.exports = { keywordQueryMode, keywordQuery };
