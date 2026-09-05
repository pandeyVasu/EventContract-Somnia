// Placing one call.
//
// A fixed stake, always. The player never sees a price, a size, or an order type,
// and the game rewards being right rather than betting big.

import { ORDER_TYPE, quoteBinaryStakeOverBook } from "@somnia-chain/markets-sdk";
import { currentWindowId } from "./clock.ts";
import { hashOf } from "./receipt.ts";
import type { Direction, Exchange, LiveWindow, PlacedCall } from "./types.ts";

/** Collateral is TestUSDC with 6 decimals, so one whole unit is 1_000_000. */
export const ONE_COLLATERAL = 1_000_000n;

/** One unit of collateral per call. Never shown to the player. */
export const STAKE = ONE_COLLATERAL;

/** Up buys YES, Down buys NO. */
export function sideFor(direction: Direction): "BUY_YES" | "BUY_NO" {
  return direction === "up" ? "BUY_YES" : "BUY_NO";
}

/** Outcome index of a direction. 0 is Up and YES, 1 is Down and NO. */
export function outcomeIdxFor(direction: Direction): 0 | 1 {
  return direction === "up" ? 0 : 1;
}

/**
 * Entry probability for the side we bought.
 *
 * fillPrice is always the YES price, even on a BUY_NO. Reporting it unchanged for
 * a Down call inverts the risk scaling and quietly overpays every contrarian call.
 */
export function entryPriceFrom(yesPriceRaw: bigint, direction: Direction): number {
  const yes = Number(yesPriceRaw) / Number(ONE_COLLATERAL);
  return direction === "up" ? yes : 1 - yes;
}

/**
 * Place a call and return what the engine needs, or null when nothing happened on
 * chain. Null is not an error: an order that fills nothing is simply not a call,
 * and no CALL_PLACED may be emitted for it.
 */
export async function placeCall(
  ex: Exchange,
  window: LiveWindow,
  direction: Direction,
  now: number = Date.now(),
): Promise<PlacedCall | null> {
  // Status is time-derived on chain and the indexer lags, so re-read before writing.
  const onchain = await ex.client.getMarketOnchain(window.marketId);
  if (onchain.status !== 1) return null;

  const book = await ex.client.getBinaryOrderBook(window.pool);
  const grid = await ex.client.getBinaryBookParams(window.pool);

  // The client's own quoteBinaryStake reads the live websocket store and returns
  // null unless the market is being tailed. This helper works off a fetched book.
  const quote = quoteBinaryStakeOverBook(book as any, sideFor(direction) as any, STAKE, ONE_COLLATERAL, grid as any);
  if (!quote) return null;   // the book is too thin to fill a whole stake

  const res = await ex.trader.placeOrder({
    pool: window.pool,
    side: quote.side,
    price: quote.yesPrice,
    quantity: quote.quantity,
    orderType: ORDER_TYPE.MARKET,
  });

  const fills = res.fills ?? [];
  if (!fills.length) return null;

  // The filled size field is quantityFilled. A fill has no plain quantity field.
  const shares = fills.reduce((n, f) => n + BigInt(f.quantityFilled ?? 0n), 0n);
  if (shares <= 0n) return null;

  // Weight the entry by size, so a fill that swept two levels prices honestly.
  const weighted = fills.reduce((n, f) => n + BigInt(f.fillPrice) * BigInt(f.quantityFilled ?? 0n), 0n);
  const averageYes = weighted / shares;

  // A non-empty fill is itself proof the order executed, so the receipt status
  // adds nothing here that the fills have not already said.
  const txHash = hashOf(res) ?? "";
  return {
    callId: txHash,
    marketId: window.marketId,
    asset: window.asset,
    direction,
    entryPrice: entryPriceFrom(averageYes, direction),
    windowId: currentWindowId(now),
    shares,
    txHash,
    marketExpiry: window.expiry,
  };
}
