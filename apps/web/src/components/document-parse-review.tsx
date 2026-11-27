import { useEffect, useRef, useState } from 'react';
import { documentsApi, type DocumentDetail, type ParseDraft } from '@/lib/api';
import { requestFailure } from '@/lib/api-error';
import { Button } from './ui/button';
import { OcrReviewNotice } from './ocr-review-notice';
import { DocumentEvidencePanel } from './document-evidence-panel';

export function DocumentParseReview({
  document,
  onRefresh,
}: {
  document: DocumentDetail;
  onRefresh: () => Promise<void>;
}) {
  const task = document.ingestion?.task;
  if (!document.ingestion?.canManage || !task?.hasDraft || !task.id)
    return null;
  return (
    <ParseReviewSession
      key={`${document.id}:${task.id}`}
      document={document}
      taskId={task.id}
      onRefresh={onRefresh}
    />
  );
}

/** Acknowledgment applies only to the candidate that was actually displayed. */
function ParseReviewSession({
  document,
  taskId,
  onRefresh,
}: {
  document: DocumentDetail;
  taskId: string;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ParseDraft | null>(null),
    [note, setNote] = useState(''),
    [acknowledged, setAcknowledged] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const run = async (accept?: boolean) => {
    setBusy(true);
    setError('');
    try {
      if (accept === undefined) {
        const loaded = await documentsApi.draft(document.id, taskId);
        if (active.current) setDraft(loaded);
      } else {
        await documentsApi.reviewParse(
          document.id,
          taskId,
          accept,
          acknowledged,
          note,
        );
        if (active.current) {
          setDraft(null);
          await onRefresh();
        }
      }
    } catch (error) {
      if (active.current) setError(requestFailure(error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <section className="mb-4 rounded border border-amber-300 p-4 text-sm">
      <p>
        {document.content
          ? '有新的解析草稿等待核对，当前已采用正文保持可用。'
          : '已提取解析草稿，核对后可采用为正文。'}
      </p>
      {!draft && (
        <Button size="sm" disabled={busy} onClick={() => void run()}>
          核对解析草稿
        </Button>
      )}
      {draft && (
        <>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <h3>当前已采用正文</h3>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap">
                {document.content?.markdown ?? '尚无已采用正文'}
              </pre>
            </div>
            <div>
              <h3>新解析草稿</h3>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap">
                {draft.markdown}
              </pre>
            </div>
          </div>
          <OcrReviewNotice />
          <DocumentEvidencePanel document={document} taskId={taskId} />
          {(draft.quality?.issues ?? []).map((issue, i) => (
            <p key={i}>
              {issue.code}
              {issue.page ? ` · 第 ${issue.page} 页` : ''}：{issue.message}
            </p>
          ))}
          {draft.ready !== true && (
            <label className="my-2 block">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />{' '}
              我已对照原件核对上述质量问题
            </label>
          )}
          <label className="block">
            核对说明
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              className="my-2 block w-full rounded border p-2"
            />
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={
                busy ||
                note.trim().length < 3 ||
                (draft.ready !== true && !acknowledged)
              }
              onClick={() => void run(true)}
            >
              采用草稿，待提交审核
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || note.trim().length < 3}
              onClick={() => void run(false)}
            >
              放弃草稿
            </Button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
