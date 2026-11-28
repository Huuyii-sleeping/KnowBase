import { describe, expect, it } from 'vitest';
import {
  getGraphEdgeStyle,
  getGraphNodeStyle,
  getGraphPalette,
  getGraphTopologyKey,
  makeGraphLayout,
} from './knowledge-graph-presentation';

describe('knowledge graph presentation', () => {
  it('keeps entity names readable and query nodes recognizable', () => {
    const seed = getGraphNodeStyle({
      id: 'mq',
      data: { label: 'RabbitMQ', group: 'seed', isSeed: true },
    });
    expect(seed.iconText).toBe('MQ');
    expect(seed.size).toBe(80);
    expect(seed.labelText).toBe('RabbitMQ');
    expect(seed.labelPlacement).toBe('bottom');
    expect(getGraphNodeStyle({ id: 'unknown' }).size).toBe(64);
    expect(getGraphPalette('unknown')).toEqual(getGraphPalette('other'));
  });
  it('labels directed relations and distinguishes the selected path', () => {
    const edge = {
      id: 'r1',
      source: 'a',
      target: 'b',
      data: { relationType: '依赖' },
    };
    expect(getGraphEdgeStyle(edge).endArrow).toBe(true);
    expect(getGraphEdgeStyle(edge).labelText).toBe('依赖');
    expect(getGraphEdgeStyle(edge).stroke).not.toBe(
      getGraphEdgeStyle({ ...edge, data: { ...edge.data, isActive: true } })
        .stroke,
    );
  });
  it('ignores path highlight and input order in the layout identity', () => {
    const nodes = [{ id: 'a', data: { isActive: true } }, { id: 'b' }];
    const edges = [{ id: 'r1', source: 'a', target: 'b' }];
    expect(getGraphTopologyKey(nodes, edges, 'a', 'network')).toBe(
      getGraphTopologyKey([...nodes].reverse(), edges, 'a', 'network'),
    );
    expect(getGraphTopologyKey(nodes, edges, 'a', 'network')).not.toBe(
      getGraphTopologyKey(nodes, edges, 'b', 'network'),
    );
    expect(makeGraphLayout('network', 'a')).toMatchObject({ type: 'd3-force' });
    expect(makeGraphLayout('flow', 'a')).toMatchObject({ type: 'antv-dagre' });
  });
});
