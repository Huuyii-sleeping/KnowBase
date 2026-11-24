import { useEffect, useState } from 'react';
import {
  documentsApi,
  type DocumentDetail,
  type DocumentEvidence,
  type EvidencePage,
} from '@/lib/api';
import { requestFailure } from '@/lib/api-error';
import { Button } from './ui/button';
import { DocumentResource } from './document-resource';

function EvidenceItem({
  unit,
  onLocate,
}: {
  unit: DocumentEvidence;
  onLocate: () => void;
}) {
  const source = unit.source;
  const cells = Array.isArray(unit.data.cells)
    ? (unit.data.cells as Array<Record<string, unknown>>)
    : [];
  return (
    <article className="my-3 rounded border p-3 text-sm">
      <p>
        {unit.kind} ·{' '}
        {source.sheet ??
          (source.page
            ? `第 ${source.page} 页`
            : source.slide
              ? `第 ${source.slide} 张`
              : '')}{' '}
        {source.cellRange ??
          (source.rowStart ? `表内行 ${source.rowStart}` : '')}{' '}
        {source.startMs !== undefined
          ? `${source.startMs / 1000}–${(source.endMs ?? source.startMs) / 1000} 秒`
          : ''}
      </p>
      <Button variant="outline" size="sm" onClick={onLocate}>
        定位原件
      </Button>
      <p className="whitespace-pre-wrap">{unit.text}</p>
      {cells.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>位置</th>
                <th>原始值 / 文本</th>
                <th>合并或公式</th>
                <th>缓存结果</th>
              </tr>
            </thead>
            <tbody>
              {cells.map((cell, i) => (
                <tr key={i}>
                  <td>
                    {String(cell.address ?? `${cell.row}:${cell.column}`)}
                  </td>
                  <td>
                    {typeof cell.value === 'object'
                      ? JSON.stringify(cell.value)
                      : String(cell.value ?? cell.text ?? '')}
                  </td>
                  <td>
                    {String(
                      cell.formula ??
                        cell.coveredBy ??
                        (Number(cell.rowSpan) > 1 || Number(cell.columnSpan) > 1
                          ? `${cell.rowSpan}×${cell.columnSpan}`
                          : ''),
                    )}
                  </td>
                  <td>
                    {cell.hasCachedResult === false
                      ? '缺失，待确认'
                      : String(cell.cachedResult ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unit.objectKeys.map((key) => (
        <EvidenceResource key={key} objectKey={key} unit={unit} />
      ))}
      <details>
        <summary>来源与解析数据</summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(
            { source, producer: unit.producer, data: unit.data },
            null,
            2,
          )}
        </pre>
      </details>
    </article>
  );
}

function EvidenceResource({
  objectKey,
  unit,
}: {
  objectKey: string;
  unit: DocumentEvidence;
}) {
  const [open, setOpen] = useState(false);
  const mime =
    typeof unit.data.mediaType === 'string'
      ? unit.data.mediaType
      : /\.(png|jpg|jpeg|webp)$/i.test(objectKey)
        ? `image/${objectKey.split('.').pop()}`
        : 'application/octet-stream';
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>查看关联原始资源</summary>
      {open && (
        <DocumentResource
          objectKey={objectKey}
          mimeType={mime}
          startMs={unit.source.startMs}
          label="证据资源"
        />
      )}
    </details>
  );
}

export function DocumentEvidencePanel({
  document,
  taskId,
}: {
  document: DocumentDetail;
  taskId?: string;
}) {
  const [selected, setSelected] = useState<DocumentEvidence | null>(null);
  const [opened, setOpened] = useState(false),
    [offset, setOffset] = useState(0);
  const [result, setResult] = useState<EvidencePage | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (!opened) return;
    let stopped = false;
    setResult(null);
    setError('');
    void documentsApi
      .evidence(document.id, offset, taskId)
      .then((page) => {
        if (!stopped) setResult(page);
      })
      .catch((error) => {
        if (!stopped) setError(requestFailure(error).message);
      });
    return () => {
      stopped = true;
    };
  }, [document.id, document.contentId, opened, offset, taskId]);
  return (
    <section className="my-4 rounded border p-4">
      <Button variant="outline" size="sm" onClick={() => setOpened(!opened)}>
        {opened ? '收起解析核对' : '查看原件与解析证据'}
      </Button>
      {opened && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <h3>原文件</h3>
            <DocumentResource
              objectKey={document.storageKey}
              mimeType={document.mimeType}
              page={selected?.source.page}
              startMs={
                selected?.data.originalTimelineReliable === false
                  ? undefined
                  : selected?.source.startMs === undefined
                    ? undefined
                    : selected.source.startMs +
                      (typeof selected.data.originalStartMs === 'number'
                        ? selected.data.originalStartMs
                        : 0)
              }
            />
          </div>
          <div>
            <h3>解析证据</h3>
            {error && <p role="alert">{error}</p>}
            {!result && !error && <p>加载证据…</p>}
            {result && (
              <>
                <p>共 {result.total} 条</p>
                {result.items.map((unit) => (
                  <EvidenceItem
                    key={unit.id}
                    unit={unit}
                    onLocate={() => setSelected(unit)}
                  />
                ))}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - 20))}
                  >
                    上一页
                  </Button>
                  <Button
                    size="sm"
                    disabled={offset + 20 >= result.total}
                    onClick={() => setOffset(offset + 20)}
                  >
                    下一页
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
