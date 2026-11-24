import { useState } from 'react';
import { Button } from '@/components/ui/button';
export function UpgradePreviewForm({
  busy,
  onPreview,
}: {
  busy: boolean;
  onPreview: (scope: {
    documentIds?: string[];
    status?: string;
    intervalMs: number;
  }) => Promise<void>;
}) {
  const [scope, setScope] = useState(''),
    [status, setStatus] = useState(''),
    [interval, setIntervalMs] = useState(1000);
  return (
    <form
      className="space-y-3 rounded-xl border border-border bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void onPreview({
          ...(scope.trim()
            ? { documentIds: scope.split(/[\s,，]+/).filter(Boolean) }
            : {}),
          ...(status ? { status } : {}),
          intervalMs: interval,
        });
      }}
    >
      <label className="block text-sm">
        文档 ID（用逗号或换行分隔，留空扫描文档库）
        <textarea
          className="mt-1 block w-full rounded border border-border p-2"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          发布状态
          <select
            className="ml-2 rounded border p-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">全部状态</option>
            <option value="PUBLISHED">已发布</option>
            <option value="DRAFT">草稿</option>
            <option value="PENDING_REVIEW">待审核</option>
            <option value="REJECTED">已驳回</option>
          </select>
        </label>
        <label className="text-sm">
          每条管线投递间隔（毫秒）
          <input
            className="ml-2 w-28 rounded border p-2"
            type="number"
            min={100}
            max={3600000}
            value={interval}
            onChange={(e) => setIntervalMs(Number(e.target.value))}
          />
        </label>
        <Button disabled={busy}>生成升级预览</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        预览不会启动构建；需重新解析的资料另行处理。暂停后已提交任务会继续完成。
      </p>
    </form>
  );
}
