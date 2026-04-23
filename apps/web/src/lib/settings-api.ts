import type {
  CreateLeadSourceRequest,
  CreatePaymentMethodRequest,
  CreateServiceRequest,
  CreateTeamMemberRequest,
  CreateUserRequest,
  IntegrationKind,
  LeadSourceDto,
  OrgIntegrationDto,
  OrganizationProfileDto,
  PaymentMethodDto,
  ServiceDto,
  SettingsUserDto,
  TeamMemberDto,
  UpdateLeadSourceRequest,
  UpdateOrgIntegrationRequest,
  UpdateOrganizationProfileRequest,
  UpdatePaymentMethodRequest,
  UpdateServiceRequest,
  UpdateTeamMemberRequest,
  UpdateUserRequest,
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

  listLeadSources: (includeInactive = false) =>
    apiItems<LeadSourceDto>(`/api/lead-sources${includeInactive ? '?includeInactive=true' : ''}`),
  createLeadSource: (body: CreateLeadSourceRequest) =>
    apiItem<LeadSourceDto>('/api/lead-sources', { method: 'POST', body }),
  updateLeadSource: (id: string, body: UpdateLeadSourceRequest) =>
    apiItem<LeadSourceDto>(`/api/lead-sources/${id}`, { method: 'PATCH', body }),
  deleteLeadSource: (id: string) =>
    apiFetch<{ item: { id: string } }>(`/api/lead-sources/${id}`, { method: 'DELETE' }),

  listUsers: (archived = false) =>
    apiItems<SettingsUserDto>(`/api/users${archived ? '?includeInactive=true' : ''}`),
  createUser: (body: CreateUserRequest) =>
    apiItem<SettingsUserDto>('/api/users', { method: 'POST', body }),
  updateUser: (id: string, body: UpdateUserRequest) =>
    apiItem<SettingsUserDto>(`/api/users/${id}`, { method: 'PATCH', body }),
  archiveUser: (id: string) =>
    apiItem<SettingsUserDto>(`/api/users/${id}/archive`, { method: 'PATCH', body: {} }),
  unarchiveUser: (id: string) =>
    apiItem<SettingsUserDto>(`/api/users/${id}/unarchive`, { method: 'PATCH', body: {} }),

  getCurrentOrganization: () => apiItem<OrganizationProfileDto>('/api/organizations/current'),
  updateCurrentOrganization: (body: UpdateOrganizationProfileRequest) =>
    apiItem<OrganizationProfileDto>('/api/organizations/current', { method: 'PATCH', body }),

  listPaymentMethods: (includeInactive = false) =>
    apiItems<PaymentMethodDto>(
      `/api/payment-methods${includeInactive ? '?includeInactive=true' : ''}`,
    ),
  createPaymentMethod: (body: CreatePaymentMethodRequest) =>
    apiItem<PaymentMethodDto>('/api/payment-methods', { method: 'POST', body }),
  updatePaymentMethod: (id: string, body: UpdatePaymentMethodRequest) =>
    apiItem<PaymentMethodDto>(`/api/payment-methods/${id}`, { method: 'PATCH', body }),
  deletePaymentMethod: (id: string) =>
    apiFetch<{ item: { id: string } }>(`/api/payment-methods/${id}`, { method: 'DELETE' }),

  listIntegrations: () => apiItems<OrgIntegrationDto>('/api/integrations'),
  getIntegration: (kind: IntegrationKind) =>
    apiItem<OrgIntegrationDto>(`/api/integrations/${kind}`),
  updateIntegration: (kind: IntegrationKind, body: UpdateOrgIntegrationRequest) =>
    apiItem<OrgIntegrationDto>(`/api/integrations/${kind}`, { method: 'PUT', body }),
};
