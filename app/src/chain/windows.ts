// Finding the market a call will ride.
//
// listLiveBinaryMarkets only filters on "expiry is in the future". It does not
// check status, so every candidate is confirmed against the chain before it is
// offered to a player.

import type { ChainClient, LiveWindow } from "./types.ts";

/**
 * The two shapes a round can take here, and why both carry an Up/Down call.
 *
 * A `reference` round asks whether the price at expiry beat the price when the
 * round opened. That is a direction call by construction.
 *
 * A `fixed` round asks whether the price at expiry is at or above a strike. That
 * is only the same question if the strike is the price at the open, so this was
 * checked against the venue rather than assumed: across consecutive one-minute
 * ETH rounds the strike moved every single time and tracked the market
 * (2488.00, 2488.38, 2489.95, 2490.62, ...), and each round's trading start
 * equals its own open. The strike is spot at the open, so "at or above the
 * strike" is "went up", with a dead heat counting as up.
 *
 * The short rounds this game most wants are listed in fixed mode, so refusing
 * them would have cost the fastest loop for a distinction that does not exist.
 */
const DIRECTION_MODES = new Set(["reference", "fixed"]);

/**
 * How much of a round must be left for an order to still land.
 *
 * A flat five minutes was sized for hour-long rounds and quietly excluded every
 * short one: a five-minute round never has more than five minutes left, so it
 * could never be offered, and a fifteen-minute round was only usable for its
 * first ten. Those are precisely the rounds that make the game feel immediate.
 *
 * So the guard scales with the round instead: a sixth of it, never under twenty
 * seconds, and never over the five minutes that long rounds are known to need.
 */
export function minSecondsLeft(intervalSec: number): number {
  return Math.min(300, Math.max(20, Math.floor(intervalSec / 6)));
}

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
    .filter((m) => DIRECTION_MODES.has(String(m.mode)))
    .map((m) => ({
      marketId: String(m.marketId) as `0x${string}`,
      pool: (m.pool ?? m.poolAddress) as `0x${string}`,
      asset: String(m.asset),
      intervalSec: Number(m.intervalSec),
      expiry: Number(m.expiry),
      secondsLeft: Number(m.expiry) - nowSeconds,
    }))
    .filter((m) => m.secondsLeft > minSecondsLeft(m.intervalSec));

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
export function pickWindow(
  windows: LiveWindow[],
  asset: string,
  preferredInterval: number | null = null,
): LiveWindow | null {
  const forAsset = windows.filter((w) => w.asset === asset);
  if (preferredInterval !== null) {
    // The player asked how soon they want to know. Honour it when that length is
    // open for this asset, and fall back rather than refuse the call: round
    // lengths come and go, and "no" would be a worse answer than "sooner".
    const wanted = forAsset.find((w) => w.intervalSec === preferredInterval);
    if (wanted) return wanted;
  }
  return forAsset[0] ?? null;
}

/**
 * The round lengths open right now, shortest first.
 *
 * What the venue is running changes through the day, so this is discovered
 * rather than declared: the game offers exactly the choices that exist.
 */
export function availableIntervals(windows: LiveWindow[]): number[] {
  return [...new Set(windows.map((w) => w.intervalSec))].sort((a, b) => a - b);
}

/** The assets a player can call on right now. */
export function tradeableAssets(windows: LiveWindow[]): string[] {
  return [...new Set(windows.map((w) => w.asset))];
}
