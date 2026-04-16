import type { CreateEventRequest, EventDto, UpdateEventRequest } from '@openclaw/shared';
import { apiFetch, apiItem, apiItems } from './api-client';

export const eventsApi = {
  list: () => apiItems<EventDto>('/api/events'),
  get: (id: string) => apiItem<EventDto>(`/api/events/${id}`),
  create: (body: CreateEventRequest) => apiItem<EventDto>('/api/events', { method: 'POST', body }),
  update: (id: string, body: UpdateEventRequest) =>
    apiItem<EventDto>(`/api/events/${id}`, { method: 'PATCH', body }),
  delete: (id: string) =>
    apiFetch<{ item: { id: string } }>(`/api/events/${id}`, { method: 'DELETE' }),
};
