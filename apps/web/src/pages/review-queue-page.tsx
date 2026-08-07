import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ParseBadge } from '@/components/status-badges';
import { toast } from '@/components/toast';
import { documentsApi, type DocumentMeta } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';

export function ReviewQueuePage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<DocumentMeta | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await documentsApi.list({ status: 'PENDING_REVIEW', pageSize: 100 });
      setItems(result.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (doc: DocumentMeta) => {
    setActing(true);
    try {
      await documentsApi.review(doc.id, true);
      toast('已通过并发布');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setActing(false);
    }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    setActing(true);
    try {
      await documentsApi.review(rejectTarget.id, false, rejectReason.trim() || undefined);
      toast('已驳回');
      setRejectTarget(null);
      setRejectReason('');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setActing(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex items-center gap-4">
        <h1 className="text-[22px] font-semibold tracking-tight">审核队列</h1>
        <span className="text-[13px] text-muted-foreground">{items.length} 篇待审核</span>
      </div>

      {loading && <div className="py-14 text-center text-[13px] text-muted-foreground/70">加载中…</div>}
      {error && (
        <div className="py-14 text-center text-[13px]">
          <span className="text-destructive">加载失败：{error}</span>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="py-14 text-center text-[13px] text-muted-foreground/70">
          太棒了，没有待审核的文档
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {items.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center gap-4 rounded-lg border border-border bg-background px-[18px] py-3.5 transition-colors hover:border-input"
          >
            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navigate(`/documents/${doc.id}`)}>
              <div className="truncate text-[13.5px] font-medium">{doc.title}</div>
              <div className="text-[12px] text-muted-foreground/70">
                {doc.uploaderId} 提交于 {formatDateTime(doc.submittedAt)} · {doc.category ?? '未分类'} ·{' '}
                {formatBytes(doc.fileSize)} · v{doc.version}
              </div>
            </div>
            <ParseBadge status={doc.parseStatus} />
            <div className="flex shrink-0 gap-2">
              <Button variant="success" size="sm" disabled={acting} onClick={() => approve(doc)}>
                通过
              </Button>
              <Button variant="destructiveOutline" size="sm" disabled={acting} onClick={() => setRejectTarget(doc)}>
                驳回
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!rejectTarget} onOpenChange={(v) => { if (!v) setRejectTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div>
              <DialogTitle>驳回文档</DialogTitle>
              <DialogDescription className="mt-1">
                {rejectTarget?.title}
              </DialogDescription>
            </div>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="请填写驳回原因，将展示给提交人"
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={reject} disabled={acting}>
              {acting ? '提交中…' : '确认驳回'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
