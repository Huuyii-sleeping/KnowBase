import { isMockEnabled } from './mock-api';
import { createApiError } from './api-error';
import { authStorage } from './api';
import { requestJson } from './http-request';
export type UpgradeAction = 'start' | 'pause' | 'resume' | 'cancel' | 'retry';
export interface UpgradePlan {
  id: string;
  state: string;
  target_hash: string;
  interval_ms: number;
  target: {
    chunkStrategy: string;
    embeddingFingerprint: string;
    graphFingerprint: string;
  };
}
export interface UpgradeTask {
  id: string;
  pipeline: string;
  state: string;
  eventId: string | null;
  generation: string | null;
  errorCode: string | null;
  active: boolean;
}
export interface UpgradeItem {
  id: string;
  document_id: string;
  title: string;
  version: number;
  classification: string;
  previous_strategy: string;
  tasks: UpgradeTask[];
}
export interface UpgradeSummary {
  plan: UpgradePlan;
  classifications: { classification: string; count: number }[];
  documents: { state: string; count: number }[];
  tasks: { pipeline: string; state: string; count: number }[];
  activeDocuments: number;
}
export interface BuildAttempt {
  generation: string;
  pipeline: string;
  version: number;
  state: string;
  stage: string;
  completed: number;
  total: number;
  currentVersion: boolean;
}
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (isMockEnabled())
    throw createApiError('SERVICE_UNAVAILABLE', {
      message: '演示模式不执行索引升级。请连接实际服务后查看或操作。',
    });
  const headers = new Headers(init.headers);
  const token = authStorage.getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return requestJson<T>(
    `/api/v1${path}`,
    { ...init, headers },
    authStorage.clear,
  );
}
export const indexUpgradesApi = {
  list: () => call<UpgradePlan[]>('/index-upgrades'),
  preview: (scope: {
    documentIds?: string[];
    status?: string;
    intervalMs: number;
  }) =>
    call<UpgradeSummary>('/index-upgrades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scope),
    }),
  summary: (id: string) => call<UpgradeSummary>(`/index-upgrades/${id}`),
  items: (id: string, after?: string) =>
    call<UpgradeItem[]>(
      `/index-upgrades/${id}/items?limit=50${after ? `&after=${after}` : ''}`,
    ),
  command: (id: string, action: UpgradeAction, taskId?: string) =>
    call<{ accepted: true }>(
      `/index-upgrades/${id}/${taskId ? `tasks/${taskId}/retry` : action}`,
      {
        method: 'POST',
      },
    ),
  attempts: (id: string, task: string) =>
    call<{ generation: string; state: string; error_code: string | null }[]>(
      `/index-upgrades/${id}/tasks/${task}/attempts`,
    ),
  status: (id: string) =>
    call<{ version: number; attempts: BuildAttempt[] }>(
      `/documents/${id}/index-status`,
    ),
};
export const upgradeLabels: Record<string, string> = {
  preparing: '正在生成预览',
  preview: '待启动',
  running: '执行中',
  paused: '已暂停',
  completed: '本轮已结束',
  cancelled: '已取消待投递项',
  preview_failed: '预览失败',
  pending: '待投递',
  dispatched: '已提交',
  succeeded: '已激活',
  failed: '失败',
  skipped: '已跳过',
  partial: '部分完成',
  activation_unknown: '激活结果待核实',
  rebuild: '可重建',
  needs_reparse: '需重新解析',
  missing_content: '缺少正文',
  unpublished: '未发布',
  unknown: '未知',
  interrupted: '已中断，等待恢复',
  search: '全文',
  rag: '向量',
  kg: '图谱',
};
export const upgradeErrors: Record<string, string> = {
  CONFIG_MISMATCH: '配置已变化，请恢复原配置或重新预览',
  BUILD_FAILED: '构建失败，可重试；详细诊断请查服务日志',
  ACTIVATION_UNKNOWN: '激活结果待核实，请重试核对',
  DOCUMENT_CHANGED_OR_DELETED: '文档已变更或删除，请重新预览',
  CONTENT_UNAVAILABLE_OR_REPARSE_REQUIRED: '正文不可用，请检查解析结果',
  DOCUMENT_CHANGED_DURING_BUILD: '构建期间版本发生变化',
  CANCELLED: '已取消待投递任务',
};
