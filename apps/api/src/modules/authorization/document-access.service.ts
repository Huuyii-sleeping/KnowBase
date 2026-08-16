import { ForbiddenException, Injectable } from '@nestjs/common';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Document, DocumentStatus } from '../documents/entities/document.entity';
import { AuthUser } from '../auth/auth.types';

export enum DocumentVisibility {
  PUBLIC = 'PUBLIC',
  TEAM = 'TEAM',
  PRIVATE = 'PRIVATE',
}

interface DocumentPermissionShape {
  visibility?: DocumentVisibility;
  userIds?: unknown;
  teams?: unknown;
}

@Injectable()
export class DocumentAccessService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
  ) {}

  canView(document: Document, user: AuthUser): boolean {
    if (user.role === 'ADMIN') return true;
    if (document.status !== DocumentStatus.PUBLISHED) {
      return document.uploaderId === user.id;
    }

    const policy = this.policy(document);
    if (document.uploaderId === user.id) return true;
    if (policy.userIds.includes(user.id)) return true;
    if (policy.visibility === 'PUBLIC') return true;
    return policy.visibility === 'TEAM'
      && Boolean(user.team)
      && (policy.teams.length === 0 || policy.teams.includes(user.team!))
      && document.team === user.team;
  }

  assertCanView(document: Document, user: AuthUser): void {
    if (!this.canView(document, user)) {
      throw new ForbiddenException('document is not accessible to current user');
    }
  }

  assertCanEdit(document: Document, user: AuthUser): void {
    if (user.role !== 'ADMIN' && document.uploaderId !== user.id) {
      throw new ForbiddenException('only the uploader or an admin can edit this document');
    }
  }

  assertCanReview(user: AuthUser): void {
    if (user.role !== 'ADMIN') throw new ForbiddenException('admin role required');
  }

  async assertCanViewStorageKey(storageKey: string, user: AuthUser): Promise<void> {
    const document = await this.documentRepository.findOne({ where: { storageKey } });
    if (document) {
      this.assertCanView(document, user);
      return;
    }
    const documentId = this.objectDocumentId(storageKey);
    const byId = documentId
      ? await this.documentRepository.findOne({ where: { id: documentId } })
      : null;
    if (!byId) throw new ForbiddenException('object is not accessible');
    this.assertCanView(byId, user);
  }

  applyVisibilityFilter(
    builder: SelectQueryBuilder<Document>,
    user: AuthUser,
    alias = 'document',
  ): void {
    if (user.role === 'ADMIN') return;

    builder.andWhere(new Brackets((where) => {
      where.where(`${alias}.uploader_id = :accessUserId`, { accessUserId: user.id })
        .orWhere(new Brackets((published) => {
          published.where(`${alias}.status = :publishedStatus`, {
            publishedStatus: DocumentStatus.PUBLISHED,
          }).andWhere(new Brackets((policy) => {
            policy.where(`${alias}.permissions->>'visibility' = 'PUBLIC'`)
              .orWhere(`${alias}.permissions->'userIds' ? :accessUserId`, {
                accessUserId: user.id,
              })
              .orWhere(new Brackets((team) => {
                team.where(`${alias}.permissions->>'visibility' = 'TEAM'`)
                  .andWhere(`${alias}.team = :accessTeam`, { accessTeam: user.team })
                  .andWhere(':accessTeam IS NOT NULL')
                  .andWhere(new Brackets((teams) => {
                    teams.where(`COALESCE(jsonb_array_length(${alias}.permissions->'teams'), 0) = 0`)
                      .orWhere(`${alias}.permissions->'teams' ? :accessTeam`, {
                        accessTeam: user.team ?? '',
                      });
                  }));
              }));
          }));
        }));
    }));
  }

  policy(document: Document): { visibility: DocumentVisibility; userIds: string[]; teams: string[] } {
    const raw = document.permissions as DocumentPermissionShape | null | undefined;
    const visibility: DocumentVisibility = raw?.visibility === DocumentVisibility.PUBLIC
      ? DocumentVisibility.PUBLIC
      : raw?.visibility === DocumentVisibility.TEAM
        ? DocumentVisibility.TEAM
        : DocumentVisibility.PRIVATE;
    return {
      visibility,
      userIds: this.stringArray(raw?.userIds),
      teams: this.stringArray(raw?.teams),
    };
  }

  objectDocumentId(storageKey: string): string | null {
    const match = storageKey.match(/^(?:original|assets)\/([0-9a-f-]{36})(?:\/|$)/i);
    return match?.[1] ?? null;
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  }
}
