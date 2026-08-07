import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DocumentStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  PUBLISHED = 'PUBLISHED',
  REJECTED = 'REJECTED',
}

export enum DocumentParseStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  FAILED = 'FAILED',
}

@Entity({ name: 'kh_document' })
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  title!: string;

  @Column({ name: 'file_name', length: 512 })
  fileName!: string;

  @Column({ name: 'mime_type', length: 255 })
  mimeType!: string;

  @Column({ name: 'file_size', type: 'bigint', default: 0 })
  fileSize!: number;

  @Column({ name: 'storage_key', length: 1024, unique: true })
  storageKey!: string;

  @Column({ name: 'content_id', type: 'uuid' })
  contentId!: string;

  @Column({ name: 'uploader_id', length: 128 })
  uploaderId!: string;

  @Column({ length: 128, nullable: true })
  category!: string | null;

  @Column({ length: 128, nullable: true })
  team!: string | null;

  @Column('text', { array: true, default: '{}' })
  tags!: string[];

  @Column({
    type: 'enum',
    enum: DocumentStatus,
    enumName: 'kh_document_status_enum',
    default: DocumentStatus.DRAFT,
  })
  status!: DocumentStatus;

  @Column({
    name: 'parse_status',
    type: 'enum',
    enum: DocumentParseStatus,
    enumName: 'kh_document_parse_status_enum',
    default: DocumentParseStatus.PENDING,
  })
  parseStatus!: DocumentParseStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ default: 1 })
  version!: number;

  @Column({ type: 'jsonb', default: {} })
  permissions!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: { viewCount: 0, queryCount: 0 } })
  statistics!: Record<string, number>;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'reviewed_by', length: 128, nullable: true })
  reviewedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
