import type {
  AssignJobRequest,
  CreateJobRequest,
  JobDto,
  JobSummaryDto,
  OccurrenceDeleteRequest,
  OccurrenceEditRequest,
  ScheduleJobRequest,
  UpdateJobRequest,
} from '@openclaw/shared';
import { apiFetch, apiItem, apiItems } from './api-client';

export interface ListJobsParams {
  customerId?: string;
  scheduleState?: string;
  jobStatus?: string;
  assigneeTeamMemberId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  cursor?: string | null;
  limit?: number;
}

function listQuery(params: ListJobsParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '' && k !== 'cursor' && k !== 'limit') sp.set(k, String(v));
  }
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.limit) sp.set('limit', String(params.limit));
  const s = sp.toString();
  return s.length > 0 ? `?${s}` : '';
}

export const jobsApi = {
  list: (params: ListJobsParams = {}) => apiItems<JobSummaryDto>(`/api/jobs${listQuery(params)}`),
  get: (id: string) => apiItem<JobDto>(`/api/jobs/${id}`),
  create: (customerId: string, body: CreateJobRequest) =>
    apiItem<JobDto>(`/api/customers/${customerId}/jobs`, { method: 'POST', body }),
  update: (id: string, body: UpdateJobRequest) =>
    apiItem<JobDto>(`/api/jobs/${id}`, { method: 'PATCH', body }),
  schedule: (id: string, body: ScheduleJobRequest) =>
    apiItem<JobDto>(`/api/jobs/${id}/schedule`, { method: 'POST', body }),
  unschedule: (id: string) => apiItem<JobDto>(`/api/jobs/${id}/unschedule`, { method: 'POST' }),
  assign: (id: string, body: AssignJobRequest) =>
    apiItem<JobDto>(`/api/jobs/${id}/assign`, { method: 'POST', body }),
  unassign: (id: string) => apiItem<JobDto>(`/api/jobs/${id}/unassign`, { method: 'POST' }),
  finish: (id: string) =>
    apiFetch<{ item: JobDto; invoice: { id: string; invoiceNumber: string; status: string } }>(
      `/api/jobs/${id}/finish`,
      { method: 'POST' },
    ),
  reopen: (id: string) => apiItem<JobDto>(`/api/jobs/${id}/reopen`, { method: 'POST' }),
  occurrenceEdit: (id: string, body: OccurrenceEditRequest) =>
    apiFetch<{ item: { id: string; scope: string } }>(`/api/jobs/${id}/occurrence-edit`, {
      method: 'POST',
      body,
    }),
  occurrenceDelete: (id: string, body: OccurrenceDeleteRequest) =>
    apiFetch<{ item: { id: string; scope: string; deletedCount: number } }>(
      `/api/jobs/${id}/occurrence-delete`,
      { method: 'POST', body },
    ),
  delete: (id: string) =>
    apiFetch<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
  listForCustomer: (customerId: string) =>
    apiItems<JobSummaryDto>(`/api/customers/${customerId}/jobs`),
};
