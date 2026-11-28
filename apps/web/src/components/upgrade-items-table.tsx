import { Link } from 'react-router-dom';
import {
  upgradeLabels as labels,
  upgradeErrors,
  type UpgradeItem,
  type UpgradeTask,
} from '@/lib/index-upgrades-api';
export function UpgradeItemsTable({
  items,
  busy,
  onInspect,
  canRetry,
  onRetry,
}: {
  items: UpgradeItem[];
  busy: boolean;
  onInspect: (task: UpgradeTask) => void;
  canRetry: boolean;
  onRetry: (task: UpgradeTask) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">文档 / 版本</th>
            <th className="p-2">预览分类 / 原策略</th>
            <th className="p-2">三条管线</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-border">
              <td className="p-2">
                <Link
                  className="text-primary underline"
                  to={`/documents/${item.document_id}`}
                >
                  {item.title}
                </Link>
                <div>v{item.version}</div>
              </td>
              <td className="p-2">
                {labels[item.classification]}
                <div className="text-xs">
                  {labels[item.previous_strategy] ?? item.previous_strategy}
                </div>
              </td>
              <td className="space-y-1 p-2">
                {item.tasks.map((t) => (
                  <div key={t.id}>
                    <button
                      className="underline"
                      disabled={busy}
                      onClick={() => onInspect(t)}
                    >
                      {labels[t.pipeline]}：{labels[t.state] ?? t.state}
                      {t.active ? '（当前有效）' : ''}
                    </button>
                    {canRetry &&
                      ['failed', 'activation_unknown'].includes(t.state) && (
                        <button
                          className="ml-3 text-primary underline"
                          disabled={busy}
                          onClick={() => onRetry(t)}
                        >
                          重试{labels[t.pipeline]}
                        </button>
                      )}
                    {t.errorCode && (
                      <p className="text-xs text-red-700">
                        {upgradeErrors[t.errorCode] ??
                          '处理异常，请查看服务日志'}
                      </p>
                    )}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
