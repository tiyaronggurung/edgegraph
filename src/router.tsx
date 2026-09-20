import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Right after a fresh sign-in the very first protected calls can land before
  // the new token is attached. Retry with backoff instead of parking the card
  // on "—" until the user reloads.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 4,
        retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 5_000),
        retryOnMount: true,
        refetchOnReconnect: true,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
