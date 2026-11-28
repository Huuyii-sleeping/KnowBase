import { Injectable } from '@nestjs/common';
import {
  IndexPipeline,
  IndexGenerationStore,
} from '../../indexing/index-generation.store';
import { DocumentContentStore } from '../../documents/document-content.store';
import { UpgradePolicyService } from './upgrade-policy.service';
import { UpgradeExecutionStore } from './upgrade-execution.store';
import { RagPipelineService } from '../rag/rag-pipeline.service';
import { KgPipelineService } from '../kg/kg-pipeline.service';
import { SearchPipelineService } from '../search/search-pipeline.service';
import { IndexBuildOptions } from '../../indexing/index-build-options';
import { classifyUpgrade } from './upgrade-preview.service';
@Injectable()
export class UpgradeRunnerService {
  constructor(
    private readonly store: UpgradeExecutionStore,
    private readonly policy: UpgradePolicyService,
    private readonly generations: IndexGenerationStore,
    private readonly content: DocumentContentStore,
    private readonly search: SearchPipelineService,
    private readonly rag: RagPipelineService,
    private readonly kg: KgPipelineService,
  ) {}
  async run(
    message: { taskId: string; dispatchId: string },
    pipeline: IndexPipeline,
  ): Promise<void> {
    const task = await this.store.claim(
      message.taskId,
      message.dispatchId,
      pipeline,
    );
    if (!task) return;
    let unknown = false;
    try {
      if (!this.policy.matches(task.target_hash)) {
        await this.store.finish(task, 'failed', 'CONFIG_MISMATCH');
        return;
      }
      const document = await this.generations.capture(
        task.document_id,
        task.version,
      );
      if (!document || document.contentId !== task.content_id) {
        await this.store.finish(task, 'skipped', 'DOCUMENT_CHANGED_OR_DELETED');
        return;
      }
      const body = await this.content.findByContentId(task.content_id);
      if (classifyUpgrade(document, body) !== 'rebuild') {
        await this.store.finish(
          task,
          'skipped',
          'CONTENT_UNAVAILABLE_OR_REPARSE_REQUIRED',
        );
        return;
      }
      const options: IndexBuildOptions = {
        generation: task.generation!,
        contentId: task.content_id,
        onActivated: (manager) => this.store.activated(manager, task),
        onActivationUnknown: () => {
          unknown = true;
        },
      };
      if (pipeline === 'search')
        await this.search.indexDocument(
          {
            type: 'DOCUMENT_INDEX',
            documentId: document.id,
            version: document.version,
            metadata: { ...document },
            markdown: body!.markdown,
          },
          options,
        );
      else if (pipeline === 'rag')
        await this.rag.rebuildDocument(document.id, document.version, options);
      else
        await this.kg.rebuildDocument(document.id, document.version, options);
      // No-op if activation already committed with the caller ledger.
      await this.store.finish(task, 'skipped', 'DOCUMENT_CHANGED_DURING_BUILD');
    } catch {
      const code = unknown ? 'ACTIVATION_UNKNOWN' : 'BUILD_FAILED';
      await this.store.finish(
        task,
        unknown ? 'activation_unknown' : 'failed',
        code,
      );
      // The shared delivery protocol owns bounded automatic retry/dead-lettering.
      throw new Error(code);
    }
  }
}
