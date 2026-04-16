'use client';

import type { AuthSession } from '@openclaw/shared';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';
import { CogMenu } from './cog-menu';
import { NewMenu } from './new-menu';
import { UserMenu } from './user-menu';

interface Props {
  session: AuthSession;
}

const primaryNav: { href: Route; label: string; match: (p: string) => boolean }[] = [
  {
    href: '/customers',
    label: 'Customers',
    match: (p) => p.startsWith('/customers') || p.startsWith('/jobs') || p.startsWith('/invoices'),
  },
  {
    href: '/scheduler',
    label: 'Scheduler',
    match: (p) => p.startsWith('/scheduler') || p.startsWith('/events'),
  },
];

export function Topbar({ session }: Props) {
  const pathname = usePathname() ?? '';
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center gap-6 px-6">
        <Link href="/scheduler" className="flex items-center gap-2">
          <span className="text-base font-semibold text-brand-700">Raccoon CRM</span>
          <span className="hidden text-sm text-slate-500 sm:inline">
            · {session.organization.name}
          </span>
        </Link>

        <nav className="flex flex-1 items-center gap-1">
          {primaryNav.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium',
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <NewMenu />
          <CogMenu />
          <UserMenu email={session.user.email} />
        </div>
      </div>
    </header>
  );
}
