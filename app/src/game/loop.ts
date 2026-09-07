// The three things that happen on their own: the clock moves, markets finish,
// and winnings come back.
//
// Everything here is pure. The React layer owns the timers and calls these; the
// tests call them with plain objects and never open a socket.

import type { Event, GameState } from "farm-engine";
import { currentWindowId } from "../chain/clock.ts";
import type { Direction, PlacedCall, Settlement } from "../chain/types.ts";

/** How often to look for finished markets. Settlement lands ~2s after expiry. */
export const SETTLE_POLL_MS = 30_000;
/** How often to refresh which markets are tradeable. */
export const WINDOWS_POLL_MS = 60_000;
/** How often to check whether the game window rolled over. */
export const TICK_MS = 1_000;

/** Markets the player still has an undecided call on. Deduplicated. */
export function openMarketIds(state: GameState, playerId: string): `0x${string}`[] {
  const p = state.players[playerId];
  if (!p) return [];
  const ids = new Set<string>();
  for (const c of p.calls) if (c.result === null) ids.add(c.marketId);
  return [...ids] as `0x${string}`[];
}

/**
 * A tick event, or null when the window has not moved.
 *
 * The engine refuses time running backwards, so a stale clock must never produce
 * an event at all rather than one the reducer will reject.
 */
export function tickEvent(state: GameState, now: number = Date.now()): Event | null {
  const windowId = currentWindowId(now);
  if (windowId <= state.windowId) return null;
  return { type: "WINDOW_TICK", windowId };
}

/** Settlements turned into engine events. One per market, at the current window. */
export function settlementEvents(settlements: Settlement[], settledAtWindow: number): Event[] {
  return settlements.map((s) => ({
    type: "CALL_SETTLED" as const,
    marketId: s.marketId,
    result: s.result,
    settledAtWindow,
  }));
}

/**
 * The calls worth sending a redemption for, paired with what happened.
 *
 * Redeeming returns the player's own collateral; it has nothing to do with the
 * farm reward, which the engine has already decided. A losing call is skipped
 * here rather than in the adapter so no transaction is even attempted.
 */
export function redeemablePairs(
  state: GameState,
  playerId: string,
  settlements: Settlement[],
): { call: PlacedCall; settlement: Settlement }[] {
  const p = state.players[playerId];
  if (!p) return [];
  const out: { call: PlacedCall; settlement: Settlement }[] = [];
  for (const s of settlements) {
    for (const c of p.calls) {
      if (c.marketId !== s.marketId) continue;
      const won = s.result === "void" || s.result === c.direction;
      if (!won) continue;
      out.push({
        call: {
          callId: c.id,
          marketId: c.marketId as `0x${string}`,
          asset: c.asset,
          direction: c.direction as Direction,
          entryPrice: c.entryPrice,
          windowId: c.windowId,
          shares: 0n, // redeeming reads the real position from chain
          txHash: c.id,
          marketExpiry: 0,
        },
        settlement: s,
      });
    }
  }
  return out;
}
