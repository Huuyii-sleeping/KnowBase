import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { documentsApi, type DocumentMeta, type DocumentStatus } from '@/lib/api';
import { formatBytes, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_FILTERS: Array<{ value: DocumentStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'PENDING_REVIEW', label: '待审核' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'REJECTED', label: '已驳回' },
];

const PAGE_SIZE = 20;

export function DocumentsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<DocumentMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<DocumentStatus | 'ALL'>('ALL');
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      setError((e as Error).message);
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
      <div className="mb-5 flex items-center gap-4">
        <h1 className="text-[22px] font-semibold tracking-tight">文档库</h1>
        <div className="flex-1" />
        <Button onClick={() => setUploadOpen(true)}>＋ 上传文档</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              className={cn(
                'rounded-full px-3.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent',
                status === f.value && 'bg-foreground text-background hover:bg-foreground',
              )}
              onClick={() => { setStatus(f.value); setPage(1); }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <form
          className="ml-auto"
          onSubmit={(e) => { e.preventDefault(); setKeyword(keywordInput.trim()); setPage(1); }}
        >
          <Input
            className="w-[200px]"
            placeholder="搜索标题 / 文件名…"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
          />
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <Table>
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
              <TableRow
                key={doc.id}
                className="cursor-pointer"
                onClick={() => navigate(`/documents/${doc.id}`)}
              >
                <TableCell>
                  <div className="truncate text-[13.5px] font-medium">{doc.title}</div>
                  <div className="text-[12px] text-muted-foreground/70">
                    {formatBytes(doc.fileSize)} · v{doc.version}
                  </div>
                </TableCell>
                <TableCell className="text-[12.5px] text-muted-foreground">
                  {[doc.category, doc.tags.join(', ')].filter(Boolean).join(' · ') || '—'}
                </TableCell>
                <TableCell><StatusBadge status={doc.status} /></TableCell>
                <TableCell><ParseBadge status={doc.parseStatus} /></TableCell>
                <TableCell className="text-right text-[12.5px] text-muted-foreground">
                  {formatRelative(doc.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!loading && !error && items.length === 0 && (
          <div className="py-14 text-center text-[13px] text-muted-foreground/70">
            暂无文档，点击右上角「上传文档」开始
          </div>
        )}
        {error && (
          <div className="py-14 text-center text-[13px]">
            <span className="text-destructive">加载失败：{error}</span>
            <div className="mt-1 text-muted-foreground/70">请确认后端服务已启动（localhost:3000）</div>
          </div>
        )}
        {loading && (
          <div className="py-14 text-center text-[13px] text-muted-foreground/70">加载中…</div>
        )}
        <div className="flex items-center border-t border-border px-4 py-2.5 text-[12.5px] text-muted-foreground">
          <span>共 {total} 篇文档</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
            <span>{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</Button>
          </div>
        </div>
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onCreated={load} />
    </div>
  );
}
