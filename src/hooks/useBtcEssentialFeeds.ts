import { useServerFn } from "@tanstack/react-start";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getKalshiCurrentStrike } from "@/lib/kalshiCurrentStrike.functions";
import { getBtcSpotVolume } from "@/lib/btcSpotVolume.functions";

// Display-only feeds: strike must never wait for volume (or vice versa).
// Shared keys deduplicate the card and Paper Desk's graph subscriptions.
export function useBtcEssentialFeeds(winStart: number) {
  const strikeFn = useServerFn(getKalshiCurrentStrike);
  const volumeFn = useServerFn(getBtcSpotVolume);
  const strike = useQuery({
    queryKey: ["btc-display-strike", winStart],
    queryFn: () => strikeFn(),
    staleTime: 1_000,
    refetchInterval: (query) => query.state.data?.ok ? 5_000 : 1_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: (attempt) => Math.min(200 * 2 ** attempt, 1_500),
    // No previous-window placeholder: a strike belongs to one market only.
  });
  const volume = useQuery({
    queryKey: ["btc-display-volume", winStart],
    queryFn: () => volumeFn(),
    staleTime: 1_000,
    refetchInterval: (query) => {
      const value = query.state.data;
      return value?.ok && value.windowStart === winStart && value.window != null
        ? 5_000 : 1_000;
    },
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: (attempt) => Math.min(200 * 2 ** attempt, 1_500),
    placeholderData: keepPreviousData,
  });
  const currentStrike = strike.data;
  const remaining = currentStrike?.secondsToClose;
  // Requests spanning a rollover must not attach an old market to a new key.
  const fetchedAt = strike.dataUpdatedAt;
  const closeAt = remaining == null ? null : fetchedAt + remaining * 1_000;
  // 60s tolerance absorbs device clock skew; windows are 15 min apart so a
  // neighbouring market can never match.
  const belongsToWindow = closeAt != null &&
    Math.abs(closeAt - (winStart + 900_000)) < 60_000;
  return {
    strike: belongsToWindow ? currentStrike : undefined,
    volume: volume.data,
  };
}