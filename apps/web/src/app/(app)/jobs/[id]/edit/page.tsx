'use client';

import { useParams } from 'next/navigation';
import { JobForm } from '../../../../../components/jobs/job-form';

export default function EditJobPage() {
  const params = useParams<{ id: string }>();
  const jobId = params?.id;
  if (!jobId) {
    return <div className="px-6 py-8 text-sm text-slate-500">Loading…</div>;
  }
  return <JobForm mode="edit" jobId={jobId} />;
}
