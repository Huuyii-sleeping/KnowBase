import { useRef, useState } from 'react';
import { KnowledgeGraphDiagram } from '@/components/knowledge-graph-diagram';
import { GraphPathPanel } from '@/components/graph-path-panel';
import { Button } from '@/components/ui/button';
import { graphScenarios, type GraphScenario } from './graph-fixtures';
import {
  runGraphEngineChecks,
  type GraphCheckResult,
} from './graph-engine-checks';
import '@/index.css';

export function GraphLab() {
  const [scenario, setScenario] = useState<GraphScenario>('complex');
  const [active, setActive] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<GraphCheckResult[]>([]);
  const probe = useRef<HTMLDivElement>(null);
  const fixture = graphScenarios[scenario];
  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">图谱组件实测</h1>
        <p className="text-sm text-muted-foreground">
          构造数据 · 真实 React 组件与 G6 画布 · 不连接后端，不写入知识库
        </p>
        <div className="flex flex-wrap gap-3">
          <select
            aria-label="测试场景"
            className="max-w-full rounded-lg border p-2 text-sm"
            value={scenario}
            onChange={(event) => {
              setScenario(event.target.value as GraphScenario);
              setActive(0);
            }}
          >
            {Object.entries(graphScenarios).map(([key, item]) => (
              <option key={key} value={key}>
                {item.label}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={() => setMounted(!mounted)}>
            {mounted ? '卸载组件' : '重新挂载组件'}
          </Button>
          <Button
            disabled={running}
            onClick={async () => {
              setResults([]);
              setRunning(true);
              try {
                await runGraphEngineChecks(probe.current!, (result) =>
                  setResults((items) => [...items, result]),
                );
              } finally {
                setRunning(false);
              }
            }}
          >
            {running ? '检查中…' : '运行真实引擎检查'}
          </Button>
        </div>
      </header>
      {mounted && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
          <KnowledgeGraphDiagram
            paths={fixture.paths}
            activePath={fixture.paths[active] ?? null}
            query="Knowbase"
          />
          <GraphPathPanel
            paths={fixture.paths}
            activeIndex={active}
            onSelect={setActive}
          />
        </div>
      )}
      <section
        className="rounded-xl border bg-white p-5"
        aria-label="引擎检查报告"
      >
        <h2 className="font-semibold">真实引擎检查报告</h2>
        <p role="status" className="my-2 text-sm">
          {running ? '执行中' : results.length ? '检查完成' : '尚未运行'} ·{' '}
          {results.filter((r) => r.passed).length} 通过 /{' '}
          {results.filter((r) => !r.passed).length} 失败
        </p>
        <ul className="space-y-1 text-xs">
          {results.map((r, i) => (
            <li
              key={i}
              className={r.passed ? 'text-primary' : 'text-destructive'}
            >
              {r.passed ? 'PASS' : 'FAIL'} {r.name} {r.detail}
            </li>
          ))}
        </ul>
        <div
          ref={probe}
          style={{ height: 610 }}
          className="mt-4 w-full overflow-hidden border"
          aria-label="引擎断言画布"
        />
      </section>
    </main>
  );
}
