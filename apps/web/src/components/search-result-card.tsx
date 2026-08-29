import { Link } from 'react-router-dom';
import {
  type AnswerSourceType,
  type HybridSearchItem,
  type SearchDocumentItem,
  type SemanticSearchItem,
} from '@/lib/api';
import { formatScore, getKeywordHighlight } from '@/lib/search-result.utils';
import { cn } from '@/lib/utils';

const SOURCE_META: Record<AnswerSourceType, { label: string; className: string }> = {
  keyword: { label: '全文', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  semantic: { label: '向量', className: 'border-violet-200 bg-violet-50 text-violet-800' },
  graph: { label: '图谱', className: 'border-teal-200 bg-teal-50 text-teal-800' },
};

function Highlight({ value }: { value: string }) {
  const parts = value.split(/(<em>|<\/em>)/gi);
  let emphasized = false;

  return (
    <>
      {parts.map((part, index) => {
        if (part.toLowerCase() === '<em>') {
          emphasized = true;
          return null;
        }
        if (part.toLowerCase() === '</em>') {
          emphasized = false;
          return null;
        }
        return emphasized ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>;
      })}
    </>
  );
}

function SourceBadge({ type }: { type: AnswerSourceType }) {
  const meta = SOURCE_META[type];
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.className)}>
      {meta.label}
    </span>
  );
}

export function KeywordResultCard({ item }: { item: SearchDocumentItem }) {
  const highlight = getKeywordHighlight(item);

  return (
    <article className="group border-b border-border py-4 last:border-0">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-50 text-[11px] font-semibold text-amber-700">TXT</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/documents/${item.id}`} className="text-[14px] font-medium group-hover:text-primary hover:underline">{item.title}</Link>
            <SourceBadge type="keyword" />
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {item.fileName || '未记录文件名'} · {item.category || '未分类'}{item.team ? ` · ${item.team}` : ''}
          </div>
          {highlight && <p className="mt-2 line-clamp-3 text-[13px] leading-6 text-muted-foreground"><Highlight value={highlight} /></p>}
          {item.tags && item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.tags.map((tag) => <span key={tag} className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{tag}</span>)}
            </div>
          )}
        </div>
        <div className="hidden shrink-0 text-right text-[11px] text-muted-foreground sm:block">相关度<br /><span className="font-mono text-foreground">{formatScore(item.score)}</span></div>
      </div>
    </article>
  );
}

export function SemanticResultCard({ item }: { item: SemanticSearchItem }) {
  return (
    <article className="group border-b border-border py-4 last:border-0">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-50 text-[11px] font-semibold text-violet-700">VEC</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/documents/${item.documentId}`} className="text-[14px] font-medium group-hover:text-primary hover:underline">{item.document.title}</Link>
            <SourceBadge type="semantic" />
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">Chunk {item.chunkIndex} · v{item.documentVersion} · {item.document.category || '未分类'}</div>
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">{item.content}</p>
        </div>
        <div className="hidden shrink-0 text-right text-[11px] text-muted-foreground sm:block">相似度<br /><span className="font-mono text-foreground">{formatScore(item.score)}</span></div>
      </div>
    </article>
  );
}

export function HybridResultCard({ item }: { item: HybridSearchItem }) {
  return (
    <article className="group border-b border-border py-4 last:border-0">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">RAG</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/documents/${item.documentId}`} className="text-[14px] font-medium group-hover:text-primary hover:underline">{item.title}</Link>
            {item.sources.map((source) => <SourceBadge key={source} type={source} />)}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">{item.chunkId ? `Chunk ${item.chunkIndex ?? 0}` : '文档级结果'}{item.category ? ` · ${item.category}` : ''}{item.team ? ` · ${item.team}` : ''}</div>
          {item.content && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">{item.content}</p>}
        </div>
        <div className="hidden shrink-0 text-right text-[11px] text-muted-foreground sm:block">重排分<br /><span className="font-mono text-foreground">{formatScore(item.rerankScore)}</span></div>
      </div>
    </article>
  );
}
