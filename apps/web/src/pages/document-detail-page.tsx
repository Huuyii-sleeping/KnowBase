import { DocumentParseReview } from '@/components/document-parse-review';
import { DocumentEvidencePanel } from '@/components/document-evidence-panel';
import { RequestFailure } from '@/components/request-failure';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
import { ParseBadge, StatusBadge } from '@/components/status-badges';
import { EditContentDialog } from '@/components/edit-content-dialog';
import { EditMetaDialog } from '@/components/edit-meta-dialog';
import { toast } from '@/components/toast';
import {
  createApiError,
  requestFailure,
  type RequestFailureInfo,
} from '@/lib/api-error';
import { documentsApi, type DocumentDetail } from '@/lib/api';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { DocumentParseProgress } from '@/components/document-parse-progress';

function MetaRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-[5px] text-[12.5px]">
      <span className="shrink-0 text-muted-foreground/70">{k}</span>
      <span className="break-all text-right">{v}</span>
    </div>
  );
}

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<RequestFailureInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [metaOpen, setMetaOpen] = useState(false);
  const [contentOpen, setContentOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setDoc(await documentsApi.detail(id));
    } catch (e) {
      setError(requestFailure(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (
      !id ||
      !doc?.ingestion ||
      !['queued', 'running'].includes(doc.ingestion.task?.state ?? '')
    )
      return;
    let stopped = false;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await documentsApi.detail(id);
        if (!stopped) setDoc(next);
      } catch {
        /* Keep the last readable state; explicit refresh remains available. */
      } finally {
        inFlight = false;
      }
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id, doc?.ingestion?.task?.state]);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setActing(true);
    try {
      await fn();
      toast(success);
      await load();
    } catch (e) {
      toast(requestFailure(e).message, 'error');
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="py-14 text-center text-[13px] text-muted-foreground/70">
        加载中…
      </div>
    );
  }
  if (error || !doc) {
    return (
      <div className="py-14 text-center text-[13px]">
        {error ? (
          <RequestFailure
            title="暂时无法加载文档"
            failure={error}
            onRetry={load}
            onRefresh={load}
          />
        ) : (
          <span>文档不存在</span>
        )}
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/documents')}
          >
            ‹ 返回列表
          </Button>
        </div>
      </div>
    );
  }

  const canEditContent =
    doc.status === 'DRAFT' ||
    doc.status === 'REJECTED' ||
    doc.status === 'PUBLISHED';
  const canSubmit =
    (doc.status === 'DRAFT' || doc.status === 'REJECTED') &&
    doc.parseStatus === 'READY';
  const canReview = doc.status === 'PENDING_REVIEW';

  return (
    <div>
      <div className="mb-7">
        <p className="eyebrow">Document details</p>
        <h1 className="flex flex-wrap items-center gap-2.5 break-all text-[26px] font-semibold tracking-tight">
          {doc.title}
          <StatusBadge status={doc.status} />
          <ParseBadge
            status={doc.parseStatus}
            needsReview={
              doc.parseStatus !== 'READY' &&
              (doc.content?.quality?.status === 'needs_review' ||
                doc.ingestion?.task?.state === 'needs_review')
            }
          />
        </h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/documents')}
          >
            ‹ 返回列表
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMetaOpen(true)}>
            编辑元数据
          </Button>
          {canEditContent && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setContentOpen(true)}
            >
              编辑正文
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_260px] items-start gap-6 max-lg:grid-cols-1">
        {doc.ingestion && (
          <div className="col-span-full">
            <DocumentParseProgress document={doc} onRefresh={load} />
            <DocumentParseReview
              key={doc.ingestion?.task?.id}
              document={doc}
              onRefresh={load}
            />
            {doc.content?.evidenceManifest && (
              <DocumentEvidencePanel document={doc} />
            )}
          </div>
        )}
        <div className="rounded-lg border border-border bg-background">
          <div className="px-4 pt-3 text-[12px] font-medium text-muted-foreground">
            正文预览
            {doc.content
              ? ` · ${doc.content.parser} · ${doc.content.characterCount} 字符`
              : ''}
          </div>
          {doc.parseStatus === 'READY' && doc.content ? (
            <div className="markdown-body overflow-x-auto px-5 pb-8 pt-4 sm:px-8">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {doc.content.markdown}
              </ReactMarkdown>
            </div>
          ) : doc.ingestion?.task?.state === 'needs_review' ? (
            <div className="mx-7 my-5 rounded-md bg-amber-50 px-4 py-3.5 text-[13px] text-amber-900">
              解析结果已保存为独立草稿，完成核对并采用后即可提交审核。
            </div>
          ) : doc.parseStatus === 'FAILED' ? (
            <div className="mx-7 my-5 rounded-md bg-red-50 px-4 py-3.5 text-[13px] text-red-700">
              {doc.content?.quality?.status === 'needs_review'
                ? '已提取正文，但存在缺页、无文本或无法识别的内容，请对照原文件检查并编辑正文后再提交审核。'
                : createApiError('DOCUMENT_PARSE_FAILED').message}
            </div>
          ) : (
            <div className="mx-7 my-5 rounded-md bg-sky-50 px-4 py-3.5 text-[13px] text-sky-800">
              文档正在解析中，完成后将在这里展示正文。
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-[76px]">
          <div className="rounded-lg border border-border bg-background">
            <div className="px-4 pt-3 text-[12px] font-medium text-muted-foreground">
              元信息
            </div>
            <div className="px-4 pb-3.5 pt-1">
              <MetaRow k="文件名" v={doc.fileName} />
              <MetaRow k="类型" v={doc.mimeType} />
              <MetaRow k="大小" v={formatBytes(doc.fileSize)} />
              <MetaRow k="版本" v={`v${doc.version}`} />
              <MetaRow k="上传人" v={doc.uploaderId} />
              <MetaRow k="分类" v={doc.category ?? '—'} />
              <MetaRow k="团队" v={doc.team ?? '—'} />
              <MetaRow
                k="标签"
                v={doc.tags.length ? doc.tags.join(', ') : '—'}
              />
              <MetaRow k="创建时间" v={formatDateTime(doc.createdAt)} />
              <MetaRow k="更新时间" v={formatRelative(doc.updatedAt)} />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background">
            <div className="px-4 pt-3 text-[12px] font-medium text-muted-foreground">
              审核信息
            </div>
            <div className="px-4 pb-3.5 pt-1">
              <MetaRow k="提交时间" v={formatDateTime(doc.submittedAt)} />
              <MetaRow k="审核人" v={doc.reviewedBy ?? '—'} />
              <MetaRow k="审核时间" v={formatDateTime(doc.reviewedAt)} />
            </div>
            {doc.status === 'REJECTED' && doc.rejectionReason && (
              <div className="mx-4 mb-3.5 rounded-md bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700">
                驳回原因:{doc.rejectionReason}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-background">
            <div className="px-4 pt-3 text-[12px] font-medium text-muted-foreground">
              操作
            </div>
            <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
              {(doc.status === 'DRAFT' || doc.status === 'REJECTED') && (
                <>
                  <Button
                    disabled={!canSubmit || acting}
                    onClick={() =>
                      act(() => documentsApi.submitReview(doc.id), '已提交审核')
                    }
                  >
                    提交审核
                  </Button>
                  <Button
                    variant="destructiveOutline"
                    disabled={acting}
                    onClick={() => {
                      if (
                        window.confirm(
                          `确认删除「${doc.title}」？该操作不可恢复。`,
                        )
                      ) {
                        void act(async () => {
                          await documentsApi.remove(doc.id);
                          navigate('/documents');
                        }, '已删除');
                      }
                    }}
                  >
                    删除文档
                  </Button>
                  {!canSubmit && (
                    <p className="text-[12px] text-muted-foreground/70">
                      仅解析状态为「就绪」的文档可提交审核
                    </p>
                  )}
                </>
              )}
              {canReview && (
                <>
                  <Button
                    variant="success"
                    disabled={acting}
                    onClick={() =>
                      act(
                        () => documentsApi.review(doc.id, true),
                        '已通过并发布',
                      )
                    }
                  >
                    通过并发布
                  </Button>
                  <Button
                    variant="destructiveOutline"
                    disabled={acting}
                    onClick={() => setRejectOpen(true)}
                  >
                    驳回
                  </Button>
                  <p className="text-[12px] text-muted-foreground/70">
                    审核操作将记录审核人与审核时间
                  </p>
                </>
              )}
              {doc.status === 'PUBLISHED' && (
                <p className="text-[12px] text-muted-foreground/70">
                  已发布文档可通过「编辑正文」产生新版本，版本号 +1 并回到草稿。
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <EditMetaDialog
        doc={doc}
        open={metaOpen}
        onOpenChange={setMetaOpen}
        onSaved={setDoc}
      />
      <EditContentDialog
        doc={doc}
        open={contentOpen}
        onOpenChange={setContentOpen}
        onSaved={setDoc}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div>
              <DialogTitle>驳回文档</DialogTitle>
              <DialogDescription className="mt-1">
                {doc.title}
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
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={acting}
              onClick={() =>
                act(async () => {
                  await documentsApi.review(
                    doc.id,
                    false,
                    rejectReason.trim() || undefined,
                  );
                  setRejectOpen(false);
                  setRejectReason('');
                }, '已驳回')
              }
            >
              {acting ? '提交中…' : '确认驳回'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
