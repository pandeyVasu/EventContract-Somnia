// Spike 3: how settled markets look, and how long settlement takes.
//
// Answers three open questions from the plan:
//   1. oracle settlement latency after a window closes
//   2. whether a voided market shows up in a Finalized listing at all
//   3. which fields the adapter should read to decide won / lost / void

import { iso, makeExchange, shutdown } from "./client.ts";

const ex = makeExchange();

const finalized = (await ex.client.listBinaryMarkets({ status: "Finalized", limit: 200 })) as any[];
console.log(`listBinaryMarkets({ status: "Finalized" }) returned ${finalized.length}`);

const modes = new Map<string, number>();
for (const m of finalized) modes.set(`${m.mode}/${m.intervalSec}s`, (modes.get(`${m.mode}/${m.intervalSec}s`) ?? 0) + 1);
console.log("finalized by mode and window:", [...modes].map(([k, v]) => `${k}=${v}`).join(", "));

// The listing is dominated by short fixed-strike markets. Sample both kinds so the
// reference markets the game actually trades are represented.
const referenceOnes = finalized.filter((m) => m.mode === "reference").slice(0, 8);
const fixedOnes = finalized.filter((m) => m.mode === "fixed").slice(0, 6);
console.log(`sampling ${referenceOnes.length} reference and ${fixedOnes.length} fixed markets`);

const rows: any[] = [];
let voidedSeen = 0;
for (const m of [...referenceOnes, ...fixedOnes]) {
  let onchain: any = null;
  let err = "";
  try {
    onchain = await ex.client.getMarketOnchain(m.marketId);
  } catch (e) {
    err = (e as Error).message.slice(0, 40);
  }
  const expiry = Number(m.expiry);
  const resolvedAt = Number(m.resolvedAtTimestamp ?? 0);
  if (onchain?.isVoided) voidedSeen++;
  rows.push({
    asset: m.asset,
    mode: m.mode,
    intervalSec: Number(m.intervalSec),
    expiry: iso(expiry),
    resolvedAt: resolvedAt ? iso(resolvedAt) : "-",
    settleLagSec: resolvedAt ? resolvedAt - expiry : null,
    indexerStatus: m.status,
    chainStatus: onchain?.status ?? err,
    isResolved: onchain?.isResolved,
    isVoided: onchain?.isVoided,
    winningOutcome: onchain?.winningOutcome,
    indexerVoided: m.voided,
  });
}
console.table(rows);

const lags = rows.map((r) => r.settleLagSec).filter((n): n is number => typeof n === "number" && n >= 0);
if (lags.length) {
  lags.sort((a, b) => a - b);
  console.log(`\nsettlement lag after expiry, ${lags.length} samples: `
    + `min ${lags[0]}s, median ${lags[Math.floor(lags.length / 2)]}s, max ${lags.at(-1)}s`);
} else {
  console.log("\nno resolved timestamps to measure settlement lag from");
}
console.log(`voided markets in this sample: ${voidedSeen}`);
console.log("winningOutcome convention: 0 = YES = Up, 1 = NO = Down");

await shutdown(ex);
