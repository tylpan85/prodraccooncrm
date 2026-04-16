'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';

interface Item {
  href: Route;
  label: string;
  match: (pathname: string) => boolean;
}

const items: Item[] = [
  {
    href: '/customers',
    label: 'Customers',
    match: (p) =>
      p === '/customers' ||
      (p.startsWith('/customers/') &&
        !p.startsWith('/customers/jobs') &&
        !p.startsWith('/customers/invoices')),
  },
  { href: '/customers/jobs', label: 'Jobs', match: (p) => p.startsWith('/customers/jobs') },
  {
    href: '/customers/invoices',
    label: 'Invoices',
    match: (p) => p.startsWith('/customers/invoices'),
  },
];

export function CustomersSubNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav className="flex gap-6 border-b border-slate-200 bg-white px-6">
      {items.map((item) => {
        const active = item.match(pathname);
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
