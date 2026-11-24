import type { Document } from '../../documents/entities/document.entity';
import type { IndexPipeline } from '../../indexing/index-generation.store';
export const UPGRADE_PIPELINES = ['search', 'rag', 'kg'] as const;
export type UpgradeClassification =
  'rebuild' | 'needs_reparse' | 'missing_content' | 'unpublished';
export interface UpgradeTarget {
  protocol: 'index-upgrade-v1';
  chunkStrategy: string;
  embeddingFingerprint: string;
  graphFingerprint: string;
  indexFingerprint: string;
  budgetFingerprint: string;
}
export interface UpgradePlan {
  id: string;
  state: string;
  target: UpgradeTarget;
  target_hash: string;
  interval_ms: number;
}
export interface UpgradeTask {
  id: string;
  pipeline: IndexPipeline;
  state: string;
  dispatch_id: string;
  event_id: string;
  generation: string | null;
  document_id: string;
  version: number;
  content_id: string;
  target_hash: string;
  plan_id: string;
}
export interface UpgradeSnapshot {
  document: Document;
  classification: UpgradeClassification;
  previousStrategy: string;
}
