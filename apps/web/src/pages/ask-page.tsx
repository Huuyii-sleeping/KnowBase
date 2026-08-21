import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { answerApi, type AnswerContext, type AnswerResult, type AnswerSourceType } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const EXAMPLES = [
  'RAG 的基本流程是什么？',
  'RAG 和离线建库链路有什么关系？',
  'chunk size 过大会带来什么问题？',
];

const SOURCE_META: Record<AnswerSourceType, { label: string; className: string }> = {
  graph: { label: '图谱路径', className: 'border-teal-200 bg-teal-50 text-teal-800' },
  semantic: { label: '向量检索', className: 'border-violet-200 bg-violet-50 text-violet-800' },
  keyword: { label: '全文检索', className: 'border-amber-200 bg-amber-50 text-amber-800' },
};

interface ConversationItem {
  role: 'user' | 'assistant';
  text: string;
  result?: AnswerResult;
}

function sourceTypeOf(context: AnswerContext): AnswerSourceType {
  if (context.sourceType) return context.sourceType;
  return context.title.startsWith('知识图谱路径') ? 'graph' : 'semantic';
}

function SourceBadge({ type }: { type: AnswerSourceType }) {
  const meta = SOURCE_META[type];
  return <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.className)}>{meta.label}</span>;
}

export function AskPage() {
  const [question, setQuestion] = useState('');
  const [topK, setTopK] = useState('3');
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [latest, setLatest] = useState<AnswerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event?: FormEvent<HTMLFormElement>, preset?: string) => {
    event?.preventDefault();
    const value = (preset ?? question).trim();
    if (!value || loading) return;
    setQuestion('');
    setError(null);
    setLoading(true);
    setConversation((items) => [...items, { role: 'user', text: value }]);
    try {
      const result = await answerApi.answer(value, Number(topK));
      setLatest(result);
      setConversation((items) => [...items, { role: 'assistant', text: result.answer, result }]);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Knowledge workspace</div>
          <h1 className="text-[22px] font-semibold tracking-tight">AI 问答</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">基于已发布知识回答，并保留每个结论的来源。</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>召回数量</span>
          <Select value={topK} onValueChange={setTopK}>
            <SelectTrigger className="w-[92px]" aria-label="召回数量">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Top 3</SelectItem>
              <SelectItem value="5">Top 5</SelectItem>
              <SelectItem value="8">Top 8</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          <div className="flex min-h-[500px] flex-col">
            <div className="flex-1 space-y-5 p-5 sm:p-7">
              {conversation.length === 0 ? (
                <div className="flex min-h-[395px] flex-col justify-center">
                  <div className="max-w-xl">
                    <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-primary">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      知识库已就绪
                    </div>
                    <h2 className="max-w-lg text-[27px] font-semibold leading-tight tracking-tight">从一个具体问题开始。</h2>
                    <p className="mt-3 max-w-lg text-[14px] leading-7 text-muted-foreground">
                      普通问题使用全文与向量混合检索；关系、依赖和多跳问题会追加知识图谱路径。
                    </p>
                    <div className="mt-7 flex flex-wrap gap-2">
                      {EXAMPLES.map((example) => (
                        <button
                          key={example}
                          type="button"
                          className="rounded-md border border-border bg-background px-3 py-2 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground"
                          onClick={() => void submit(undefined, example)}
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                conversation.map((item, index) => (
                  <div key={`${item.role}-${index}`} className={cn('flex gap-3', item.role === 'user' && 'justify-end')}>
                    {item.role === 'assistant' && (
                      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">K</div>
                    )}
                    <div className={cn(
                      'max-w-[88%] text-[14px] leading-7',
                      item.role === 'user'
                        ? 'rounded-lg bg-secondary px-4 py-2.5 text-foreground'
                        : 'min-w-0 text-foreground/90',
                    )}>
                      <div className="whitespace-pre-wrap">{item.text}</div>
                      {item.role === 'assistant' && item.result && item.result.contexts.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {item.result.citations.map((citation) => (
                            <Link
                              key={citation.sourceId}
                              to={`/documents/${citation.documentId}`}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] leading-4 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                            >
                              <span className="font-medium text-foreground">[{citation.sourceId}]</span>
                              <SourceBadge type={citation.sourceType} />
                              <span className="max-w-[180px] truncate">{citation.title}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">K</div>
                  正在检索并组织回答…
                </div>
              )}
              {error && <div className="rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-700">回答失败：{error}</div>}
            </div>

            <form className="border-t border-border bg-secondary/40 p-4 sm:p-5" onSubmit={(event) => void submit(event)}>
              <div className="rounded-md border border-input bg-background shadow-sm focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/20">
                <Textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="输入你的问题…"
                  className="min-h-[74px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                  maxLength={1000}
                  disabled={loading}
                />
                <div className="flex items-center justify-between px-3 pb-2.5">
                  <span className="text-[11px] text-muted-foreground/70">{question.length}/1000</span>
                  <Button type="submit" size="sm" disabled={loading || !question.trim()}>
                    {loading ? '处理中…' : '发送问题'}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </section>

        <aside className="rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3.5">
            <div className="text-[13px] font-semibold">检索依据</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">最近一次回答使用的来源</div>
          </div>
          <div className="space-y-3 p-4">
            {!latest ? (
              <div className="py-10 text-center text-[12.5px] leading-6 text-muted-foreground/70">
                发送问题后，这里会展示回答使用的文档片段与图谱路径。
              </div>
            ) : latest.contexts.length === 0 ? (
              <div className="py-10 text-center text-[12.5px] leading-6 text-muted-foreground/70">
                本次没有找到足够的知识库依据。
              </div>
            ) : (
              latest.contexts.map((context) => {
                const type = sourceTypeOf(context);
                return (
                  <article key={context.sourceId} className="rounded-md border border-border p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-[11px] font-semibold text-muted-foreground">{context.sourceId}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <SourceBadge type={type} />
                          <Link to={`/documents/${context.documentId}`} className="truncate text-[12.5px] font-medium hover:text-primary hover:underline">
                            {context.title}
                          </Link>
                        </div>
                        <p className="mt-2 max-h-[112px] overflow-hidden whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">
                          {context.content || '该来源未返回正文。'}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
