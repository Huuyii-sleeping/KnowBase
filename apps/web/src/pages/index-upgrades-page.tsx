import { useCallback, useEffect, useState } from 'react';
import { UpgradePreviewForm } from '@/components/upgrade-preview-form';
import { UpgradeItemsTable } from '@/components/upgrade-items-table';
import { downloadUpgradeList } from '@/lib/upgrade-export';
import { Button } from '@/components/ui/button';
import {
  indexUpgradesApi as api,
  upgradeLabels as labels,
  type UpgradeAction,
  type UpgradeItem,
  type UpgradePlan,
  type UpgradeSummary,
} from '@/lib/index-upgrades-api';
import { requestFailure } from '@/lib/api-error';
export function IndexUpgradesPage() {
  const [plans, setPlans] = useState<UpgradePlan[]>([]),
    [summary, setSummary] = useState<UpgradeSummary | null>(null);
  const [items, setItems] = useState<UpgradeItem[]>([]),
    [cursor, setCursor] = useState<string | undefined>(),
    [more, setMore] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState('');
  const refreshPlans = useCallback(async () => setPlans(await api.list()), []);
  useEffect(() => {
    void refreshPlans().catch((e) => setError(requestFailure(e).message));
  }, [refreshPlans]);
  const open = async (id: string) => {
    const [next, page] = await Promise.all([api.summary(id), api.items(id)]);
    setSummary(next);
    setItems(page);
    setCursor(undefined);
    setMore(page.length === 50);
    setHistory('');
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(requestFailure(e).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (
      !summary ||
      !['running', 'paused', 'cancelled'].includes(summary.plan.state)
    )
      return;
    let stopped = false,
      inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [next, page] = await Promise.all([
          api.summary(summary.plan.id),
          api.items(summary.plan.id, cursor),
        ]);
        if (!stopped) {
          setSummary(next);
          setItems(page);
          setMore(page.length === 50);
        }
      } catch (e) {
        if (!stopped) setError(requestFailure(e).message);
      } finally {
        inFlight = false;
      }
    }, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [summary?.plan.id, summary?.plan.state, cursor]);
  const command = (action: UpgradeAction, taskId?: string) =>
    run(async () => {
      if (!summary) return;
      await api.command(summary.plan.id, action, taskId);
      await open(summary.plan.id);
      await refreshPlans();
    });
  const download = () =>
    run(async () => {
      if (!summary) return;
      await downloadUpgradeList(summary, (after) =>
        api.items(summary.plan.id, after),
      );
    });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">存量索引升级</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          从已保存正文重建全文、向量和图谱索引。先生成预览，再启动批次。
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <UpgradePreviewForm
        busy={busy}
        onPreview={(scope) =>
          run(async () => {
            const result = await api.preview(scope);
            await open(result.plan.id);
            await refreshPlans();
          })
        }
      />
      <label className="block text-sm">
        最近批次
        <select
          aria-label="选择升级批次"
          className="ml-2 max-w-full rounded border p-2"
          value={summary?.plan.id ?? ''}
          disabled={busy}
          onChange={(e) => {
            if (e.target.value) void run(() => open(e.target.value));
          }}
        >
          <option value="">选择批次</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} · {labels[p.state] ?? p.state}
            </option>
          ))}
        </select>
      </label>
      {summary && (
        <section
          className="space-y-4 rounded-xl border border-border bg-white p-5"
          aria-label="升级批次详情"
        >
          <h2 className="text-lg font-semibold">
            {labels[summary.plan.state] ?? summary.plan.state}
          </h2>
          <p className="break-all text-xs text-muted-foreground">
            目标：{summary.plan.target.chunkStrategy} · 配置指纹{' '}
            {summary.plan.target_hash}
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            {summary.classifications.map((c) => (
              <span key={c.classification}>
                {labels[c.classification]} {c.count}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-sm" aria-live="polite">
            {summary.documents.map((c) => (
              <span key={c.state}>
                {labels[c.state] ?? c.state} {c.count}
              </span>
            ))}
            <strong>当前三条索引均有效 {summary.activeDocuments}</strong>
          </div>
          <p className="text-xs text-muted-foreground">
            “已激活”记录本批次的构建结果；“当前均有效”还会核对现有文档版本和三条索引。提交成功仅表示任务已接受，本轮结束可能仍有失败项。
          </p>
          <div className="flex flex-wrap gap-2">
            {summary.plan.state === 'preview' && (
              <Button disabled={busy} onClick={() => void command('start')}>
                启动批次
              </Button>
            )}
            {summary.plan.state === 'running' && (
              <Button disabled={busy} onClick={() => void command('pause')}>
                暂停投递
              </Button>
            )}
            {summary.plan.state === 'paused' && (
              <Button disabled={busy} onClick={() => void command('resume')}>
                继续投递
              </Button>
            )}
            {['running', 'paused', 'completed'].includes(
              summary.plan.state,
            ) && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void command('retry')}
              >
                仅重试失败项
              </Button>
            )}
            {['preview', 'running', 'paused'].includes(summary.plan.state) && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void command('cancel')}
              >
                取消未投递项
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => open(summary.plan.id))}
            >
              刷新状态
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void download()}
            >
              导出清单
            </Button>
          </div>
          <UpgradeItemsTable
            items={items}
            busy={busy}
            canRetry={['running', 'paused', 'completed'].includes(
              summary.plan.state,
            )}
            onRetry={(task) => void command('retry', task.id)}
            onInspect={(task) =>
              void run(async () => {
                const attempts = await api.attempts(summary.plan.id, task.id);
                setHistory(
                  attempts
                    .map(
                      (a) =>
                        `${labels[task.pipeline]} · ${a.generation} · ${labels[a.state] ?? a.state}`,
                    )
                    .join('\n') || '暂无构建尝试',
                );
              })
            }
          />
          {more && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const after = items.at(-1)!.id;
                  const page = await api.items(summary.plan.id, after);
                  setItems(page);
                  setCursor(after);
                  setMore(page.length === 50);
                })
              }
            >
              下一页
            </Button>
          )}
          {history && (
            <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
              {history}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
