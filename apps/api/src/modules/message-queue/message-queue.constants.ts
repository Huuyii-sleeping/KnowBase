export const MESSAGE_QUEUE_EXCHANGE = 'knowbase.pipeline';

export const MESSAGE_QUEUE_NAMES = {
  SEARCH: 'knowbase.pipeline.search',
  RAG: 'knowbase.pipeline.rag',
  KG: 'knowbase.pipeline.kg',
} as const;

export const MESSAGE_ROUTING_KEYS = {
  SEARCH_INDEX: 'document.index',
  RAG_REBUILD: 'document.rag.rebuild',
  KG_REBUILD: 'document.kg.rebuild',
  KG_DELETE: 'document.kg.delete',
  SEARCH_DELETE: 'document.search.delete',
  RAG_DELETE: 'document.rag.delete',
  SOURCE_DELETE: 'document.source.delete',
} as const;
