import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { documentsApi, type DocumentDetail } from '@/lib/api';
import { requestFailure } from '@/lib/api-error';

const stages: Record<string, string> = {
  queued: '等待处理',
  reading: '读取原文件',
  submitting: '提交解析',
  uploading: '传输文件',
  'waiting-parser': '等待解析资源',
  parsing: '识别文档',
  normalizing: '整理正文与图片',
  saving: '保存解析结果',
  completed: '解析完成',
  needs_review: '正文需要人工确认',
  failed: '解析失败，可重试',
  canceled: '解析已取消',
  stale: '文档已修改，请重新解析',
};

export function DocumentParseProgress({
  document,
  onRefresh,
}: {
  document: DocumentDetail;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!document.ingestion) return null;
  const task = document.ingestion.task;
  const active = task && ['queued', 'running'].includes(task.state);
  const run = async (cancel: boolean) => {
    setBusy(true);
    setError('');
    try {
      if (cancel) await documentsApi.cancelParse(document.id);
      else await documentsApi.reparse(document.id);
      await onRefresh();
    } catch (failure) {
      setError(requestFailure(failure).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="mb-4 rounded-lg border border-border bg-background p-4 text-[13px]"
      aria-live="polite"
    >
      <p>
        {task
          ? (stages[task.stage] ?? '正在处理文档')
          : '可从保存的原文件重新解析正文'}
      </p>
      {document.ingestion.canManage && (
        <div className="mt-2 flex gap-2">
          {active ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(true)}
            >
              取消解析
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(false)}
            >
              从原文件重新解析
            </Button>
          )}
        </div>
      )}
      {!active && document.ingestion.canManage && (
        <p className="mt-2 text-muted-foreground">
          重新解析会替换当前正文，并需要重新审核发布。
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
