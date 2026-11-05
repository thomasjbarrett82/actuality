// The app's single Vue Query client (02 §1): data from the host is fetched once and kept until a
// `data:changed` event invalidates it (03 §4.1). Session flows outside components use it directly.
import { QueryClient } from '@tanstack/vue-query';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
});
