import type {
  AssignJobRequest,
  CreateJobRequest,
  JobDto,
  JobNotesResponse,
  JobSummaryDto,
  OccurrenceDeleteRequest,
  OccurrenceEditRequest,
  ScheduleJobRequest,
  UpdateJobRequest,
} from '@openclaw/shared';
import { apiFetch, apiItem, apiItems } from './api-client';

export interface NoteMapping {
  tempId: string;
  noteId: string;
  noteGroupId: string;
}

export interface JobsWindowResponse {
  items: JobSummaryDto[];
  nextCursorBefore?: string | null;
  hasMoreBefore?: boolean;
  nextCursorAfter?: string | null;
  hasMoreAfter?: boolean;
}

export type JobStageFilter =
  | 'scheduled'
  | 'confirmation_sent'
  | 'confirmed'
  | 'job_done'
  | 'cancelled';

export interface JobsListFilters {
  customerId?: string;
  assigneeTeamMemberId?: string;
  serviceId?: string;
  stage?: JobStageFilter;
  tag?: string;
  dateFrom?: string;
  dateTo?: string;
  priceMinCents?: number;
  priceMaxCents?: number;
  q?: string;
}

export interface JobsListParams extends JobsListFilters {
  anchor?: string;
  direction?: 'before' | 'after';
  cursor?: string;
  limit?: number;
}

function buildJobsQuery(params: JobsListParams): string {
  const sp = new URLSearchParams();
  const append = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return;
    sp.set(k, String(v));
  };
  append('customerId', params.customerId);
  append('assigneeTeamMemberId', params.assigneeTeamMemberId);
  append('serviceId', params.serviceId);
  append('stage', params.stage);
  append('tag', params.tag);
  append('dateFrom', params.dateFrom);
  append('dateTo', params.dateTo);
  append('priceMinCents', params.priceMinCents);
  append('priceMaxCents', params.priceMaxCents);
  append('q', params.q);
  append('anchor', params.anchor);
  append('direction', params.direction);
  append('cursor', params.cursor);
  append('limit', params.limit);
  const s = sp.toString();
  return s.length > 0 ? `?${s}` : '';
}

// Kept for backwards-compat with existing call sites.
export type CustomerJobsParams = Pick<JobsListParams, 'anchor' | 'direction' | 'cursor' | 'limit'>;
export type CustomerJobsResponse = JobsWindowResponse;

export const jobsApi = {
  list: (params: JobsListParams = {}) =>
    apiFetch<JobsWindowResponse>(`/api/jobs${buildJobsQuery(params)}`),
  get: (id: string) => apiItem<JobDto>(`/api/jobs/${id}`),
  create: (customerId: string, body: CreateJobRequest) =>
    apiItem<JobDto>(`/api/customers/${customerId}/jobs`, { method: 'POST', body }),
  update: (id: string, body: UpdateJobRequest) =>
    apiFetch<{ item: JobDto; noteMappings: NoteMapping[] }>(`/api/jobs/${id}`, {
      method: 'PATCH',
      body,
    }),
  schedule: (id: string, body: ScheduleJobRequest) =>
    apiItem<JobDto>(`/api/jobs/${id}/schedule`, { method: 'POST', body }),
  assign: (id: string, body: AssignJobRequest) =>
    apiItem<JobDto>(`/api/jobs/${id}/assign`, { method: 'POST', body }),
  unassign: (id: string) => apiItem<JobDto>(`/api/jobs/${id}/unassign`, { method: 'POST' }),
  finish: (id: string) =>
    apiFetch<{ item: JobDto; invoice: { id: string; invoiceNumber: string; status: string } }>(
      `/api/jobs/${id}/finish`,
      { method: 'POST' },
    ),
  reopen: (id: string) => apiItem<JobDto>(`/api/jobs/${id}/reopen`, { method: 'POST' }),
  setStage: (id: string, body: { stage: string; scope?: 'this' | 'this_and_future' }) =>
    apiItem<JobDto>(`/api/jobs/${id}/stage`, { method: 'POST', body }),
  occurrenceEdit: (id: string, body: OccurrenceEditRequest) =>
    apiFetch<{ item: { id: string; scope: string; noteMappings: NoteMapping[] } }>(
      `/api/jobs/${id}/occurrence-edit`,
      { method: 'POST', body },
    ),
  occurrenceDelete: (id: string, body: OccurrenceDeleteRequest) =>
    apiFetch<{
      item: {
        id: string;
        scope: string;
        deletedCount: number;
        skippedJobs: { id: string; jobNumber: string }[];
      };
    }>(`/api/jobs/${id}/occurrence-delete`, { method: 'POST', body }),
  delete: (id: string) =>
    apiFetch<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
  listForCustomer: (customerId: string, params: CustomerJobsParams = {}) =>
    apiFetch<JobsWindowResponse>(
      `/api/customers/${customerId}/jobs${buildJobsQuery(params)}`,
    ),
  getNotes: (id: string) => apiFetch<JobNotesResponse>(`/api/jobs/${id}/notes`),
};
