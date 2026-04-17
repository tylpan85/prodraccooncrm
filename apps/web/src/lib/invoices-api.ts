import type { EditInvoiceRequest, InvoiceDto, InvoiceSummaryDto } from '@openclaw/shared';
import { apiItem, apiItems } from './api-client';

export const invoicesApi = {
  list: (params?: { status?: string; customerId?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.customerId) qs.set('customerId', params.customerId);
    if (params?.q) qs.set('q', params.q);
    const query = qs.toString();
    return apiItems<InvoiceSummaryDto>(`/api/invoices${query ? `?${query}` : ''}`);
  },
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
