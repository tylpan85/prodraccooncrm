'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Settings } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

const items: { href: Route; label: string }[] = [
  { href: '/settings/services', label: 'Services' },
  { href: '/settings/team', label: 'Team members' },
  { href: '/settings/organization', label: 'Organization' },
];

export function CogMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-label="Settings"
      >
        <Settings className="h-5 w-5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[12rem] rounded-md border border-slate-200 bg-white p-1 shadow-md"
        >
          <DropdownMenu.Label className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Settings
          </DropdownMenu.Label>
          {items.map((item) => (
            <DropdownMenu.Item key={item.href} asChild>
              <Link
                href={item.href}
                className="block cursor-pointer rounded px-3 py-2 text-sm text-slate-800 outline-none hover:bg-slate-100 focus:bg-slate-100"
              >
                {item.label}
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
