// Finding the market a call will ride.
//
// listLiveBinaryMarkets only filters on "expiry is in the future". It does not
// check status, so every candidate is confirmed against the chain before it is
// offered to a player.

import type { ChainClient, LiveWindow } from "./types.ts";

/** Up/Down markets are reference mode. Fixed mode is a strike bet, a different game. */
const REFERENCE = "reference";

/** A market this close to expiry locks before an order can land. */
export const MIN_SECONDS_LEFT = 300;

/**
 * Every tradeable Up/Down market right now, shortest window first.
 *
 * The indexer market object carries `poolAddress`; the on-chain read calls the same
 * thing `pool`. Both names are live in one workflow, so normalise here.
 */
export async function listLiveWindows(
  client: ChainClient,
  now: number = Date.now(),
): Promise<LiveWindow[]> {
  const nowSeconds = Math.floor(now / 1000);
  const live = await client.listLiveBinaryMarkets({ limit: 100 });

  const candidates = live
    .filter((m) => m.mode === REFERENCE)
    .map((m) => ({
      marketId: String(m.marketId) as `0x${string}`,
      pool: (m.pool ?? m.poolAddress) as `0x${string}`,
      asset: String(m.asset),
      intervalSec: Number(m.intervalSec),
      expiry: Number(m.expiry),
      secondsLeft: Number(m.expiry) - nowSeconds,
    }))
    .filter((m) => m.secondsLeft > MIN_SECONDS_LEFT);

  const confirmed: LiveWindow[] = [];
  for (const m of candidates) {
    const onchain = await client.getMarketOnchain(m.marketId).catch(() => null);
    if (onchain?.status === 1) confirmed.push(m);
  }

  // Shortest window first, then soonest to settle: the game always wants the
  // fastest feedback it can get.
  return confirmed.sort((a, b) => a.intervalSec - b.intervalSec || a.secondsLeft - b.secondsLeft);
}

/**
 * The market a call on `asset` should ride: the soonest-settling tradeable one.
 * Returns null when that asset has nothing open, which the UI shows as a plain
 * reason rather than an error.
 */
export function pickWindow(windows: LiveWindow[], asset: string): LiveWindow | null {
  return windows.find((w) => w.asset === asset) ?? null;
}

/** The assets a player can call on right now. */
export function tradeableAssets(windows: LiveWindow[]): string[] {
  return [...new Set(windows.map((w) => w.asset))];
}
