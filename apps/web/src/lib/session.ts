import type { AuthSession } from '@openclaw/shared';
import { useQuery } from '@tanstack/react-query';
import { authApi } from './auth-api';

export function useSession() {
  return useQuery<AuthSession>({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 60_000,
    retry: false,
  });
}
