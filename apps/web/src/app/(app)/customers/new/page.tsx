'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  CustomerForm,
  type CustomerFormState,
  emptyCustomerForm,
  formStateToRequest,
} from '../../../../components/customers/customer-form';
import { ApiClientError } from '../../../../lib/api-client';
import { customersApi } from '../../../../lib/customers-api';

export default function NewCustomerPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [conflictField, setConflictField] = useState<'phone' | 'email' | null>(null);
  const [identityProbe, setIdentityProbe] = useState<{
    firstName: string;
    lastName: string;
    companyName: string;
    city: string;
    zip: string;
  }>({ firstName: '', lastName: '', companyName: '', city: '', zip: '' });

  const dupQuery = useQuery({
    queryKey: ['customer-duplicates', identityProbe],
    queryFn: () => customersApi.searchDuplicates(identityProbe),
    enabled:
      (identityProbe.firstName + identityProbe.lastName + identityProbe.companyName).length >= 2,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (form: CustomerFormState) => customersApi.create(formStateToRequest(form)),
    onSuccess: (created) => {
      router.push(`/customers/${created.id}` as Route);
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
      setError('Could not create the customer right now.');
    },
  });

  const matches = useMemo(() => dupQuery.data?.items ?? [], [dupQuery.data?.items]);

  return (
    <CustomerForm
      initialValue={emptyCustomerForm}
      saving={createMutation.isPending}
      submitLabel="Create customer"
      errorMessage={error}
      duplicateMatches={matches}
      conflictField={conflictField}
      onIdentityChange={(form) =>
        setIdentityProbe({
          firstName: form.firstName,
          lastName: form.lastName,
          companyName: form.companyName,
          city: form.primaryAddress.city,
          zip: form.primaryAddress.zip,
        })
      }
      onSubmit={async (form) => {
        setError(null);
        setConflictField(null);
        await createMutation.mutateAsync(form);
      }}
      onCancel={() => router.push('/customers')}
    />
  );
}
