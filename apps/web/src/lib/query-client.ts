import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, err) => {
          if (err instanceof Error && err.name === 'ApiClientError') return false;
          return failureCount < 1;
        },
      },
    },
  });
}
