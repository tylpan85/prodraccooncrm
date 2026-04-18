import { apiFetch } from './api-client';

export interface RecurrenceInfo {
  frequency: string;
  interval: number;
  daysOfWeek: string[];
  dayOfMonth: number | null;
  ordinal: string | null;
}

export interface JobBlock {
  id: string;
  jobNumber: string;
  customerId: string;
  customerDisplayName: string;
  customerAddress: string | null;
  titleOrSummary: string | null;
  serviceName: string | null;
  priceCents: number;
  scheduledStartAt: string;
  scheduledEndAt: string;
  jobStatus: string;
  assigneeTeamMemberId: string | null;
  recurringSeriesId: string | null;
  recurrenceInfo: RecurrenceInfo | null;
  tags: string[];
}

export interface EventBlock {
  id: string;
  name: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string;
  assigneeTeamMemberId: string | null;
}

export interface LaneDto {
  teamMemberId: string | null;
  displayName: string;
  color: string;
  jobs: JobBlock[];
  events: EventBlock[];
}

export interface DayResponse {
  date: string;
  lanes: LaneDto[];
}

export interface RangeResponse {
  startDate: string;
  endDate: string;
  days: Record<string, { jobs: Array<JobBlock & { assigneeColor: string }>; events: EventBlock[] }>;
}

export const schedulerApi = {
  getDay: (date: string) => apiFetch<DayResponse>(`/api/schedule/day?date=${date}`),
  getRange: (startDate: string, endDate: string) =>
    apiFetch<RangeResponse>(`/api/schedule/range?startDate=${startDate}&endDate=${endDate}`),
};
