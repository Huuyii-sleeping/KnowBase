import { describe, expect, it } from 'vitest';
import { GraphIntentService } from './graph-intent.service';

describe('GraphIntentService', () => {
  const service = new GraphIntentService();

  it('routes relationship and dependency questions to the graph', () => {
    expect(service.shouldUseGraph('RAG 和 Ollama 有什么关系？')).toBe(true);
    expect(service.shouldUseGraph('RabbitMQ 的上下游依赖是什么？')).toBe(true);
    expect(service.shouldUseGraph('这个模块会影响哪些组件？')).toBe(true);
  });

  it('keeps ordinary factual questions on hybrid retrieval', () => {
    expect(service.shouldUseGraph('RAG 的基本流程是什么？')).toBe(false);
    expect(service.shouldUseGraph('Elasticsearch 的端口是多少？')).toBe(false);
  });

  it('extracts candidate entity terms from a natural language question', () => {
    expect(service.extractTerms('RAG 和 Ollama 有什么关系？')).toEqual(['rag', 'ollama']);
  });

  it('splits Chinese entity names from relationship wording', () => {
    expect(service.extractTerms('RAG 和离线建库链路有什么关系？')).toEqual(['rag', '离线建库链路']);
  });
});
