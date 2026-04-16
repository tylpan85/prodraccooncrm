import type { AuthSession, ChangePasswordRequest, LoginRequest } from '@openclaw/shared';
import { apiFetch, apiItem } from './api-client';

export const authApi = {
  login: (body: LoginRequest) => apiItem<AuthSession>('/api/auth/login', { method: 'POST', body }),
  logout: () => apiFetch<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  me: () => apiItem<AuthSession>('/api/auth/me'),
  changePassword: (body: ChangePasswordRequest) =>
    apiFetch<{ ok: true }>('/api/auth/change-password', { method: 'POST', body }),
};
