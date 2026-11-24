import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Document } from '../../documents/entities/document.entity';
import type { UpgradeScope } from './upgrade-preview.service';
@Injectable()
export class UpgradeScanStore {
  constructor(private readonly source: DataSource) {}
  async boundary(): Promise<Date> {
    const [{ boundary }] = await this.source.query(
      'SELECT clock_timestamp() AS boundary',
    );
    return boundary;
  }
  page(
    boundary: Date,
    cursor: string | null,
    scope: UpgradeScope,
  ): Promise<Document[]> {
    const query = this.source
      .getRepository(Document)
      .createQueryBuilder('d')
      .where('d.createdAt <= :boundary', { boundary })
      .orderBy('d.id', 'ASC')
      .take(50);
    if (cursor) query.andWhere('d.id > :cursor', { cursor });
    if (scope.documentIds)
      query.andWhere('d.id IN (:...ids)', { ids: scope.documentIds });
    if (scope.status)
      query.andWhere('d.status = :status', { status: scope.status });
    return query.getMany();
  }
  async previousStrategy(document: Document): Promise<string> {
    const [previous] = await this.source.query(
      `SELECT p.target->>'chunkStrategy' AS strategy FROM kh_index_upgrade_task t
      JOIN kh_index_upgrade_item i ON i.id=t.item_id JOIN kh_index_upgrade_plan p ON p.id=i.plan_id
      JOIN kh_index_head h ON h.document_id=i.document_id AND h.pipeline='rag' AND h.generation=t.generation AND NOT h.deleted
      WHERE i.document_id=$1 AND i.version=$2 AND i.content_id=$3 AND t.pipeline='rag' AND t.state='succeeded' LIMIT 1`,
      [document.id, document.version, document.contentId],
    );
    return previous?.strategy ?? 'unknown';
  }
}
