// Provider factory. Swap providers by setting LIVE_PROVIDER env var.
// Default: api-football. Available: api-football | sportradar | opta.

import type { LiveDataProvider } from "./liveProvider";
import { ApiFootballProvider } from "./apiFootballProvider";
import { SportradarProvider } from "./sportradarProvider";
import { OptaProvider } from "./optaProvider";

export type ProviderId = "api-football" | "sportradar" | "opta";

let cached: LiveDataProvider | null = null;

export function getProvider(): LiveDataProvider {
  if (cached) return cached;
  const id = (process.env.LIVE_PROVIDER ?? "api-football").toLowerCase() as ProviderId;
  switch (id) {
    case "sportradar":
      cached = new SportradarProvider();
      break;
    case "opta":
      cached = new OptaProvider();
      break;
    case "api-football":
    default:
      cached = new ApiFootballProvider();
      break;
  }
  return cached;
}

export function resetProviderCache() {
  cached = null;
}
