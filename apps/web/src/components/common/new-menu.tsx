'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Plus } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Button } from '../ui/button';

const items: { href: Route; label: string }[] = [
  { href: '/jobs/new' as Route, label: 'New job' },
  { href: '/events/new' as Route, label: 'New event' },
];

export function NewMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button id="new-menu-trigger" size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[12rem] rounded-md border border-slate-200 bg-white p-1 shadow-md"
        >
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
