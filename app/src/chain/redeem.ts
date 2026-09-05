// Claiming what a settled call is worth.
//
// This is collateral, not game currency. The farm reward is decided by the engine
// from the call's direction and entry price; redeeming just returns the player's
// own money to their wallet. A losing call has nothing to claim and costs no gas.

import type { Exchange, PlacedCall, Settlement } from "./types.ts";
import { outcomeIdxFor } from "./place.ts";

export interface Redemption {
  marketId: `0x${string}`;
  redeemed: bigint;
  txHash: string | null;
  /** Why nothing was claimed, when nothing was. */
  skipped?: "lost" | "no-position";
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
  return {
    marketId: call.marketId,
    redeemed: held,
    txHash: String(res?.transactionHash ?? res?.hash ?? "") || null,
  };
}

/** Redeem every settled call that is worth claiming. */
export async function redeemSettled(
  ex: Exchange,
  pairs: { call: PlacedCall; settlement: Settlement }[],
): Promise<Redemption[]> {
  const out: Redemption[] = [];
  for (const { call, settlement } of pairs) {
    out.push(await redeemCall(ex, call, settlement).catch((e) => ({
      marketId: call.marketId,
      redeemed: 0n,
      txHash: null,
      skipped: "no-position" as const,
      error: String(e),
    })));
  }
  return out;
}
