'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { authApi } from '../../lib/auth-api';

interface Props {
  email: string;
}

export function UserMenu({ email }: Props) {
  const router = useRouter();
  const qc = useQueryClient();

  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {
      // proceed with redirect even if the request failed
    }
    qc.clear();
    router.replace('/login');
  }

  const initial = email.slice(0, 1).toUpperCase();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-label="User menu"
      >
        {initial}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[14rem] rounded-md border border-slate-200 bg-white p-1 shadow-md"
        >
          <div className="px-3 py-2 text-xs text-slate-500">
            Signed in as
            <div className="truncate text-sm text-slate-800">{email}</div>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
          <DropdownMenu.Item
            onSelect={handleLogout}
            className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-slate-800 outline-none hover:bg-slate-100 focus:bg-slate-100"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
