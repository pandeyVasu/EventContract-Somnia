// Spike 4: place one real fixed-stake call on a live market.
//
//   node --env-file=../.env src/place.ts up            (Up  = BUY_YES on market.json)
//   node --env-file=../.env src/place.ts down ETH      (Down = BUY_NO, same window, other asset)
//
// This is the raw tier end to end: fetch the book, quote a fixed stake over it,
// then send a MARKET order at the protective price the quote returns. The result
// is appended to spike/placed.json for redeem.ts.

import { appendFileSync, readFileSync } from "node:fs";
import { ORDER_TYPE, quoteBinaryStakeOverBook } from "@somnia-chain/markets-sdk";
import { ONE_COLLATERAL, STAKE, dump, iso, makeExchange, shutdown, toProbability, txLink } from "./client.ts";

const direction = (process.argv[2] ?? "up").toLowerCase();
if (direction !== "up" && direction !== "down") throw new Error("usage: place.ts up|down");
const side = direction === "up" ? "BUY_YES" : "BUY_NO";

const ex = makeExchange();
const saved = JSON.parse(readFileSync(new URL("../market.json", import.meta.url), "utf8"));

// Optional second argument: trade the other asset in the same window, which is
// how the demo shows BTC Up and ETH Down side by side.
const wantAsset = (process.argv[3] ?? saved.asset).toUpperCase();
let pick = saved;
if (wantAsset !== saved.asset) {
  const live = (await ex.client.listLiveBinaryMarkets({ limit: 100 })) as any[];
  const match = live.find((m) =>
    m.asset === wantAsset && m.mode === "reference"
    && Number(m.intervalSec) === Number(saved.intervalSec)
    && Number(m.expiry) === Math.floor(new Date(saved.expiry).getTime() / 1000));
  if (!match) throw new Error(`no ${wantAsset} market in the same window as ${saved.asset}`);
  pick = { ...saved, asset: wantAsset, marketId: String(match.marketId), pool: match.poolAddress };
}
console.log(`market: ${pick.asset} ${pick.intervalSec}s, expiry ${pick.expiry}, id ${pick.marketId}`);
console.log(`calling ${direction.toUpperCase()} (${side}) with a ${Number(STAKE) / Number(ONE_COLLATERAL)} tUSDC stake`);

// Never write without re-reading the chain: the indexer lags and status is time-derived.
const onchain = (await ex.client.getMarketOnchain(pick.marketId)) as any;
const secondsLeft = Math.floor(new Date(pick.expiry).getTime() / 1000 - Date.now() / 1000);
console.log(`chain status ${onchain.status}, ${Math.round(secondsLeft / 60)} minutes left`);
if (onchain.status !== 1) throw new Error(`market is not Trading (status ${onchain.status})`);
if (secondsLeft < 300) throw new Error(`only ${secondsLeft}s left; it will lock before the order lands`);

const book = (await ex.client.getBinaryOrderBook(pick.pool)) as any;
const grid = (await ex.client.getBinaryBookParams(pick.pool)) as any;
const levels = side === "BUY_YES" ? book.yesAsks : book.noAsks;
console.log(`book: ${levels.length} levels on our side`,
  levels.slice(0, 3).map((l: any) => `${toProbability(l.price)}@${l.quantity}`).join(" "));

// The client's quoteBinaryStake reads the live websocket store and returns null
// unless the market is being tailed. The pure helper takes a fetched book.
const quote = quoteBinaryStakeOverBook(book, side as any, STAKE, ONE_COLLATERAL, grid);
if (!quote) throw new Error("the book cannot fill this stake");
dump("quote:", quote);

const res = (await ex.trader.placeOrder({
  pool: pick.pool,
  side: quote.side,
  price: quote.yesPrice,
  quantity: quote.quantity,
  orderType: ORDER_TYPE.MARKET,
})) as any;
dump("placeOrder result:", res);

const fills = res.fills ?? [];
if (!fills.length) {
  console.log("\nNO FILLS. Nothing happened on chain, so this is not a call.");
  process.exitCode = 1;
} else {
  // fillPrice is always the YES price, even on BUY_NO.
  const yesPrice = toProbability(BigInt(fills[0].fillPrice ?? fills[0].price));
  const entryProbability = side === "BUY_YES" ? yesPrice : 1 - yesPrice;
  // The filled size field is quantityFilled. A fill carries no plain quantity field,
  // and reading one silently reports a zero-share fill.
  const shares = fills.reduce((n: bigint, f: any) => n + BigInt(f.quantityFilled ?? 0n), 0n);
  console.log(`\nfilled ${fills.length} time(s), ${shares} shares`);
  console.log(`YES price ${yesPrice}, entry probability for ${direction.toUpperCase()} = ${entryProbability.toFixed(4)}`);
  const hash = res.hash ?? res.transactionHash;
  if (hash) console.log("receipt:", txLink(hash));

  appendFileSync(new URL("../placed.json", import.meta.url),
    JSON.stringify({
      at: iso(Math.floor(Date.now() / 1000)),
      marketId: pick.marketId, pool: pick.pool, asset: pick.asset,
      intervalSec: pick.intervalSec, expiry: pick.expiry,
      direction, side, outcomeIdx: side === "BUY_YES" ? 0 : 1,
      shares: String(shares), entryProbability, hash, orderId: String(res.orderId ?? ""),
    }) + "\n");
  console.log("appended to spike/placed.json");
}

await shutdown(ex);
