import { ERROR_CATALOG, type ApiErrorCode } from './error-catalog';

export type ApiErrorKind =
  'network' | 'timeout' | 'http' | 'response' | 'validation' | 'business';

interface ErrorOptions {
  status?: number | null;
  kind?: ApiErrorKind;
  message?: string;
}

export class ApiError extends Error {
  readonly status: number | null;
  readonly kind: ApiErrorKind;
  readonly action;
  readonly retryable: boolean;

  constructor(
    readonly code: ApiErrorCode,
    options: ErrorOptions = {},
  ) {
    const definition = ERROR_CATALOG[code];
    super(options.message ?? definition.message);
    this.name = 'ApiError';
    this.status = options.status ?? null;
    this.kind = options.kind ?? 'business';
    this.action = definition.action;
    this.retryable = this.action === 'retry';
  }
}

// Pass only trusted local copy in options.message (e.g. the legacy whitelist below).
export function createApiError(code: ApiErrorCode, options: ErrorOptions = {}) {
  return new ApiError(code, options);
}

// Translate only recognized business messages. Unknown server text (including
// upstream errors, stack traces and HTML) must never become user-facing copy.
const BUSINESS_MESSAGES: Record<string, string> = {
  UPGRADE_MODEL_REVISION_REQUIRED:
    '请先配置 Embedding 和图谱模型的固定修订，再生成升级预览。',
  UPGRADE_CONFIG_MISMATCH:
    '当前配置与计划不一致。请恢复原配置，或重新生成预览。',
  UPGRADE_INVALID_TRANSITION: '批次状态已变化，请刷新后重试。',
  'file is required': ERROR_CATALOG.FILE_REQUIRED.message,
  'supported file types: pdf, xlsx, docx, pptx, txt, md':
    ERROR_CATALOG.FILE_UNSUPPORTED.message,
  'document parsing is not ready': ERROR_CATALOG.DOCUMENT_NOT_READY.message,
  'only draft or rejected documents can be submitted':
    '只有草稿或已驳回的文档可以提交审核，请刷新后确认文档状态。',
  'only pending documents can be reviewed':
    '这份文档已不在待审核状态，请刷新列表后查看。',
  'only pending documents can be published':
    '这份文档已不在待审核状态，请刷新后确认文档状态。',
  'only published documents can dispatch pipeline messages':
    '请先发布文档，再重新处理知识索引。',
  'reason is required when rejecting a document': '请填写驳回原因。',
  'question must be a string': '请输入文字问题。',
  'question must be longer than or equal to 1 characters': '请先输入你的问题。',
  'question must be shorter than or equal to 1000 characters':
    '问题最多支持 1000 个字符，请精简后再试。',
  'topK must be an integer number': '请选择有效的召回数量。',
  'topK must not be less than 1': '召回数量应在 1 到 10 之间，请重新选择。',
  'topK must not be greater than 10': '召回数量应在 1 到 10 之间，请重新选择。',
};

function knownBusinessMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return;
  const message = (body as { message?: unknown }).message;
  const messages = Array.isArray(message) ? message : [message];
  const translated = messages.map((item) =>
    typeof item === 'string' && Object.hasOwn(BUSINESS_MESSAGES, item)
      ? BUSINESS_MESSAGES[item]
      : undefined,
  );
  if (translated.length && translated.every(Boolean))
    return [...new Set(translated)].join(' ');
}

// Accept business codes only for their documented HTTP status. An internal
// failure must not be disguised as a correctable input error by its response body.
const INPUT_CODES = new Set<ApiErrorCode>([
  'FILE_REQUIRED',
  'FILE_UNSUPPORTED',
  'FILE_EMPTY',
  'VALIDATION_FAILED',
]);

export function httpError(
  status: number,
  body: unknown,
  login = false,
): ApiError {
  let code: ApiErrorCode;
  let message: string | undefined;
  switch (status) {
    case 400:
    case 422: {
      const serverCode =
        body && typeof body === 'object'
          ? (body as { code?: unknown }).code
          : undefined;
      code =
        typeof serverCode === 'string' &&
        INPUT_CODES.has(serverCode as ApiErrorCode)
          ? (serverCode as ApiErrorCode)
          : 'VALIDATION_FAILED';
      if (code === 'VALIDATION_FAILED') message = knownBusinessMessage(body);
      break;
    }
    case 401:
      code = login ? 'INVALID_CREDENTIALS' : 'AUTH_REQUIRED';
      break;
    case 403:
      code = 'FORBIDDEN';
      break;
    case 404:
      code = 'NOT_FOUND';
      break;
    case 409:
      code = 'CONFLICT';
      message = knownBusinessMessage(body);
      break;
    case 413:
      code = 'PAYLOAD_TOO_LARGE';
      break;
    case 415:
      code = 'UNSUPPORTED_MEDIA';
      break;
    case 408:
    case 504:
      code = 'REQUEST_TIMEOUT';
      break;
    case 429:
      code = 'RATE_LIMITED';
      break;
    default:
      code = status >= 500 ? 'SERVICE_UNAVAILABLE' : 'UNKNOWN_ERROR';
  }
  return createApiError(code, { status, kind: 'http', message });
}

export function requestFailure(error: unknown, operation?: 'upload') {
  let normalized =
    error instanceof ApiError ? error : createApiError('UNKNOWN_ERROR');
  // A lost response does not prove that this non-idempotent operation failed.
  if (
    operation === 'upload' &&
    (normalized.kind === 'network' ||
      normalized.kind === 'timeout' ||
      normalized.kind === 'response' ||
      normalized.code === 'UNKNOWN_ERROR' ||
      normalized.status === 408 ||
      (normalized.status !== null && normalized.status >= 500))
  )
    normalized = createApiError('UPLOAD_UNCONFIRMED', {
      status: normalized.status,
      kind: normalized.kind,
    });
  return {
    code: normalized.code,
    message: normalized.message,
    action: normalized.action,
    retryable: normalized.retryable,
  };
}

export type RequestFailureInfo = ReturnType<typeof requestFailure>;
