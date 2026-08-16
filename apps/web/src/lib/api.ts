/**
 * Knowbase 文档模块 API 客户端。
 * 与 apps/api 的 NestJS 接口契约对齐（全局前缀 /api/v1）。
 *
 */

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'MEMBER';
  team: string | null;
}

const AUTH_TOKEN_KEY = 'knowbase-access-token';
const AUTH_USER_KEY = 'knowbase-auth-user';

export const authStorage = {
  getToken: () => sessionStorage.getItem(AUTH_TOKEN_KEY),
  getUser: (): AuthUser | null => {
    const raw = sessionStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      authStorage.clear();
      return null;
    }
  },
  set: (auth: { accessToken: string; user: AuthUser }) => {
    sessionStorage.setItem(AUTH_TOKEN_KEY, auth.accessToken);
    sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(auth.user));
    window.dispatchEvent(new Event('knowbase-auth-changed'));
  },
  clear: () => {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
    window.dispatchEvent(new Event('knowbase-auth-changed'));
  },
  subscribe: (listener: () => void) => {
    window.addEventListener('knowbase-auth-changed', listener);
    return () => window.removeEventListener('knowbase-auth-changed', listener);
  },
};

export const CURRENT_USER_ID = authStorage.getUser()?.id ?? 'anonymous';

export type DocumentStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED';
export type DocumentParseStatus = 'PENDING' | 'READY' | 'FAILED';

export interface DocumentMeta {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  contentId: string;
  uploaderId: string;
  category: string | null;
  team: string | null;
  tags: string[];
  status: DocumentStatus;
  parseStatus: DocumentParseStatus;
  parseError: string | null;
  rejectionReason: string | null;
  version: number;
  permissions: Record<string, unknown>;
  statistics: Record<string, number>;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentContent {
  contentId: string;
  markdown: string;
  parser: string;
  warnings: string[];
  version: number;
  assets: unknown[];
  characterCount: number;
}

export interface DocumentDetail extends DocumentMeta {
  content?: DocumentContent;
}

export interface DocumentListResult {
  items: DocumentMeta[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ListDocumentsQuery {
  keyword?: string;
  status?: DocumentStatus;
  category?: string;
  page?: number;
  pageSize?: number;
}

const BASE = '/api/v1';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = authStorage.getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    if (res.status === 401) authStorage.clear();
    let message = `请求失败（${res.status}）`;
    try {
      const body = await res.json();
      if (body?.message) {
        message = Array.isArray(body.message) ? body.message.join('；') : body.message;
      }
    } catch {
      // 保留默认错误信息
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const httpDocumentsApi = {
  list(query: ListDocumentsQuery = {}): Promise<DocumentListResult> {
    const params = new URLSearchParams();
    if (query.keyword) params.set('keyword', query.keyword);
    if (query.status) params.set('status', query.status);
    if (query.category) params.set('category', query.category);
    params.set('page', String(query.page ?? 1));
    params.set('pageSize', String(query.pageSize ?? 20));
    return request(`/documents?${params.toString()}`);
  },

  detail(id: string): Promise<DocumentDetail> {
    return request(`/documents/${id}`);
  },

  create(file: File, meta: { title?: string; category?: string; team?: string; tags?: string[]; visibility?: string }): Promise<DocumentDetail> {
    const form = new FormData();
    form.append('file', file);
    if (meta.title) form.append('title', meta.title);
    if (meta.category) form.append('category', meta.category);
    if (meta.team) form.append('team', meta.team);
    if (meta.tags?.length) form.append('tags', meta.tags.join(','));
    if (meta.visibility) form.append('visibility', meta.visibility);
    return request('/documents', { method: 'POST', body: form });
  },

  update(id: string, meta: { title?: string; category?: string; team?: string; tags?: string[]; visibility?: string }): Promise<DocumentDetail> {
    const body: Record<string, string> = {};
    if (meta.title !== undefined) body.title = meta.title;
    if (meta.category !== undefined) body.category = meta.category;
    if (meta.team !== undefined) body.team = meta.team;
    if (meta.tags !== undefined) body.tags = meta.tags.join(',');
    if (meta.visibility !== undefined) body.visibility = meta.visibility;
    return request(`/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  updateContent(id: string, markdown: string): Promise<DocumentDetail> {
    return request(`/documents/${id}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });
  },

  submitReview(id: string): Promise<DocumentDetail> {
    return request(`/documents/${id}/submit-review`, { method: 'POST' });
  },

  review(id: string, approved: boolean, reason?: string): Promise<DocumentDetail> {
    return request(`/documents/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, ...(reason ? { reason } : {}) }),
    });
  },

  remove(id: string): Promise<void> {
    return request(`/documents/${id}`, { method: 'DELETE' });
  },
};

// Mock 模式（?mock=1 开启）下使用内存数据源，便于无后端环境演示。
import { isMockEnabled, mockDocumentsApi } from './mock-api';

export const documentsApi = isMockEnabled() ? mockDocumentsApi : httpDocumentsApi;

export const authApi = {
  async login(username: string, password: string) {
    const auth = await request<{ accessToken: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    authStorage.set(auth);
    return auth;
  },
  me() {
    return request<AuthUser>('/auth/me');
  },
  logout() {
    authStorage.clear();
  },
};
