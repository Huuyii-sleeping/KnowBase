import type { DocumentParseStatus } from './api';
import { createApiError } from './api-error';

export const UPLOAD_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.doc',
  '.xls',
  '.ppt',
  '.html',
  '.htm',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.md',
] as const;
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.join(',');
export const UPLOAD_FORMAT_LABEL = UPLOAD_EXTENSIONS.map((extension) =>
  extension.slice(1).toUpperCase(),
).join(' / ');
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function validateUploadFile(file: Pick<File, 'name' | 'size'> | null) {
  if (!file) return createApiError('FILE_REQUIRED', { kind: 'validation' });
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!UPLOAD_EXTENSIONS.some((supported) => supported === extension))
    return createApiError('FILE_UNSUPPORTED', { kind: 'validation' });
  if (file.size > MAX_UPLOAD_BYTES)
    return createApiError('FILE_TOO_LARGE', { kind: 'validation' });
  if (file.size <= 0)
    return createApiError('FILE_EMPTY', { kind: 'validation' });
  return null;
}

export function uploadResult(parseStatus: DocumentParseStatus) {
  switch (parseStatus) {
    case 'READY':
      return {
        title: '上传成功，正文已就绪',
        message: '文档已保存为草稿，可以查看正文并提交审核。',
      };
    case 'PENDING':
      return {
        title: '上传成功，正文尚未就绪',
        message:
          '文档已保存为草稿，正文尚未解析完成。请稍后在文档详情中刷新查看，或手动编辑正文；正文就绪后才能提交审核。',
      };
    case 'FAILED':
      return {
        title: '文件已保存，正文解析失败',
        message: createApiError('DOCUMENT_PARSE_FAILED').message,
      };
    default:
      return {
        title: '文件已保存，解析状态待确认',
        message: '请查看文档详情确认正文状态，无需再次上传。',
      };
  }
}
