'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { ErrorBoundary } from '../../components/common/error-boundary';
import { Topbar } from '../../components/common/topbar';
import { ApiClientError } from '../../lib/api-client';
import { useSession } from '../../lib/session';

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: session, isPending, error } = useSession();

  useEffect(() => {
    if (error instanceof ApiClientError && error.status === 401) {
      router.replace('/login');
    }
  }, [error, router]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Topbar session={session} />
      <main className="flex-1">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
