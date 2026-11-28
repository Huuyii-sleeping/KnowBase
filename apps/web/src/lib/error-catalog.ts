export type ErrorAction =
  | 'edit_input'
  | 'login'
  | 'retry'
  | 'refresh'
  | 'contact_admin'
  | 'check_result';

// Codes and recovery actions are application contracts; server text is not UI copy.
export const ERROR_CATALOG = {
  FILE_REQUIRED: { message: '请先选择要上传的文件。', action: 'edit_input' },
  FILE_UNSUPPORTED: {
    message:
      '暂不支持这种文件格式，请上传 PDF、Word、Excel、PPT、HTML、TXT、MD 或 PNG/JPG/WebP 图片。',
    action: 'edit_input',
  },
  FILE_TOO_LARGE: {
    message: '文件不能超过 100 MB，请缩小后再上传。',
    action: 'edit_input',
  },
  FILE_EMPTY: {
    message: '文件内容为空，请选择有内容的文件。',
    action: 'edit_input',
  },
  VALIDATION_FAILED: {
    message: '提交的内容不符合要求，请检查后再试。',
    action: 'edit_input',
  },
  AUTH_REQUIRED: { message: '登录已失效，请重新登录后继续。', action: 'login' },
  INVALID_CREDENTIALS: {
    message: '账号或密码不正确，请重新输入。',
    action: 'edit_input',
  },
  FORBIDDEN: {
    message: '你没有执行此操作的权限，请联系管理员。',
    action: 'contact_admin',
  },
  NOT_FOUND: {
    message: '请求的内容不存在或已被移除，请刷新后再试。',
    action: 'refresh',
  },
  CONFLICT: {
    message: '内容状态已发生变化，请刷新后再操作。',
    action: 'refresh',
  },
  PAYLOAD_TOO_LARGE: {
    message: '文件或提交的内容过大，请缩小后再试。',
    action: 'edit_input',
  },
  UNSUPPORTED_MEDIA: {
    message: '暂不支持这种文件或内容格式，请更换后再试。',
    action: 'edit_input',
  },
  REQUEST_TIMEOUT: {
    message: '这次处理用时较长，请稍后重试。',
    action: 'retry',
  },
  RATE_LIMITED: { message: '操作有些频繁，请稍等片刻再试。', action: 'retry' },
  SERVICE_UNAVAILABLE: {
    message: '服务暂时无法完成处理，请稍后重试。',
    action: 'retry',
  },
  NETWORK_ERROR: {
    message: '无法连接服务，请检查网络连接后重试。',
    action: 'retry',
  },
  REQUEST_INTERRUPTED: { message: '这次请求已中断，请重试。', action: 'retry' },
  INVALID_RESPONSE: {
    message: '暂时无法读取处理结果，请稍后重试。',
    action: 'retry',
  },
  UNKNOWN_ERROR: {
    message: '暂时无法完成此操作，请稍后再试。',
    action: 'retry',
  },
  PAGE_LOAD_FAILED: {
    message: '页面暂时无法加载，请重新加载页面，或返回文档库后再试。',
    action: 'retry',
  },
  CONTENT_REQUIRED: {
    message: '正文不能为空，请填写后再保存。',
    action: 'edit_input',
  },
  DOCUMENT_NOT_READY: {
    message: '文档还未解析完成，请等待解析完成后再操作。',
    action: 'refresh',
  },
  GRAPH_RENDER_FAILED: {
    message: '关系图暂时无法显示，请重新加载画布。',
    action: 'retry',
  },
  DOCUMENT_PARSE_FAILED: {
    message:
      '文件已保存，但正文解析失败。请在文档详情中手动编辑正文，或检查文件后重新上传；正文就绪后才能提交审核。',
    action: 'edit_input',
  },
  UPLOAD_UNCONFIRMED: {
    message:
      '暂时无法确认上传结果，文档可能已创建。请先查看文档列表，确认没有同名新文档后再手动上传，以免重复创建。',
    action: 'check_result',
  },
} as const satisfies Record<string, { message: string; action: ErrorAction }>;

export type ApiErrorCode = keyof typeof ERROR_CATALOG;
