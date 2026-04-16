import type {
  CreateCustomerRequest,
  CustomerDto,
  CustomerSummaryDto,
  DuplicateMatchDto,
  UpdateCustomerRequest,
} from '@openclaw/shared';
import { apiFetch, apiItem, apiItems } from './api-client';

export interface ListCustomersParams {
  q?: string;
  cursor?: string | null;
  limit?: number;
}

function listQuery(params: ListCustomersParams): string {
  const sp = new URLSearchParams();
  if (params.q && params.q.trim().length > 0) sp.set('q', params.q.trim());
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.limit) sp.set('limit', String(params.limit));
  const s = sp.toString();
  return s.length > 0 ? `?${s}` : '';
}

export interface SearchDuplicatesParams {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  city?: string;
  zip?: string;
}

function dupQuery(params: SearchDuplicatesParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v.trim().length > 0) sp.set(k, v.trim());
  }
  const s = sp.toString();
  return s.length > 0 ? `?${s}` : '';
}

export const customersApi = {
  list: (params: ListCustomersParams = {}) =>
    apiItems<CustomerSummaryDto>(`/api/customers${listQuery(params)}`),
  get: (id: string) => apiItem<CustomerDto>(`/api/customers/${id}`),
  create: (body: CreateCustomerRequest) =>
    apiItem<CustomerDto>('/api/customers', { method: 'POST', body }),
  update: (id: string, body: UpdateCustomerRequest) =>
    apiItem<CustomerDto>(`/api/customers/${id}`, { method: 'PATCH', body }),
  searchDuplicates: (params: SearchDuplicatesParams) =>
    apiItems<DuplicateMatchDto>(`/api/customers/search-duplicates${dupQuery(params)}`),
  listJobs: (id: string) =>
    apiFetch<{ items: unknown[]; nextCursor: string | null }>(`/api/customers/${id}/jobs`),
  listInvoices: (id: string) =>
    apiFetch<{ items: unknown[]; nextCursor: string | null }>(`/api/customers/${id}/invoices`),
};
