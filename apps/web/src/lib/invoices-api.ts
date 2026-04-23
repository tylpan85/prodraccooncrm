import type {
  ChargeSavedCardRequest,
  EditInvoiceRequest,
  InvoiceDto,
  InvoiceSummaryDto,
  MarkInvoicePaidRequest,
  SendInvoiceReceiptRequest,
  SendInvoiceSmsRequest,
} from '@openclaw/shared';
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
  sendSms: (id: string, body: SendInvoiceSmsRequest) =>
    apiItem<InvoiceDto>(`/api/invoices/${id}/send-sms`, { method: 'POST', body }),
  sendReceipt: (id: string, body: SendInvoiceReceiptRequest) =>
    apiItem<InvoiceDto>(`/api/invoices/${id}/send-receipt`, { method: 'POST', body }),
  markPaid: (id: string, body: MarkInvoicePaidRequest) =>
    apiItem<InvoiceDto>(`/api/invoices/${id}/mark-paid`, { method: 'POST', body }),
  chargeSavedCard: (id: string, body: ChargeSavedCardRequest) =>
    apiItem<InvoiceDto>(`/api/invoices/${id}/charge-saved-card`, { method: 'POST', body }),
  reopen: (id: string) => apiItem<InvoiceDto>(`/api/invoices/${id}/reopen`, { method: 'POST' }),
  void: (id: string) => apiItem<InvoiceDto>(`/api/invoices/${id}/void`, { method: 'POST' }),
  resyncFromJob: (id: string) =>
    apiItem<InvoiceDto>(`/api/invoices/${id}/resync-from-job`, { method: 'POST' }),
  createForJob: (jobId: string) =>
    apiItem<InvoiceDto>(`/api/jobs/${jobId}/invoice`, { method: 'POST' }),
  pdfUrl: (id: string) => `/api/invoices/${id}/pdf`,
  publicPayUrl: (token: string) => {
    const origin =
      typeof window !== 'undefined' && window.location ? window.location.origin : '';
    return `${origin}/pay/${token}`;
  },
  publicPdfUrl: (token: string) => `/api/public/invoices/${token}/pdf`,
};
