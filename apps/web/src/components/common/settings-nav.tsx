'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';

const items: { href: Route; label: string }[] = [
  { href: '/settings/services', label: 'Services' },
  { href: '/settings/team', label: 'Team' },
  { href: '/settings/organization', label: 'Organization' },
];

export function SettingsNav() {
  const pathname = usePathname() ?? '';

  return (
    <nav className="flex gap-6 border-b border-slate-200 bg-white px-6">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              '-mb-px border-b-2 py-3 text-sm font-medium',
              active
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-600 hover:text-slate-900',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
