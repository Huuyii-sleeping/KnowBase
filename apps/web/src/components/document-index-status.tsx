import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import {
  indexUpgradesApi,
  upgradeLabels,
  type BuildAttempt,
} from '@/lib/index-upgrades-api';
import { requestFailure } from '@/lib/api-error';
const stages: Record<string, string> = {
  preparing: '准备构建',
  content: '读取正文',
  chunk: '结构分块',
  embedding: '生成向量',
  graph_extract: '抽取图谱',
  index_write: '写入索引',
  activating: '激活索引',
  complete: '构建完成',
};
export function DocumentIndexStatus({
  documentId,
  version,
}: {
  documentId: string;
  version: number;
}) {
  const [attempts, setAttempts] = useState<BuildAttempt[] | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setAttempts(null);
    setError('');
  }, [documentId, version]);
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setAttempts((await indexUpgradesApi.status(documentId)).attempts);
    } catch (e) {
      setError(requestFailure(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mb-4 rounded-lg border border-border p-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">索引构建状态</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void load()}
        >
          {attempts ? '刷新状态' : '查看状态'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
      {attempts && (
        <div className="mt-2 space-y-1" aria-live="polite">
          {attempts.length === 0
            ? '暂无构建记录'
            : attempts.map((a) => (
                <p key={a.generation}>
                  {upgradeLabels[a.pipeline]} · v{a.version} ·{' '}
                  {a.currentVersion ? '当前版本' : '历史版本'} ·{' '}
                  {upgradeLabels[a.state] ?? a.state} ·{' '}
                  {stages[a.stage] ?? a.stage}
                  {a.total > 0 ? ` ${a.completed}/${a.total}` : ''}
                </p>
              ))}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        显示最近构建尝试；历史尝试的完成状态不代表当前版本可检索。
      </p>
    </section>
  );
}
