// Can a one-minute market carry an Up/Down call?
//
// One-minute markets on this venue are `mode: "fixed"`: they ask whether the
// price ends above a strike, not which way it moved. Those are the same question
// only if the strike is the price at the moment the round opened.
//
// If consecutive rounds carry strikes that track the market, the strike is spot
// at open and a direction call is honest. If they sit on round numbers, or repeat
// across rounds, it is a ladder and calling it "Up" would be a lie.

import { makeExchange, shutdown, iso } from "./client.ts";

const ex = makeExchange();
const client = ex.client as any;

const finished = (await client.listBinaryMarkets({ status: "Finalized", limit: 60, intervalSec: 60 })) as any[];
console.log(`finished one-minute markets sampled: ${finished.length}`);

if (!finished.length) {
  console.log("none to inspect");
} else {
  console.log("\nevery field on one of them:");
  console.log(JSON.stringify(finished[0], (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  const byAsset = new Map<string, any[]>();
  for (const m of finished) {
    const a = String(m.asset);
    if (!byAsset.has(a)) byAsset.set(a, []);
    byAsset.get(a)!.push(m);
  }

  for (const [asset, markets] of byAsset) {
    const rows = markets
      .sort((a, b) => Number(a.expiry) - Number(b.expiry))
      .slice(-12)
      .map((m) => ({
        expiry: iso(Number(m.expiry)),
        strike: String(m.strike ?? "-"),
        mode: String(m.mode),
        resolved: Boolean(m.isResolved ?? m.resolved),
        winning: m.winningOutcome ?? "-",
      }));
    console.log(`\n${asset}: last ${rows.length} one-minute rounds`);
    console.table(rows);

    const strikes = [...new Set(rows.map((r) => r.strike))];
    console.log(`distinct strikes across those rounds: ${strikes.length}`);
    console.log(
      strikes.length === 1
        ? "  One strike for every round: a fixed ladder, NOT a direction call."
        : "  The strike moves each round, which is what spot-at-open looks like.",
    );
  }
}

await shutdown(ex);
