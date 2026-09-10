// The markets that still owe the player their collateral back.
//
// Redeeming is the last step of a call and the only one that moves real money
// back to the wallet. It used to be fired once, and if that attempt failed —
// an RPC that timed out, a wallet that was busy — nothing ever asked again and
// the winnings sat unclaimed on chain with no sign anything was wrong.
//
// So a market goes on this queue the moment it settles in the player's favour,
// and comes off only when the chain has given a final answer. It outlives a
// reload, because "I closed the tab" is exactly when this used to lose money.
//
// Only market ids are stored. The call behind each one already lives in the
// event log, and `pendingPairs` rebuilds it; keeping a second copy here is how
// the two would drift apart.

/** How many times to retry one market before leaving it alone. */
export const MAX_ATTEMPTS = 6;

export interface PendingRedemption {
  marketId: string;
  /** Attempts that ended without a final answer. */
  attempts: number;
  /** The last failure, for the console. Never shown to the player. */
  lastError?: string;
}

const key = (address: string) => `farm:v1:${address.toLowerCase()}:redeem`;

/**
 * Read the queue for one wallet.
 *
 * Anything unreadable is treated as an empty queue rather than an error: a
 * corrupt entry here must never stop the game from loading, and the worst case
 * is a redemption the player can still trigger by settling another call.
 */
export function loadQueue(address: string): PendingRedemption[] {
  try {
    const raw = window.localStorage.getItem(key(address));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PendingRedemption =>
        typeof e === "object" && e !== null
        && typeof (e as PendingRedemption).marketId === "string"
        && typeof (e as PendingRedemption).attempts === "number",
    );
  } catch (e) {
    console.warn("[farm] could not read the redemption queue:", e);
    return [];
  }
}

/** Write the queue for one wallet. A storage that refuses is not fatal. */
export function saveQueue(address: string, queue: PendingRedemption[]): void {
  try {
    window.localStorage.setItem(key(address), JSON.stringify(queue));
  } catch (e) {
    console.warn("[farm] could not save the redemption queue:", e);
  }
}

/** Add markets that are not already queued, leaving existing attempt counts alone. */
export function enqueue(queue: PendingRedemption[], marketIds: string[]): PendingRedemption[] {
  const known = new Set(queue.map((e) => e.marketId));
  const added = marketIds.filter((id) => !known.has(id)).map((marketId) => ({ marketId, attempts: 0 }));
  return added.length ? [...queue, ...added] : queue;
}

/** Drop the markets the chain has now answered for good. */
export function remove(queue: PendingRedemption[], marketIds: string[]): PendingRedemption[] {
  if (!marketIds.length) return queue;
  const done = new Set(marketIds);
  return queue.filter((e) => !done.has(e.marketId));
}

/**
 * Record a failed attempt, dropping anything that has been tried too often.
 *
 * A market that keeps failing is almost certainly failing for a reason retrying
 * will not fix, and an unbounded queue would send a doomed transaction every
 * thirty seconds for the life of the tab.
 */
export function recordFailure(
  queue: PendingRedemption[],
  marketId: string,
  error: string,
): PendingRedemption[] {
  return queue
    .map((e) => (e.marketId === marketId ? { ...e, attempts: e.attempts + 1, lastError: error } : e))
    .filter((e) => e.attempts < MAX_ATTEMPTS);
}

/** The markets still worth trying. */
export function due(queue: PendingRedemption[]): string[] {
  return queue.filter((e) => e.attempts < MAX_ATTEMPTS).map((e) => e.marketId);
}
