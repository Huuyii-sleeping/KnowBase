import type { EntityManager } from 'typeorm';
/** An optional durable caller ledger commits with the generation head. */
export interface IndexBuildOptions {
  generation: string;
  contentId: string;
  onActivated: (manager: EntityManager) => Promise<void>;
  onActivationUnknown?: () => void;
}
