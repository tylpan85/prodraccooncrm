import type {
  CreateServiceRequest,
  CreateTeamMemberRequest,
  OrganizationDto,
  ServiceDto,
  TeamMemberDto,
  UpdateOrganizationRequest,
  UpdateServiceRequest,
  UpdateTeamMemberRequest,
} from '@openclaw/shared';
import { apiFetch, apiItem, apiItems } from './api-client';

export const settingsApi = {
  listServices: (includeInactive = false) =>
    apiItems<ServiceDto>(`/api/services${includeInactive ? '?includeInactive=true' : ''}`),
  createService: (body: CreateServiceRequest) =>
    apiItem<ServiceDto>('/api/services', { method: 'POST', body }),
  updateService: (id: string, body: UpdateServiceRequest) =>
    apiItem<ServiceDto>(`/api/services/${id}`, { method: 'PATCH', body }),
  deleteService: (id: string) =>
    apiFetch<{ item: { id: string } }>(`/api/services/${id}`, { method: 'DELETE' }),

  listTeamMembers: () => apiItems<TeamMemberDto>('/api/team-members'),
  createTeamMember: (body: CreateTeamMemberRequest) =>
    apiItem<TeamMemberDto>('/api/team-members', { method: 'POST', body }),
  updateTeamMember: (id: string, body: UpdateTeamMemberRequest) =>
    apiItem<TeamMemberDto>(`/api/team-members/${id}`, { method: 'PATCH', body }),
  deleteTeamMember: (id: string) =>
    apiFetch<{ item: { id: string } }>(`/api/team-members/${id}`, { method: 'DELETE' }),

  getCurrentOrganization: () => apiItem<OrganizationDto>('/api/organizations/current'),
  updateCurrentOrganization: (body: UpdateOrganizationRequest) =>
    apiItem<OrganizationDto>('/api/organizations/current', { method: 'PATCH', body }),
};
