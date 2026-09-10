// Claiming what a settled call is worth.
//
// This is collateral, not game currency. The farm reward is decided by the engine
// from the call's direction and entry price; redeeming just returns the player's
// own money to their wallet. A losing call has nothing to claim and costs no gas.

import type { Exchange, PlacedCall, Settlement } from "./types.ts";
import { outcomeIdxFor } from "./place.ts";
import { hashOf, receiptSucceeded } from "./receipt.ts";

/**
 * Why a redemption claimed nothing, and whether it is worth trying again.
 *
 * `lost` and `no-position` are settled facts: there was never anything to
 * claim, or it has already been claimed. `reverted` means the chain rejected
 * the transaction. `failed` means we never got an answer — an RPC that timed
 * out, a wallet that refused to sign — and is the only one where the money may
 * still be sitting there waiting.
 */
export type RedemptionSkip = "lost" | "no-position" | "reverted" | "failed";

export interface Redemption {
  marketId: `0x${string}`;
  redeemed: bigint;
  txHash: string | null;
  /** Why nothing was claimed, when nothing was. */
  skipped?: RedemptionSkip;
  /** What went wrong, on `failed` only. Never shown to the player. */
  error?: string;
}

/**
 * Is this outcome final, or should the call be tried again later?
 *
 * `lost` and `no-position` are settled facts and end the matter. The other two
 * do not.
 *
 * A `failed` attempt never reached the chain, so the money may still be there.
 *
 * A `reverted` one did reach it, and treating that as final was wrong: a revert
 * caused by a momentary race or a simulation against a stale block is
 * indistinguishable here from one caused by an already-claimed position, and
 * calling both final stranded the first kind permanently. Retrying is safe
 * because it is self-correcting — a redemption reads the on-chain position
 * before it sends, so a genuinely claimed position comes back as `no-position`
 * on the next pass and ends there without spending gas. The queue caps reverts
 * far lower than plain failures, since each one does burn gas.
 */
export function isTerminal(r: Redemption): boolean {
  return r.skipped !== "failed" && r.skipped !== "reverted";
}

/** Which kind of non-final outcome this was, for the queue's separate counters. */
export function failureKind(r: Redemption): "failed" | "reverted" {
  return r.skipped === "reverted" ? "reverted" : "failed";
}

/**
 * Redeem one settled call. On a win the whole position is burned for collateral,
 * one unit per share. On a void both sides pay half, and only the side actually
 * held is worth a transaction.
 */
export async function redeemCall(
  ex: Exchange,
  call: PlacedCall,
  settlement: Settlement,
): Promise<Redemption> {
  const outcomeIdx = outcomeIdxFor(call.direction);
  const lost = settlement.result !== "void" && settlement.winningOutcome !== outcomeIdx;
  if (lost) return { marketId: call.marketId, redeemed: 0n, txHash: null, skipped: "lost" };

  const m = await ex.client.getMarketOnchain(call.marketId);
  const held = await ex.client.getOutcomeBalance({
    outcomeToken: m.outcomeToken,
    account: ex.walletAddress,
    id: outcomeIdx === 0 ? m.yesId : m.noId,
  });
  if (held <= 0n) return { marketId: call.marketId, redeemed: 0n, txHash: null, skipped: "no-position" };

  const res = await ex.trader.redeem({ marketId: call.marketId, amount: held, outcomeIdx });

  // Mined is not the same as worked. A redemption that reverted still returns a
  // receipt, and treating it as a payout would tell the player their money came
  // back when it did not.
  if (!receiptSucceeded(res)) {
    return { marketId: call.marketId, redeemed: 0n, txHash: hashOf(res), skipped: "reverted" };
  }
  return { marketId: call.marketId, redeemed: held, txHash: hashOf(res) };
}

/** Redeem every settled call that is worth claiming. */
export async function redeemSettled(
  ex: Exchange,
  pairs: { call: PlacedCall; settlement: Settlement }[],
): Promise<Redemption[]> {
  const out: Redemption[] = [];
  for (const { call, settlement } of pairs) {
    // A thrown error is not the same as having nothing to claim. Reporting it
    // as "no-position" once made an unreachable RPC look like a settled fact,
    // and the winnings were never asked for again.
    out.push(await redeemCall(ex, call, settlement).catch((e) => ({
      marketId: call.marketId,
      redeemed: 0n,
      txHash: null,
      skipped: "failed" as const,
      error: String(e),
    })));
  }
  return out;
}
