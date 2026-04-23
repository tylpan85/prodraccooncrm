import type {
  CreateCustomerRequest,
  CustomerDto,
  CustomerNotesResponse,
  CustomerSummaryDto,
  DuplicateMatchDto,
  SaveCustomerNotesRequest,
  SaveCustomerNotesResponse,
  UpdateCustomerRequest,
} from '@openclaw/shared';
import { apiFetch, apiItem, apiItems } from './api-client';

export interface ListCustomersParams {
  q?: string;
  cursor?: string | null;
  limit?: number;
  archived?: boolean;
  customerType?: 'Homeowner' | 'Business';
  subcontractor?: boolean;
  doNotService?: boolean;
  sendNotifications?: boolean;
  tag?: string;
  city?: string;
  state?: string;
  leadSource?: string;
}

function listQuery(params: ListCustomersParams): string {
  const sp = new URLSearchParams();
  if (params.q && params.q.trim().length > 0) sp.set('q', params.q.trim());
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.archived) sp.set('includeArchived', 'true');
  if (params.customerType) sp.set('customerType', params.customerType);
  if (params.subcontractor !== undefined) sp.set('subcontractor', String(params.subcontractor));
  if (params.doNotService !== undefined) sp.set('doNotService', String(params.doNotService));
  if (params.sendNotifications !== undefined)
    sp.set('sendNotifications', String(params.sendNotifications));
  if (params.tag && params.tag.trim().length > 0) sp.set('tag', params.tag.trim());
  if (params.city && params.city.trim().length > 0) sp.set('city', params.city.trim());
  if (params.state && params.state.trim().length > 0) sp.set('state', params.state.trim());
  if (params.leadSource && params.leadSource.trim().length > 0)
    sp.set('leadSource', params.leadSource.trim());
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
  archiveCustomer: (id: string) =>
    apiItem<CustomerDto>(`/api/customers/${id}/archive`, { method: 'PATCH', body: {} }),
  unarchiveCustomer: (id: string) =>
    apiItem<CustomerDto>(`/api/customers/${id}/unarchive`, { method: 'PATCH', body: {} }),
  searchDuplicates: (params: SearchDuplicatesParams) =>
    apiItems<DuplicateMatchDto>(`/api/customers/search-duplicates${dupQuery(params)}`),
  listJobs: (id: string) =>
    apiFetch<{ items: unknown[]; nextCursor: string | null }>(`/api/customers/${id}/jobs`),
  listInvoices: (id: string) =>
    apiFetch<{ items: unknown[]; nextCursor: string | null }>(`/api/customers/${id}/invoices`),
  getNotes: (id: string) => apiFetch<CustomerNotesResponse>(`/api/customers/${id}/notes`),
  saveNotes: (id: string, body: SaveCustomerNotesRequest) =>
    apiFetch<SaveCustomerNotesResponse>(`/api/customers/${id}/notes/save`, {
      method: 'POST',
      body,
    }),
};
