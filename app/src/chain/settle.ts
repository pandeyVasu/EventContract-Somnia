// Watching for the end of a market.
//
// Reference markets resolved two seconds after expiry in the spike, so a poll
// every thirty seconds is comfortable and costs nothing worth counting.

import type { ChainClient, MarketResult, Settlement } from "./types.ts";

export const POLL_INTERVAL_MS = 30_000;

/**
 * Read one market and say what happened, or null if it has not finished.
 *
 * Void is checked before resolved: a voided market can carry a stale winning
 * outcome, and treating it as a win would pay a reward the rules do not allow.
 */
export function readSettlement(
  marketId: `0x${string}`,
  m: { isVoided: boolean; isResolved: boolean; winningOutcome: number },
): Settlement | null {
  if (m.isVoided) return { marketId, result: "void", winningOutcome: null };
  if (!m.isResolved) return null;
  const winning = Number(m.winningOutcome) === 0 ? 0 : 1;
  const result: MarketResult = winning === 0 ? "up" : "down";
  return { marketId, result, winningOutcome: winning };
}

/** Check every market with a call still open on it. */
export async function pollSettlements(
  client: ChainClient,
  openMarketIds: `0x${string}`[],
): Promise<Settlement[]> {
  const out: Settlement[] = [];
  for (const marketId of openMarketIds) {
    const m = await client.getMarketOnchain(marketId).catch(() => null);
    if (!m) continue;   // a read that failed is a retry next poll, not a settlement
    const settled = readSettlement(marketId, m);
    if (settled) out.push(settled);
  }
  return out;
}
