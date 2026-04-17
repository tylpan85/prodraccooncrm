import type { CreateRecurringJobRequest, RecurrenceRuleInput } from '@openclaw/shared';
import { apiFetch, apiItem } from './api-client';

interface CreateRecurringJobResponse {
  sourceJobId: string;
  seriesId: string;
  generatedCount: number;
}

export interface RecurringSeriesDto {
  id: string;
  recurrenceFrequency: RecurrenceRuleInput['recurrenceFrequency'];
  recurrenceInterval: number;
  recurrenceEndMode: RecurrenceRuleInput['recurrenceEndMode'];
  recurrenceOccurrenceCount: number | null;
  recurrenceEndDate: string | null;
  recurrenceDayOfWeek: string[];
  recurrenceDayOfMonth: number | null;
  recurrenceOrdinal: string | null;
  recurrenceMonthOfYear: string | null;
  recurrenceEnabled: boolean;
  recurrenceRuleVersion: number;
}

export const recurringApi = {
  create: (body: CreateRecurringJobRequest) =>
    apiFetch<{ item: CreateRecurringJobResponse }>('/api/recurring-jobs', {
      method: 'POST',
      body,
    }).then((env) => env.item),

  /** Fetch the recurring series rule attached to a job (returns null if not recurring). */
  getSeriesForJob: (jobId: string) =>
    apiItem<RecurringSeriesDto | null>(`/api/jobs/${jobId}/series`),
};
