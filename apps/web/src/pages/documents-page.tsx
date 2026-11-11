import { requestFailure, type RequestFailureInfo } from '@/lib/api-error';
import { RequestFailure } from '@/components/request-failure';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ParseBadge, StatusBadge } from '@/components/status-badges';
import { UploadDialog } from '@/components/upload-dialog';
import {
  documentsApi,
  type DocumentMeta,
  type DocumentStatus,
} from '@/lib/api';
import { formatBytes, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FileSymbol } from '@/components/file-symbol';
import { Icon } from '@/components/ui/icon';

const STATUS_FILTERS: Array<{ value: DocumentStatus | 'ALL'; label: string }> =
  [
    { value: 'ALL', label: '全部' },
    { value: 'DRAFT', label: '草稿' },
    { value: 'PENDING_REVIEW', label: '待审核' },
    { value: 'PUBLISHED', label: '已发布' },
    { value: 'REJECTED', label: '已驳回' },
  ];

const PAGE_SIZE = 20;

export function DocumentsPage() {
  const [items, setItems] = useState<DocumentMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<DocumentStatus | 'ALL'>('ALL');
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RequestFailureInfo | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await documentsApi.list({
        status: status === 'ALL' ? undefined : status,
        keyword: keyword || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (e) {
      setError(requestFailure(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [status, keyword, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        eyebrow="Document library"
        title="文档库"
        description="让团队的每一份经验，都成为可复用的知识。"
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Icon name="upload" width={16} height={16} />
            上传文档
          </Button>
        }
      />

      <section className="knowledge-banner mb-7">
        <div className="flex items-center gap-5">
          <div className="knowledge-map hidden lg:block" aria-hidden="true">
            <span className="left-1 top-6">
              <Icon name="file" />
            </span>
            <span className="left-14 top-0">
              <Icon name="spark" />
            </span>
            <span className="bottom-0 right-0">
              <Icon name="graph" />
            </span>
          </div>
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">
              知识不止于收藏，更在于连接。
            </h2>
            <p className="mt-1.5 text-[12px] leading-6 text-muted-foreground">
              上传、整理、发布，让文档成为问答与探索的起点。
            </p>
          </div>
        </div>
        <Link
          to="/ask"
          className="inline-flex items-center gap-2 text-[12px] font-semibold text-primary hover:underline"
        >
          向知识库提问
          <Icon name="arrow" width={16} height={16} />
        </Link>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 border-b border-border px-5 py-4">
          <div className="flex flex-wrap gap-1" aria-label="按文档状态筛选">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={status === f.value}
                className={cn(
                  'rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent',
                  status === f.value &&
                    'bg-accent text-primary hover:bg-accent',
                )}
                onClick={() => {
                  setStatus(f.value);
                  setPage(1);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <form
            className="relative ml-auto w-full sm:w-[210px]"
            onSubmit={(e) => {
              e.preventDefault();
              setKeyword(keywordInput.trim());
              setPage(1);
            }}
          >
            <Icon
              name="search"
              width={15}
              height={15}
              className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground"
            />
            <Input
              aria-label="搜索文档标题或文件名"
              className="pl-9"
              placeholder="搜索标题 / 文件名…"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
            />
          </form>
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[38%]">标题</TableHead>
                <TableHead>分类 / 标签</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>解析</TableHead>
                <TableHead className="text-right">更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((doc) => (
                <TableRow key={doc.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <FileSymbol fileName={doc.fileName} />
                      <div className="min-w-0">
                        <Link
                          to={`/documents/${doc.id}`}
                          className="line-clamp-2 text-[13px] font-semibold transition-colors group-hover:text-primary hover:underline"
                        >
                          {doc.title}
                        </Link>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {formatBytes(doc.fileSize)}
                          <span className="mx-2 text-border">/</span>版本{' '}
                          {doc.version}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-[12.5px] text-muted-foreground">
                    <div>{doc.category || '未分类'}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {doc.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={doc.status} />
                  </TableCell>
                  <TableCell>
                    <ParseBadge status={doc.parseStatus} />
                  </TableCell>
                  <TableCell className="text-right text-[12.5px] text-muted-foreground">
                    {formatRelative(doc.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {!loading && !error && items.length === 0 && (
          <EmptyState
            title={
              keyword || status !== 'ALL'
                ? '没有匹配的文档'
                : '从第一份文档开始'
            }
            description={
              keyword || status !== 'ALL'
                ? '试试其他关键词，或切换文档状态。'
                : '上传团队文档，整理并发布后即可用于检索和问答。'
            }
            action={
              <Button variant="outline" onClick={() => setUploadOpen(true)}>
                <Icon name="upload" width={15} height={15} />
                上传文档
              </Button>
            }
          />
        )}
        {error && (
          <div className="p-5">
            <RequestFailure
              title="暂时无法加载文档"
              failure={error}
              onRetry={load}
              onRefresh={load}
            />
          </div>
        )}
        {loading && (
          <div
            role="status"
            className="px-5 py-14 text-center text-[13px] text-muted-foreground"
          >
            正在加载文档…
          </div>
        )}
        <div className="flex items-center border-t border-border px-5 py-3 text-[12.5px] text-muted-foreground">
          <span>共 {total} 篇文档</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              aria-label="上一页"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              ‹
            </Button>
            <span>
              {page} / {totalPages}
            </span>
            <Button
              aria-label="下一页"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              ›
            </Button>
          </div>
        </div>
      </section>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onCreated={load}
      />
    </div>
  );
}
