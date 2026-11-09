export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'response';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: ApiErrorKind,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Translate only recognized business messages. Unknown server text (including
// upstream errors, stack traces and HTML) must never become user-facing copy.
const BUSINESS_MESSAGES: Record<string, string> = {
  'file is required': '请先选择要上传的文件。',
  'supported file types: pdf, xlsx, docx, pptx, txt, md':
    '暂不支持这种文件格式，请上传 PDF、Excel、Word、PPT、TXT 或 Markdown 文件。',
  'document parsing is not ready': '文档还未解析完成，请等待解析完成后再操作。',
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

export function httpError(
  status: number,
  body: unknown,
  login = false,
): ApiError {
  let message: string;
  switch (status) {
    case 400:
    case 422:
      message =
        knownBusinessMessage(body) ?? '提交的内容不符合要求，请检查后再试。';
      break;
    case 401:
      message = login
        ? '账号或密码不正确，请重新输入。'
        : '登录已失效，请重新登录后继续。';
      break;
    case 403:
      message = '你没有执行此操作的权限，请联系管理员。';
      break;
    case 404:
      message = '请求的内容不存在或已被移除，请刷新后再试。';
      break;
    case 409:
      message = '内容状态已发生变化，请刷新后再操作。';
      break;
    case 413:
      message = '文件或提交的内容过大，请缩小后再试。';
      break;
    case 415:
      message = '暂不支持这种文件或内容格式，请更换后再试。';
      break;
    case 408:
    case 504:
      message = '这次处理用时较长，请稍后重试。';
      break;
    case 429:
      message = '操作有些频繁，请稍等片刻再试。';
      break;
    default:
      message =
        status >= 500
          ? '服务暂时无法完成处理，请稍后重试。'
          : '暂时无法完成此操作，请稍后再试。';
  }
  return new ApiError(
    message,
    status,
    'http',
    status === 408 || status === 429 || status >= 500,
  );
}

export function requestFailure(error: unknown) {
  return error instanceof ApiError
    ? { message: error.message, retryable: error.retryable }
    : { message: '暂时无法完成此操作，请稍后再试。', retryable: true };
}
