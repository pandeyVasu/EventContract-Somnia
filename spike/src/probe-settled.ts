// Where does a resolved round record the price it settled at?
//
// The on-chain market object carries the winning outcome but no settlement
// price, so the fixed-mode check in combo.ts cannot compare "settled at or
// above the strike" against what the venue actually paid. This dumps every
// field the indexer holds for a finished round, on chain and off, so that
// check can point at the right one.

import { makeExchange, shutdown } from "./client.ts";

const ex = makeExchange();
const client = ex.client as any;

const finished = (await client.listBinaryMarkets({ status: "Finalized", limit: 5, intervalSec: 60 })) as any[];
console.log(`finished one-minute rounds: ${finished.length}`);
if (!finished.length) {
  console.log("none to inspect");
} else {
  const m = finished[finished.length - 1]!;
  const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
  console.log("\nindexer fields:");
  console.log(json(m));
  const onchain = await client.getMarketOnchain(String(m.marketId)).catch((e: Error) => ({ error: e.message }));
  console.log("\nchain fields:");
  console.log(json(onchain));
}

await shutdown(ex);
