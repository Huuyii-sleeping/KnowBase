import { useEffect, useRef, useState, type RefObject } from 'react';
import type { KnowledgeGraphDataset } from '@/lib/knowledge-graph-data';
import { createKnowledgeGraphRenderer } from '@/lib/knowledge-graph-renderer';
import type { GraphLayoutMode } from '@/lib/knowledge-graph-presentation';

export function useKnowledgeGraph(
  container: RefObject<HTMLDivElement | null>,
  dataset: KnowledgeGraphDataset,
  mode: GraphLayoutMode,
) {
  const renderer = useRef<ReturnType<
    typeof createKnowledgeGraphRenderer
  > | null>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    const session = createKnowledgeGraphRenderer(container.current, {
      onReady: (value) => {
        setZoom(value);
        setLoading(false);
      },
      onError: (message) => {
        setError(message);
        setLoading(false);
      },
      onSelect: setSelectedId,
    });
    renderer.current = session;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        void session.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      renderer.current = null;
      void session.destroy();
    };
  }, [container, attempt]);

  useEffect(() => {
    setError(null);
    setLoading(true);
    void renderer.current?.update(dataset, mode);
  }, [dataset, mode, attempt]);

  return {
    zoom,
    error,
    loading,
    selectedId,
    setSelectedId,
    zoomIn: () => void renderer.current?.zoom(1.2),
    zoomOut: () => void renderer.current?.zoom(1 / 1.2),
    fit: () => void renderer.current?.fit(),
    retry: () => setAttempt((value) => value + 1),
  };
}
