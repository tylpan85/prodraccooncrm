'use client';

import { useSearchParams } from 'next/navigation';
import { InvoicesList } from '../../../../components/invoices-list';
import type { InvoiceStatusFilter } from '../../../../lib/invoices-api';

const STATUS_VALUES: InvoiceStatusFilter[] = ['unsent', 'open', 'past_due', 'paid', 'void'];

export default function InvoicesPage() {
  const searchParams = useSearchParams();
  const raw = searchParams.get('status');
  const initialStatus = (STATUS_VALUES as string[]).includes(raw ?? '')
    ? (raw as InvoiceStatusFilter)
    : undefined;

  return (
    <div className="px-6 py-8">
      <InvoicesList initialStatus={initialStatus} />
    </div>
  );
}
