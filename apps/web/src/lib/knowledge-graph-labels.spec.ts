import { describe, expect, it, vi } from 'vitest';
import { GraphEvent, type RuntimeContext } from '@antv/g6';
import { ReadableGraphLabels } from './knowledge-graph-labels';

describe('readable graph labels', () => {
  it('uses absolute camera zoom after relative transforms and path redraws', () => {
    const setLocalScale = vi.fn();
    const handlers = new Map<string, () => void>();
    const graph = {
      on: vi.fn((event, handler) => handlers.set(event, handler)),
      off: vi.fn(),
      getZoom: vi.fn().mockReturnValue(0.5),
      getNodeData: () => [{ id: 'a' }],
      getEdgeData: () => [{ id: 'ab' }],
    };
    const context = {
      graph,
      element: { getElement: () => ({ getShape: () => ({ setLocalScale }) }) },
    };
    const behavior = new ReadableGraphLabels(
      context as unknown as RuntimeContext,
      { type: 'knowbase-readable-labels' },
    );
    handlers.get(GraphEvent.AFTER_TRANSFORM)!();
    expect(setLocalScale).toHaveBeenLastCalledWith(2);
    graph.getZoom.mockReturnValue(0.6);
    handlers.get(GraphEvent.AFTER_DRAW)!();
    expect(setLocalScale).toHaveBeenLastCalledWith(1 / 0.6);
    graph.getZoom.mockReturnValue(0);
    setLocalScale.mockClear();
    handlers.get(GraphEvent.AFTER_TRANSFORM)!();
    expect(setLocalScale).not.toHaveBeenCalled();
    behavior.destroy();
    expect(graph.off).toHaveBeenCalledTimes(2);
  });
});
