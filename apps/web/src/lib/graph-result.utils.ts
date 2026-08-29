import type { GraphSearchPath } from './api';

export function getGraphPathDocumentIds(path: GraphSearchPath): string[] {
  return [...new Set(path.relations.map((relation) => relation.documentId).filter(Boolean))];
}

export function getGraphPathRelationCount(path: GraphSearchPath): number {
  return path.relations.length;
}

export function getGraphPathNodeCount(path: GraphSearchPath): number {
  return path.entities.length;
}

