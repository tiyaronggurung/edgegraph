// Holds the in-flight prediction snapshot/settle work started by the most
// recent computeBtcMarkets() call. Cron callers await flushPredictionTracking()
// so the edge runtime cannot cancel it when the Response returns.
//
// This lives outside *.functions.ts on purpose: the server-fn split transform
// drops module-scope siblings, which caused
// "ReferenceError: __predictionTracking is not defined".
let tracking: Promise<void> | null = null;

export function setPredictionTracking(p: Promise<void>): void {
  tracking = p;
}

export async function flushPredictionTracking(): Promise<void> {
  try {
    await tracking;
  } catch {
    /* already swallowed inside */
  }
}
