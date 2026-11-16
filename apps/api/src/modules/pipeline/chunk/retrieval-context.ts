export type RetrievalContext = 'body' | 'title' | 'title-heading';

export function retrievalContext(value: string): RetrievalContext {
  if (value !== 'body' && value !== 'title' && value !== 'title-heading')
    throw new Error(
      'RAG_RETRIEVAL_CONTEXT must be body, title or title-heading',
    );
  return value;
}
