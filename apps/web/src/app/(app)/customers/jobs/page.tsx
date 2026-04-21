'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { JobsList } from '../../../../components/jobs-list';

export default function JobsPage() {
  return (
    <div className="px-6 py-8">
      <JobsList
        headerActions={
          <Link href={'/jobs/new' as Route}>
            <button
              type="button"
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              New job
            </button>
          </Link>
        }
      />
    </div>
  );
}
