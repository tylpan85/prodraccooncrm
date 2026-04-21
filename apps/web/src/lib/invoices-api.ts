import type { EditInvoiceRequest, InvoiceDto, InvoiceSummaryDto } from '@openclaw/shared';
import { apiFetch, apiItem } from './api-client';

export interface InvoicesWindowResponse {
  items: InvoiceSummaryDto[];
  nextCursorBefore?: string | null;
  hasMoreBefore?: boolean;
  nextCursorAfter?: string | null;
  hasMoreAfter?: boolean;
}

export type InvoiceStatusFilter = 'unsent' | 'open' | 'past_due' | 'paid' | 'void';

export interface InvoicesListFilters {
  status?: InvoiceStatusFilter;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMinCents?: number;
  amountMaxCents?: number;
  q?: string;
}

export interface InvoicesListParams extends InvoicesListFilters {
  anchor?: string;
  direction?: 'before' | 'after';
  cursor?: string;
  limit?: number;
}

function buildInvoicesQuery(params: InvoicesListParams): string {
  const sp = new URLSearchParams();
  const append = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return;
    sp.set(k, String(v));
  };
  append('status', params.status);
  append('customerId', params.customerId);
  append('dateFrom', params.dateFrom);
  append('dateTo', params.dateTo);
  append('amountMinCents', params.amountMinCents);
  append('amountMaxCents', params.amountMaxCents);
  append('q', params.q);
  append('anchor', params.anchor);
  append('direction', params.direction);
  append('cursor', params.cursor);
  append('limit', params.limit);
  const s = sp.toString();
  return s.length > 0 ? `?${s}` : '';
}

export const invoicesApi = {
  list: (params: InvoicesListParams = {}) =>
    apiFetch<InvoicesWindowResponse>(`/api/invoices${buildInvoicesQuery(params)}`),
  get: (id: string) => apiItem<InvoiceDto>(`/api/invoices/${id}`),
  edit: (id: string, body: EditInvoiceRequest) =>
    apiItem<InvoiceDto>(`/api/invoices/${id}`, { method: 'PATCH', body }),
  send: (id: string) => apiItem<InvoiceDto>(`/api/invoices/${id}/send`, { method: 'POST' }),
  markPaid: (id: string) =>
    apiItem<InvoiceDto>(`/api/invoices/${id}/mark-paid`, { method: 'POST' }),
  void: (id: string) => apiItem<InvoiceDto>(`/api/invoices/${id}/void`, { method: 'POST' }),
  createForJob: (jobId: string) =>
    apiItem<InvoiceDto>(`/api/jobs/${jobId}/invoice`, { method: 'POST' }),
};
