import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT,
  UPLOAD_FORMAT_LABEL,
  uploadResult,
  validateUploadFile,
} from './document-upload';

describe('document upload policy', () => {
  it.each([
    'pdf',
    'docx',
    'pptx',
    'xlsx',
    'txt',
    'md',
    'doc',
    'xls',
    'ppt',
    'html',
    'htm',
    'png',
    'jpg',
    'jpeg',
    'webp',
  ])(
    'accepts supported %s files regardless of case or MIME inference',
    (extension) => {
      expect(
        validateUploadFile({
          name: `知识库.${extension.toUpperCase()}`,
          size: 10,
        }),
      ).toBeNull();
      expect(UPLOAD_ACCEPT).toContain(`.${extension}`);
      expect(UPLOAD_FORMAT_LABEL).toContain(extension.toUpperCase());
    },
  );

  it.each([
    'archive.zip',
    'README',
    '.pdf',
    'report.pdf.exe',
    'recording.WAV',
    'recording.MP3',
    'recording.M4A',
    'recording.FLAC',
    'recording.OGG',
    'recording.MP4',
    'recording.MOV',
    'recording.WEBM',
    'recording.MKV',
  ])('rejects unsupported input: %s', (name) => {
    expect(validateUploadFile({ name, size: 10 })?.code).toBe(
      'FILE_UNSUPPORTED',
    );
  });

  it('checks missing, empty and oversized files, allowing exactly 100 MiB', () => {
    expect(validateUploadFile(null)?.code).toBe('FILE_REQUIRED');
    expect(validateUploadFile({ name: 'a.txt', size: 0 })?.code).toBe(
      'FILE_EMPTY',
    );
    expect(
      validateUploadFile({ name: 'a.txt', size: MAX_UPLOAD_BYTES + 1 })?.code,
    ).toBe('FILE_TOO_LARGE');
    expect(
      validateUploadFile({ name: 'a.txt', size: MAX_UPLOAD_BYTES }),
    ).toBeNull();
  });

  it('separates document creation from body parsing', () => {
    expect(uploadResult('READY').title).toContain('正文已就绪');
    expect(uploadResult('PENDING').title).toContain('正文尚未就绪');
    expect(uploadResult('FAILED').title).toContain('文件已保存');
    expect(uploadResult('FAILED').message).toContain('手动编辑正文');
    expect(uploadResult('FAILED').message).not.toContain('重试');
    expect(uploadResult('unknown' as 'PENDING').message).toContain(
      '无需再次上传',
    );
  });
});
