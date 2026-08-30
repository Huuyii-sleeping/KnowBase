import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { GraphSearchPath } from './api';

type EntityGroup = 'seed' | 'document' | 'model' | 'queue' | 'database' | 'search' | 'platform' | 'concept' | 'other';

export interface KnowledgeGraphNodeData extends Record<string, unknown> {
  label: string;
  entityType: string;
  group: EntityGroup;
  depth: number;
  order: number;
  size: [number, number];
  pathCount: number;
  relationCount: number;
  isSeed: boolean;
  isActive: boolean;
  documentIds: string[];
}

export interface KnowledgeGraphEdgeData extends Record<string, unknown> {
  relationType: string;
  documentIds: string[];
  chunkIds: string[];
  relationIds: string[];
  isActive: boolean;
}

export interface KnowledgeGraphDataset {
  seedId: string;
  seedLabel: string;
  nodeCount: number;
  edgeCount: number;
  nodeOrder: string[];
  data: GraphData;
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function matchesFocus(entity: GraphSearchPath['entities'][number], focusQuery: string): boolean {
  const query = normalizeKey(focusQuery);
  if (!query) return false;
  return [entity.key, entity.name, entity.type].some((value) => normalizeKey(value).includes(query));
}

function classifyEntityGroup(type: string, name: string, isSeed: boolean): EntityGroup {
  if (isSeed) return 'seed';
  const text = `${type} ${name}`.toLowerCase();
  if (/document|文档|chunk|分块|markdown|正文/.test(text)) return 'document';
  if (/ollama|qwen|nomic|模型|llm/.test(text)) return 'model';
  if (/rabbitmq|消息|队列/.test(text)) return 'queue';
  if (/neo4j|图数据库|database|数据库/.test(text)) return 'database';
  if (/elasticsearch|搜索|检索/.test(text)) return 'search';
  if (/service|service|consumer|consumer|流程|pipeline|模块|系统|平台/.test(text)) return 'platform';
  if (/概念|术语|能力|关系|策略|方法|角色|地点|时间|制度/.test(text)) return 'concept';
  return 'other';
}

function estimateNodeSize(name: string, group: EntityGroup): [number, number] {
  const length = [...name].length;
  const width = Math.min(Math.max(128, length * 12 + 54), group === 'seed' ? 190 : 176);
  return [width, group === 'seed' ? 62 : 56];
}

function pickAnchor(paths: GraphSearchPath[], activePath: GraphSearchPath | null, focusQuery = '') {
  const candidates = [activePath, ...paths].filter((path): path is GraphSearchPath => Boolean(path));
  const focusedEntity = candidates.flatMap((path) => path.entities).find((entity) => matchesFocus(entity, focusQuery));
  return focusedEntity ?? activePath?.seed ?? paths[0]?.seed ?? null;
}

export function buildKnowledgeGraphData(paths: GraphSearchPath[], activePath: GraphSearchPath | null, focusQuery = ''): KnowledgeGraphDataset {
  const basePath = activePath ?? paths[0] ?? null;
  const seed = pickAnchor(paths, basePath, focusQuery);
  const seedId = seed?.key ?? '';
  const seedLabel = seed?.name ?? '';

  const nodeMap = new Map<
    string,
    NodeData & {
      id: string;
      type: 'rect';
      data: KnowledgeGraphNodeData;
      states: NodeData['states'];
    }
  >();
  const edgeMap = new Map<
    string,
    EdgeData & {
      data: KnowledgeGraphEdgeData;
      states: EdgeData['states'];
    }
  >();
  const relationCountByNode = new Map<string, number>();

  let order = 0;
  const activeEntityKeys = new Set(activePath?.entities.map((entity) => entity.key) ?? []);
  const activeRelationKeys = new Set(activePath?.relations.map((relation) => relation.key) ?? []);

  for (const path of paths) {
    const documentIds = uniqueSorted(path.relations.map((relation) => relation.documentId));
    const seedIndex = Math.max(0, path.entities.findIndex((entity) => entity.key === seedId));

    path.entities.forEach((entity, index) => {
      const existing = nodeMap.get(entity.key);
      const group = classifyEntityGroup(entity.type, entity.name, entity.key === seedId);
      const size = estimateNodeSize(entity.name, group);
      const nextDocumentIds = new Set(existing?.data.documentIds ?? []);
      documentIds.forEach((documentId) => nextDocumentIds.add(documentId));
      const depth = Math.abs(index - seedIndex);

      if (!existing) {
        nodeMap.set(entity.key, {
          id: entity.key,
          type: 'rect',
          data: {
            label: entity.name,
            entityType: entity.type,
            group,
            depth,
            order: order++,
            size,
            pathCount: 1,
            relationCount: 0,
            isSeed: entity.key === seedId,
            isActive: activeEntityKeys.has(entity.key),
            documentIds: [...nextDocumentIds],
          },
          states: activeEntityKeys.has(entity.key) ? ['active'] : [],
        });
        return;
      }

      existing.data.label = entity.name;
      existing.data.entityType = entity.type;
      existing.data.group = classifyEntityGroup(entity.type, entity.name, existing.data.isSeed || entity.key === seedId);
      existing.data.depth = Math.min(existing.data.depth, depth);
      existing.data.size = [
        Math.max(existing.data.size[0], size[0]),
        Math.max(existing.data.size[1], size[1]),
      ];
      existing.data.pathCount += 1;
      existing.data.isSeed = existing.data.isSeed || entity.key === seedId;
      existing.data.isActive = activeEntityKeys.has(entity.key);
      existing.data.documentIds = [...nextDocumentIds];
      existing.states = activeEntityKeys.has(entity.key) ? ['active'] : [];
    });

    path.relations.forEach((relation, index) => {
      const source = path.entities[index];
      const target = path.entities[index + 1];
      if (!source || !target) return;

      const edgeKey = `${source.key}::${target.key}::${normalizeKey(relation.type)}`;
      const existing = edgeMap.get(edgeKey);
      const nextDocumentIds = new Set(existing?.data.documentIds ?? []);
      const nextChunkIds = new Set(existing?.data.chunkIds ?? []);
      const nextRelationIds = new Set(existing?.data.relationIds ?? []);

      nextDocumentIds.add(relation.documentId);
      nextChunkIds.add(relation.chunkId);
      nextRelationIds.add(relation.key);
      relationCountByNode.set(source.key, (relationCountByNode.get(source.key) ?? 0) + 1);
      relationCountByNode.set(target.key, (relationCountByNode.get(target.key) ?? 0) + 1);

      const isActive = activeRelationKeys.has(relation.key) || existing?.data.isActive === true;
      edgeMap.set(edgeKey, {
        id: edgeKey,
        source: source.key,
        target: target.key,
        type: 'polyline',
        data: {
          relationType: relation.type,
          documentIds: [...nextDocumentIds],
          chunkIds: [...nextChunkIds],
          relationIds: [...nextRelationIds],
          isActive,
        },
        states: isActive ? ['active'] : [],
      });
    });
  }

  const nodes = [...nodeMap.values()].map((node) => ({
    id: node.id,
    type: node.type,
    data: {
      ...node.data,
      relationCount: relationCountByNode.get(node.id) ?? 0,
    },
    states: node.states,
  })).sort((a, b) => {
    const aData = a.data as KnowledgeGraphNodeData;
    const bData = b.data as KnowledgeGraphNodeData;
    return aData.depth - bData.depth
      || bData.pathCount - aData.pathCount
      || bData.relationCount - aData.relationCount
      || aData.order - bData.order;
  });

  const edges = [...edgeMap.values()].map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    data: edge.data,
    states: edge.states,
  }));

  return {
    seedId,
    seedLabel,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodeOrder: nodes.map((node) => String(node.id)),
    data: { nodes, edges },
  };
}
