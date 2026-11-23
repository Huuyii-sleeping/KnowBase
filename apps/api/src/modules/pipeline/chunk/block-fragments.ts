import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { DocumentBlock } from '../../ingestion/document-structure';

export async function blockFragments(
  block: DocumentBlock,
  budget: number,
  overlap: number,
): Promise<string[]> {
  if (block.kind === 'equation') {
    if (block.text.length > budget)
      throw new Error('Equation exceeds RAG_CHUNK_SIZE; increase the budget.');
    return [block.text];
  }
  if (block.text.length <= budget && block.kind !== 'code') return [block.text];
  if (block.kind === 'table') return tableFragments(block.text, budget);
  if (block.kind === 'code') return codeFragments(block.text, budget);
  return proseFragments(block.text, budget, overlap);
}

async function proseFragments(
  text: string,
  size: number,
  overlap: number,
): Promise<string[]> {
  const fallback = new RecursiveCharacterTextSplitter({
    chunkSize: size,
    chunkOverlap: Math.min(overlap, size - 1),
    separators: ['\n', ' ', ''],
    keepSeparator: true,
  });
  const units: string[] = [];
  // Keep end punctuation with its sentence, including when overlap is zero.
  for (const sentence of text.split(
    /(?<=[。！？；])|(?<=[.!?;])(?=\s)|(?<=\n)/u,
  )) {
    units.push(
      ...(sentence.length > size
        ? await fallback.splitText(sentence)
        : [sentence]),
    );
  }
  const output: string[] = [];
  let group: string[] = [];
  for (const unit of units.filter(Boolean)) {
    if (group.join('').length + unit.length > size) {
      output.push(group.join('').trim());
      let retained = 0;
      const tail: string[] = [];
      for (
        let i = group.length - 1;
        i >= 0 && retained + group[i].length <= overlap;
        i--
      ) {
        tail.unshift(group[i]);
        retained += group[i].length;
      }
      group = tail;
      while (group.length && group.join('').length + unit.length > size)
        group.shift();
    }
    group.push(unit);
  }
  if (group.length) output.push(group.join('').trim());
  return output.filter(Boolean);
}

function tableFragments(text: string, budget: number): string[] {
  const [header, delimiter, ...rows] = text.split('\n');
  const prefix = `${header}\n${delimiter}`;
  const output: string[] = [];
  let group = prefix;
  for (const row of rows) {
    if (prefix.length + row.length + 1 > budget)
      throw new Error(
        'Table header and row exceed RAG_CHUNK_SIZE; increase the budget or simplify the source table.',
      );
    if (group.length + row.length + 1 > budget) {
      output.push(group);
      group = prefix;
    }
    group += '\n' + row;
  }
  if (group.length > budget)
    throw new Error('Table header exceeds RAG_CHUNK_SIZE.');
  output.push(group);
  return output;
}

async function codeFragments(text: string, budget: number): Promise<string[]> {
  const lines = text.split('\n');
  const opening = lines.shift()!;
  const fence = opening.match(/^\s*(`{3,}|~{3,})/)![1];
  const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`);
  if (closing.test(lines.at(-1) ?? '')) lines.pop();
  const bodyBudget = budget - opening.length - fence.length - 2;
  if (bodyBudget < 1) throw new Error('Code fence exceeds RAG_CHUNK_SIZE.');
  const parts = await new RecursiveCharacterTextSplitter({
    chunkSize: bodyBudget,
    chunkOverlap: 0,
    separators: ['\n', ''],
    keepSeparator: true,
  }).splitText(lines.join('\n'));
  return parts.map((part) => `${opening}\n${part}\n${fence}`);
}
