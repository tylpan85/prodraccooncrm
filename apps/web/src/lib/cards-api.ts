import type {
  CreateSetupIntentResponse,
  CustomerCardRequestDto,
  CustomerPaymentMethodDto,
} from '@openclaw/shared';
import { apiFetch, apiItem, apiItems } from './api-client';

export const cardsApi = {
  listPaymentMethods: (customerId: string) =>
    apiItems<CustomerPaymentMethodDto>(`/api/customers/${customerId}/payment-methods`),
  createSetupIntent: (customerId: string) =>
    apiItem<CreateSetupIntentResponse>(
      `/api/customers/${customerId}/payment-methods/setup-intent`,
      { method: 'POST' },
    ),
  deletePaymentMethod: (customerId: string, pmId: string) =>
    apiFetch<{ ok: true }>(`/api/customers/${customerId}/payment-methods/${pmId}`, {
      method: 'DELETE',
    }),
  setDefault: (customerId: string, pmId: string) =>
    apiFetch<{ ok: true }>(`/api/customers/${customerId}/payment-methods/${pmId}/default`, {
      method: 'POST',
    }),
  listCardRequests: (customerId: string) =>
    apiItems<CustomerCardRequestDto>(`/api/customers/${customerId}/card-requests`),
  createCardRequest: (customerId: string) =>
    apiItem<CustomerCardRequestDto>(`/api/customers/${customerId}/card-requests`, {
      method: 'POST',
    }),
};
