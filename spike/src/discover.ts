// Spike 2: find the live BTC/ETH Up/Down markets we can actually trade.
//
// Answers the plan's open question: which reference-mode window lengths exist on
// testnet, and how many are tradeable at the same moment. Writes the best
// candidate to market.json so place.ts can pick it up.
//
// FINDING (2026-09-05): there are no 900-second reference markets on testnet.
// Reference windows run 3600s, 14400s, 86400s and 3888000s. The 60s and 300s
// markets are `mode: "fixed"`, strike-based, and are the wrong instrument: the
// game is a direction call, not a strike bet. The shortest usable window is one
// hour.

import { writeFileSync } from "node:fs";
import { iso, makeExchange, shutdown, toProbability } from "./client.ts";

/** Reference windows we would accept, shortest first. */
const PREFERRED_INTERVALS = [900, 3600, 14400, 86400];
const MIN_SECONDS_LEFT = 5 * 60;   // skip markets that lock before an order lands

const ex = makeExchange();
const now = Math.floor(Date.now() / 1000);

const live = (await ex.client.listLiveBinaryMarkets({ limit: 100 })) as any[];
console.log(`listLiveBinaryMarkets returned ${live.length} markets`);

const byMode = new Map<string, number>();
for (const m of live) byMode.set(m.mode, (byMode.get(m.mode) ?? 0) + 1);
console.log("modes:", [...byMode].map(([k, v]) => `${k}=${v}`).join(", "));

const reference = live.filter((m) => m.mode === "reference");
const intervals = [...new Set(reference.map((m) => Number(m.intervalSec)))].sort((a, b) => a - b);
console.log("reference window lengths live (seconds):", intervals.join(", "));

const usable = reference.filter((m) => PREFERRED_INTERVALS.includes(Number(m.intervalSec)));
console.log(`reference markets in a window length we would trade: ${usable.length}`);

const rows: any[] = [];
for (const m of usable) {
  const left = Number(m.expiry) - now;
  let onchain: any = null;
  let err = "";
  try {
    onchain = await ex.client.getMarketOnchain(m.marketId);
  } catch (e) {
    err = (e as Error).message.slice(0, 60);
  }
  rows.push({
    asset: m.asset,
    intervalSec: Number(m.intervalSec),
    expiry: iso(m.expiry),
    leftMin: Math.round(left / 60),
    indexerStatus: m.status,
    chainStatus: onchain?.status ?? err,
    pool: m.pool ?? m.poolAddress,
    marketId: String(m.marketId),
    tradeable: onchain?.status === 1 && left > MIN_SECONDS_LEFT,
  });
}

rows.sort((a, b) => a.intervalSec - b.intervalSec || a.leftMin - b.leftMin);
console.table(rows.map(({ marketId, pool, ...rest }) => ({ ...rest, marketId: marketId.slice(0, 10) + "..." })));

const tradeable = rows.filter((r) => r.tradeable);
console.log(`\nTRADEABLE NOW (chain status 1, over ${MIN_SECONDS_LEFT / 60} minutes left): ${tradeable.length}`);
for (const iv of [...new Set(tradeable.map((r) => r.intervalSec))].sort((a, b) => a - b)) {
  const assets = tradeable.filter((r) => r.intervalSec === iv).map((r) => r.asset);
  console.log(`  ${iv}s: ${assets.join(", ")}  (BTC+ETH together: ${assets.includes("BTC") && assets.includes("ETH")})`);
}

if (!tradeable.length) {
  console.log("\nno tradeable market right now");
} else {
  // Shortest window first: the demo wants the fastest settlement it can get.
  const pick = tradeable[0]!;
  let bookNote = "unread";
  try {
    // The book is split by outcome: yesBids/yesAsks/noBids/noAsks. There are no
    // plain `bids`/`asks` arrays, and reading those silently reports an empty book.
    const book = (await ex.client.getBinaryOrderBook(pick.pool)) as any;
    const yesAsks = book?.yesAsks ?? [];
    const noAsks = book?.noAsks ?? [];
    bookNote = `${yesAsks.length} yes asks, ${noAsks.length} no asks`
      + (yesAsks[0] ? `, best Up ${toProbability(BigInt(yesAsks[0].price))}` : ", no Up offer")
      + (noAsks[0] ? `, best Down ${toProbability(BigInt(noAsks[0].price))}` : ", no Down offer");
  } catch (e) {
    bookNote = `getBinaryOrderBook failed: ${(e as Error).message.slice(0, 80)}`;
  }
  console.log(`\npicked ${pick.asset} ${pick.intervalSec}s, expires ${pick.expiry} (${pick.leftMin} min)`);
  console.log("order book:", bookNote);
  writeFileSync(new URL("../market.json", import.meta.url), JSON.stringify(pick, null, 2));
  console.log("wrote spike/market.json");
}

await shutdown(ex);
