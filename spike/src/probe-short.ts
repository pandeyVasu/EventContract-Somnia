// The full menu of window lengths this venue runs, and which of them are
// direction rounds.
//
// Only `mode === "reference"` markets carry an Up/Down question. A `fixed`
// market asks whether the price ends above a strike, which is a different bet
// and cannot back a direction call. So a window length is only useful to this
// game if it exists in reference mode.

import { makeExchange, shutdown, iso } from "./client.ts";

const ex = makeExchange();
const now = Math.floor(Date.now() / 1000);
const client = ex.client as any;

const LENGTHS: [number, string][] = [
  [60, "1 min"],
  [300, "5 min"],
  [900, "15 min"],
  [1800, "30 min"],
  [3600, "1 hour"],
  [14400, "4 hours"],
  [86400, "1 day"],
  [604800, "1 week"],
];

const rows: Record<string, unknown>[] = [];

for (const [intervalSec, label] of LENGTHS) {
  let live: any[] = [];
  let finished: any[] = [];
  try {
    live = (await client.listLiveBinaryMarkets({ limit: 100, intervalSec })) as any[];
  } catch { /* treated as none */ }
  try {
    finished = (await client.listBinaryMarkets({ status: "Finalized", limit: 100, intervalSec })) as any[];
  } catch { /* treated as none */ }

  const modesOf = (ms: any[]) => [...new Set(ms.map((m) => String(m.mode)))].sort().join("+") || "-";
  const liveReference = live.filter((m) => String(m.mode) === "reference");
  const finishedReference = finished.filter((m) => String(m.mode) === "reference");
  const latest = finished.length ? Math.max(...finished.map((m) => Number(m.expiry))) : 0;

  rows.push({
    window: label,
    seconds: intervalSec,
    live: live.length,
    liveModes: modesOf(live),
    "live Up/Down": liveReference.length,
    soonestLive: liveReference.length ? iso(Math.min(...liveReference.map((m) => Number(m.expiry)))) : "-",
    everFinished: finished.length,
    "finished Up/Down": finishedReference.length,
    lastSeenMinAgo: latest ? Math.round((now - latest) / 60) : "-",
  });
}

console.table(rows);

console.log("\nOnly the 'Up/Down' columns matter: a fixed market asks about a strike, not a direction.");

const usable = rows.filter((r) => Number(r["live Up/Down"]) > 0);
if (usable.length) {
  console.log("\nUsable right now, shortest first:");
  for (const r of usable.sort((a, b) => Number(a.seconds) - Number(b.seconds))) {
    console.log(`  ${r.window} — ${r["live Up/Down"]} live, soonest settles ${r.soonestLive}`);
  }
} else {
  console.log("\nNo direction round of any length is live right now.");
}

await shutdown(ex);
