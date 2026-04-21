'use client';

import { useSearchParams } from 'next/navigation';
import { JobForm } from '../../../../components/jobs/job-form';

export default function NewJobPage() {
  const searchParams = useSearchParams();
  return (
    <JobForm
      mode="new"
      preselectedCustomerId={searchParams.get('customerId')}
      preselectedStartAt={searchParams.get('scheduledStartAt') ?? ''}
      preselectedEndAt={searchParams.get('scheduledEndAt') ?? ''}
      preselectedAssigneeId={searchParams.get('assigneeTeamMemberId')}
    />
  );
}
