'use client';

import type { CustomerDto, UpdateCustomerRequest } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  CustomerForm,
  type CustomerFormState,
  customerToFormState,
  emptyCustomerForm,
  formStateToRequest,
} from '../../../../../components/customers/customer-form';
import { ApiClientError } from '../../../../../lib/api-client';
import { customersApi } from '../../../../../lib/customers-api';

export default function EditCustomerPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [error, setError] = useState<string | null>(null);
  const [conflictField, setConflictField] = useState<'phone' | 'email' | null>(null);

  const customerQuery = useQuery({
    queryKey: ['customer', id],
    queryFn: () => customersApi.get(id),
    retry: false,
  });

  const initialValue = useMemo<CustomerFormState>(
    () => (customerQuery.data ? customerToFormState(customerQuery.data) : emptyCustomerForm),
    [customerQuery.data],
  );

  const updateMutation = useMutation({
    mutationFn: (form: CustomerFormState) => {
      const body = formStateToRequest(form) as UpdateCustomerRequest;
      return customersApi.update(id, body);
    },
    onSuccess: async (updated: CustomerDto) => {
      await queryClient.invalidateQueries({ queryKey: ['customer', id] });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      router.push(`/customers/${updated.id}` as Route);
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.code === 'CUSTOMER_DUPLICATE') {
          const conflictType = (err.details as { conflictType?: string } | undefined)?.conflictType;
          if (conflictType === 'phone' || conflictType === 'email') {
            setConflictField(conflictType);
          }
          setError(err.message);
          return;
        }
        setError(err.message);
        return;
      }
      setError('Could not save the customer right now.');
    },
  });

  if (customerQuery.isLoading) {
    return <div className="px-6 py-8 text-sm text-slate-500">Loading customer…</div>;
  }
  if (customerQuery.error) {
    return <div className="px-6 py-8 text-sm text-slate-700">Could not load customer.</div>;
  }

  return (
    <CustomerForm
      initialValue={initialValue}
      saving={updateMutation.isPending}
      submitLabel="Save changes"
      errorMessage={error}
      duplicateMatches={[]}
      conflictField={conflictField}
      onSubmit={async (form) => {
        setError(null);
        setConflictField(null);
        await updateMutation.mutateAsync(form);
      }}
      onCancel={() => router.push(`/customers/${id}` as Route)}
    />
  );
}
