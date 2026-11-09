import { PageHeader } from '@/components/page-header';
import { Icon } from '@/components/ui/icon';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  answerApi,
  type AnswerContext,
  type AnswerResult,
  type AnswerSourceType,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { requestFailure } from '@/lib/api-error';
import { RequestFailure } from '@/components/request-failure';

const EXAMPLES = [
  'RAG 的基本流程是什么？',
  'RAG 和离线建库链路有什么关系？',
  'chunk size 过大会带来什么问题？',
];

const SOURCE_META: Record<
  AnswerSourceType,
  { label: string; className: string }
> = {
  graph: {
    label: '图谱路径',
    className: 'border-teal-200 bg-teal-50 text-teal-800',
  },
  semantic: {
    label: '向量检索',
    className: 'border-violet-200 bg-violet-50 text-violet-800',
  },
  keyword: {
    label: '全文检索',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
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
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium',
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

export function AskPage() {
  const [question, setQuestion] = useState('');
  const [topK, setTopK] = useState('3');
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [latest, setLatest] = useState<AnswerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{
    message: string;
    retryable: boolean;
    question: string;
    topK: number;
  } | null>(null);

  const send = async (value: string, recall: number, retry = false) => {
    if (!value || loading) return;
    if (!retry) setQuestion('');
    setFailure(null);
    setLoading(true);
    if (!retry)
      setConversation((items) => [...items, { role: 'user', text: value }]);
    try {
      const result = await answerApi.answer(value, recall);
      setLatest(result);
      setConversation((items) => [
        ...items,
        { role: 'assistant', text: result.answer, result },
      ]);
    } catch (reason) {
      setFailure({ ...requestFailure(reason), question: value, topK: recall });
    } finally {
      setLoading(false);
    }
  };

  const submit = (event?: FormEvent<HTMLFormElement>, preset?: string) => {
    event?.preventDefault();
    return send((preset ?? question).trim(), Number(topK));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Knowledge assistant"
        title="AI 问答"
        description="把问题交给知识库，让每个答案都有据可循。"
        actions={
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
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          <div className="flex min-h-[500px] flex-col">
            <div className="flex-1 space-y-5 p-5 sm:p-7">
              {conversation.length === 0 ? (
                <div className="flex min-h-[395px] flex-col justify-center">
                  <div className="mx-auto w-full max-w-xl text-center">
                    <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[22px] border border-primary/15 bg-accent text-primary">
                      <Icon name="spark" width={30} height={30} />
                    </div>
                    <div className="mb-3 text-[11px] font-medium tracking-widest text-primary">
                      你的团队知识助手
                    </div>
                    <h2 className="text-[28px] font-semibold leading-tight tracking-tight">
                      让积累的知识，成为此刻的答案。
                    </h2>
                    <p className="mx-auto mt-3 max-w-sm text-[13px] leading-7 text-muted-foreground">
                      询问流程、查找方案，或探索知识间的联系。回答会附上参考来源，方便你回到原文。
                    </p>
                    <div className="mt-7 flex flex-col gap-2 text-left">
                      {EXAMPLES.map((example) => (
                        <button
                          key={example}
                          type="button"
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground"
                          onClick={() => void submit(undefined, example)}
                        >
                          {example}
                          <Icon name="arrow" width={14} height={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                conversation.map((item, index) => (
                  <div
                    key={`${item.role}-${index}`}
                    className={cn(
                      'flex gap-3',
                      item.role === 'user' && 'justify-end',
                    )}
                  >
                    {item.role === 'assistant' && (
                      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
                        K
                      </div>
                    )}
                    <div
                      className={cn(
                        'max-w-[88%] text-[14px] leading-7',
                        item.role === 'user'
                          ? 'rounded-lg bg-secondary px-4 py-2.5 text-foreground'
                          : 'min-w-0 text-foreground/90',
                      )}
                    >
                      <div className="whitespace-pre-wrap">{item.text}</div>
                      {item.role === 'assistant' &&
                        item.result &&
                        item.result.contexts.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {item.result.citations.map((citation) => (
                              <Link
                                key={citation.sourceId}
                                to={`/documents/${citation.documentId}`}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] leading-4 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                              >
                                <span className="font-medium text-foreground">
                                  [{citation.sourceId}]
                                </span>
                                <SourceBadge type={citation.sourceType} />
                                <span className="max-w-[180px] truncate">
                                  {citation.title}
                                </span>
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
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
                    K
                  </div>
                  正在检索并组织回答…
                </div>
              )}
              {failure && (
                <RequestFailure
                  title="这次没能生成回答"
                  message={failure.message}
                  onRetry={
                    failure.retryable
                      ? () => void send(failure.question, failure.topK, true)
                      : undefined
                  }
                />
              )}
            </div>

            <form
              className="border-t border-border bg-secondary/40 p-4 sm:p-5"
              onSubmit={(event) => void submit(event)}
            >
              <div className="rounded-md border border-input bg-background shadow-sm focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/20">
                <Textarea
                  aria-label="向知识库提问"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="输入你的问题…"
                  className="min-h-[74px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                  maxLength={1000}
                  disabled={loading}
                />
                <div className="flex items-center justify-between px-3 pb-2.5">
                  <span className="text-[11px] text-muted-foreground/70">
                    {question.length}/1000
                  </span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={loading || !question.trim()}
                  >
                    {loading ? '处理中…' : '发送问题'}
                    <Icon name="arrow" width={14} height={14} />
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </section>

        <aside className="rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3.5">
            <div className="text-[13px] font-semibold">检索依据</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              最近一次回答使用的来源
            </div>
          </div>
          <div className="space-y-3 p-4">
            {!latest ? (
              <div className="py-12 text-center">
                <Icon
                  name="book"
                  width={28}
                  height={28}
                  className="mx-auto mb-4 text-primary/40"
                />
                <p className="text-[12px] leading-6 text-muted-foreground">
                  答案背后的知识，会在这里展开。
                  <br />
                  提问后可查看参考文档与关联路径。
                </p>
              </div>
            ) : latest.contexts.length === 0 ? (
              <div className="py-10 text-center text-[12.5px] leading-6 text-muted-foreground/70">
                本次没有找到足够的知识库依据。
              </div>
            ) : (
              latest.contexts.map((context) => {
                const type = sourceTypeOf(context);
                return (
                  <article
                    key={context.sourceId}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
                        {context.sourceId}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <SourceBadge type={type} />
                          <Link
                            to={`/documents/${context.documentId}`}
                            className="truncate text-[12.5px] font-medium hover:text-primary hover:underline"
                          >
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
