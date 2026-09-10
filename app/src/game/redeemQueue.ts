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

/**
 * How many times to retry a market that never reached the chain.
 *
 * These cost nothing but a request: the transaction was never mined, so there
 * is no gas to lose by asking again.
 */
export const MAX_ATTEMPTS = 6;

/**
 * How many times to retry a market whose transaction actually reverted.
 *
 * Much lower, because a revert burns gas. Two is enough to tell the two causes
 * apart: a redemption reads the on-chain position before it sends, so if the
 * position was genuinely already claimed the next pass returns "no-position"
 * and settles the matter without sending anything. A revert that survives that
 * check is the transient kind worth one more go.
 */
export const MAX_REVERTS = 2;

/** What ended an attempt without a final answer. */
export type FailureKind = "failed" | "reverted";

export interface PendingRedemption {
  marketId: string;
  /** Attempts that never reached the chain. */
  attempts: number;
  /** Transactions that reached the chain and reverted. */
  reverts: number;
  /**
   * Given up on for this session. The entry is kept rather than deleted: a
   * reload clears this and tries again, so a redemption is never abandoned for
   * good just because the network had a bad few minutes.
   */
  exhausted?: boolean;
  /** The last failure, for the console. Never shown to the player. */
  lastError?: string;
}

const key = (address: string) => `farm:v1:${address.toLowerCase()}:redeem`;

/**
 * Read the queue for one wallet, with this session's attempt counts cleared.
 *
 * Clearing them on load is deliberate. Giving up after a few tries stops the
 * game sending a doomed transaction every thirty seconds, but the giving up
 * must not be permanent — the usual reason is a network that was briefly
 * unreachable, and by the next visit it is not. So each session starts fresh
 * and anything still owed is asked for again.
 *
 * Anything unreadable is treated as an empty queue rather than an error: a
 * corrupt entry here must never stop the game from loading.
 */
export function loadQueue(address: string): PendingRedemption[] {
  try {
    const raw = window.localStorage.getItem(key(address));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is PendingRedemption =>
          typeof e === "object" && e !== null
          && typeof (e as PendingRedemption).marketId === "string",
      )
      .map((e) => ({ marketId: e.marketId, attempts: 0, reverts: 0 }));
  } catch (e) {
    console.warn("[farm] could not read the redemption queue:", e);
    return [];
  }
}

/**
 * Read the queue without resetting the counts.
 *
 * Used within a session, where the counts are what stop a doomed claim being
 * re-sent every poll.
 */
export function readQueue(address: string): PendingRedemption[] {
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

/** Add markets that are not already queued, leaving existing counts alone. */
export function enqueue(queue: PendingRedemption[], marketIds: string[]): PendingRedemption[] {
  const known = new Set(queue.map((e) => e.marketId));
  const added = marketIds
    .filter((id) => !known.has(id))
    .map((marketId) => ({ marketId, attempts: 0, reverts: 0 }));
  return added.length ? [...queue, ...added] : queue;
}

/** Drop the markets the chain has now answered for good. */
export function remove(queue: PendingRedemption[], marketIds: string[]): PendingRedemption[] {
  if (!marketIds.length) return queue;
  const done = new Set(marketIds);
  return queue.filter((e) => !done.has(e.marketId));
}

/**
 * Record an attempt that did not settle the matter.
 *
 * The two kinds are counted separately because they cost differently: an
 * unreached chain costs a request, a revert costs gas. Passing either limit
 * marks the entry exhausted for this session rather than deleting it.
 */
export function recordFailure(
  queue: PendingRedemption[],
  marketId: string,
  kind: FailureKind,
  error: string,
): PendingRedemption[] {
  return queue.map((e) => {
    if (e.marketId !== marketId) return e;
    const next = {
      ...e,
      attempts: e.attempts + (kind === "failed" ? 1 : 0),
      reverts: e.reverts + (kind === "reverted" ? 1 : 0),
      lastError: error,
    };
    const spent = next.attempts >= MAX_ATTEMPTS || next.reverts >= MAX_REVERTS;
    return spent ? { ...next, exhausted: true } : next;
  });
}

/** The markets still worth trying this session. */
export function due(queue: PendingRedemption[]): string[] {
  return queue.filter((e) => !e.exhausted).map((e) => e.marketId);
}

/** Markets given up on for this session, which the player deserves to hear about. */
export function exhausted(queue: PendingRedemption[]): string[] {
  return queue.filter((e) => e.exhausted).map((e) => e.marketId);
}
