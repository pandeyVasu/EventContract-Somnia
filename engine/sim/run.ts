// Season simulator. Player archetypes play 28 days of BTC/ETH 15-minute windows
// against the pure engine, under SPEC, FIXED and LOCKED rules. Prints what each
// archetype ends the season with and checks the LOCKED calibration gate.
// Deterministic: seeded PRNG. `node sim/run.ts [seed]`.

import { SPEC_RULES, FIXED_RULES, LOCKED_RULES, upgradeFrom, type Rules, type Direction } from "../src/rules.ts";
import { initialState, applySafe, available, reduce } from "../src/engine.ts";
import { farmValue, hitRate } from "../src/score.ts";
import type { GameState, Player, Event } from "../src/types.ts";

const DAYS = 28;
const WINDOWS_PER_DAY = 96;
const ASSETS = ["BTC", "ETH"];
const VOID_RATE = 0.02;
const ENTRY_MIN = 0.35;   // entry price (probability of the chosen side) sampled uniformly per call
const ENTRY_MAX = 0.65;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Archetype {
  id: string;
  hitRate: number;              // P(correct) on a normal call
  sessionsPerDay: number;       // windows played per day, 2 markets each
  hedge: boolean;               // Up AND Down on every market
  snipe: boolean;               // enter at 0.95 with 95% accuracy
}

/*
 * Why there is no `pickDirection` here any more.
 *
 * Each archetype used to carry one, and a `needsDriven` implementation picked
 * Down while a build was running and Up otherwise. The value was computed every
 * call and then thrown away with `void wanted;`, so the archetypes claimed a
 * behaviour the simulation never had.
 *
 * It was thrown away because it cannot be used, not by oversight. The market's
 * result is fixed before anyone calls it, and the archetype fixes P(correct).
 * Those two together already determine the direction: a correct call IS the
 * result, a wrong call is its opposite. There is no freedom left for a
 * preference to occupy. Feeding the preference into the wrong-call branch only
 * — the other repair that suggests itself — would make intent govern the calls
 * a player got wrong and not the ones they got right, which is backwards, and
 * would skew the earned resource mix on exactly the losing calls that earn
 * nothing.
 *
 * So the field is gone and the names below say what is actually simulated. A
 * genuine needs-driven player would have to trade hit rate for resource choice
 * — calling Down for Time when they read Up — and that is a different model
 * whose numbers the cost tables have never been calibrated against.
 */

const ARCHETYPES: Archetype[] = [
  { id: "casual-55%",  hitRate: 0.55, sessionsPerDay: 2, hedge: false, snipe: false },
  { id: "sharp-65%",   hitRate: 0.65, sessionsPerDay: 4, hedge: false, snipe: false },
  { id: "allup-55%",   hitRate: 0.55, sessionsPerDay: 4, hedge: false, snipe: false },
  { id: "perfect-100%",hitRate: 1.00, sessionsPerDay: 4, hedge: false, snipe: false },
  { id: "coinflip-50%",hitRate: 0.50, sessionsPerDay: 4, hedge: false, snipe: false },
  { id: "HEDGER",      hitRate: 0.50, sessionsPerDay: 2, hedge: true,  snipe: false },
  { id: "SNIPER",      hitRate: 0.50, sessionsPerDay: 4, hedge: false, snipe: true  },
];

/** Greedy spend: equipment when it gates the next tier, then upgrade, then next template. */
function spendGreedy(rules: Rules, state: GameState, pid: string): GameState {
  let s = state;
  let progressed = true;
  while (progressed) {
    progressed = false;
    const p = s.players[pid]!;
    const coins = available(p, "coins", s.windowId);
    for (const f of p.farms) {
      if (f.build || f.tier >= rules.maxTier) continue;
      const gate = Object.entries(rules.equipment).find(([id, d]) => d.unlocksTier === f.tier + 1 && !f.equipment.includes(id as never));
      if (gate && coins >= gate[1].cost) {
        const r = applySafe(rules, s, { type: "BUY_EQUIPMENT", playerId: pid, farmId: f.id, item: gate[0] as never });
        if (!r.error) { s = r.state; progressed = true; break; }
      }
      const up = upgradeFrom(rules, f.tier);
      if (up && coins >= up.cost) {
        const r = applySafe(rules, s, { type: "START_UPGRADE", playerId: pid, farmId: f.id });
        if (!r.error) { s = r.state; progressed = true; break; }
      }
    }
    if (progressed) continue;
    for (const [tid, t] of Object.entries(rules.templates)) {
      if (t.cost === 0 || p.farms.some((f) => f.template === tid)) continue;
      if (coins >= t.cost) {
        const r = applySafe(rules, s, { type: "BUY_TEMPLATE", playerId: pid, template: tid as never });
        if (!r.error) { s = r.state; progressed = true; }
      }
      break; // templates are sequential; only the next one is buyable
    }
  }
  return s;
}

export function simulate(rules: Rules, seed: number): GameState {
  const rng = mulberry32(seed);
  let s = initialState(0);
  for (const a of ARCHETYPES) s = reduce(rules, s, { type: "PLAYER_JOIN", playerId: a.id });

  const pending: { marketId: string; windowId: number; result: "up" | "down" | "void" }[] = [];

  for (let w = 0; w < DAYS * WINDOWS_PER_DAY; w++) {
    s = reduce(rules, s, { type: "WINDOW_TICK", windowId: w });

    // settle last window's markets
    while (pending.length && pending[0]!.windowId < w) {
      const m = pending.shift()!;
      s = reduce(rules, s, { type: "CALL_SETTLED", marketId: m.marketId, result: m.result, settledAtWindow: w });
    }
    for (const a of ARCHETYPES) s = spendGreedy(rules, s, a.id);

    // this window's markets
    const outcomes = ASSETS.map((asset) => ({
      asset,
      marketId: `${asset}-${w}`,
      result: rng() < VOID_RATE ? ("void" as const) : rng() < 0.5 ? ("up" as const) : ("down" as const),
    }));
    for (const o of outcomes) pending.push({ marketId: o.marketId, windowId: w, result: o.result });

    const windowInDay = w % WINDOWS_PER_DAY;
    for (const a of ARCHETYPES) {
      // play evenly spaced sessions through the day
      const playThis = windowInDay % Math.floor(WINDOWS_PER_DAY / a.sessionsPerDay) === 0;
      if (!playThis) continue;
      for (const o of outcomes) {
        const events: Event[] = [];
        if (a.hedge) {
          for (const d of ["up", "down"] as Direction[]) {
            events.push({ type: "CALL_PLACED", playerId: a.id, callId: `${a.id}:${o.marketId}:${d}`, marketId: o.marketId, asset: o.asset, windowId: w, direction: d, entryPrice: 0.5 });
          }
        } else {
          const truth = o.result === "void" ? (rng() < 0.5 ? "up" : "down") : o.result;
          const acc = a.snipe ? 0.95 : a.hitRate;
          const price = a.snipe ? 0.95 : ENTRY_MIN + rng() * (ENTRY_MAX - ENTRY_MIN);
          // A player with hit rate h is right with probability h. Being right
          // is the same thing as having called the result, so the direction
          // follows from the two and is not a separate choice. Which resource
          // they earn therefore tracks the market, not their needs.
          const correct = rng() < acc;
          const direction: Direction = correct ? truth : truth === "up" ? "down" : "up";
          events.push({ type: "CALL_PLACED", playerId: a.id, callId: `${a.id}:${o.marketId}`, marketId: o.marketId, asset: o.asset, windowId: w, direction, entryPrice: price });
        }
        for (const e of events) s = applySafe(rules, s, e).state;
      }
    }
  }
  // final settle
  const wEnd = DAYS * WINDOWS_PER_DAY;
  s = reduce(rules, s, { type: "WINDOW_TICK", windowId: wEnd });
  for (const m of pending) s = reduce(rules, s, { type: "CALL_SETTLED", marketId: m.marketId, result: m.result, settledAtWindow: wEnd });
  return s;
}

/** The plan's calibration gate, as [name, pass, detail] rows. */
export function calibrationGate(rules: Rules, s: GameState): [string, boolean, string][] {
  const casual = s.players["casual-55%"]!;
  const sharp = s.players["sharp-65%"]!;
  const wheat = (p: Player) => p.farms.find((f) => f.template === "wheat")!;
  const expiryLoss = (p: Player) => (p.stats.coinsEarned === 0 ? 0 : p.stats.coinsExpired / p.stats.coinsEarned);
  const sharpAllEquipment = Object.keys(rules.equipment).every((e) => wheat(sharp).equipment.includes(e as never));
  return [
    ["casual 55% (4 calls/day) reaches Wheat T4", wheat(casual).tier >= 4, `tier ${wheat(casual).tier}`],
    ["sharp 65% (8 calls/day) finishes Wheat T5", wheat(sharp).tier >= 5, `tier ${wheat(sharp).tier}`],
    ["sharp 65% owns all equipment", sharpAllEquipment, wheat(sharp).equipment.join(",") || "none"],
    ["casual coin expiry loss < 15%", expiryLoss(casual) < 0.15, `${(expiryLoss(casual) * 100).toFixed(1)}%`],
    ["sharp coin expiry loss < 15%", expiryLoss(sharp) < 0.15, `${(expiryLoss(sharp) * 100).toFixed(1)}%`],
  ];
}

function report(label: string, rules: Rules, s: GameState) {
  console.log(`\n=== ${label} ===`);
  const rows = Object.values(s.players).map((p) => ({
    player: p.id,
    farmValue: +farmValue(rules, p).toFixed(2),
    tiers: p.farms.map((f) => `${f.template[0]}${f.tier}`).join(" "),
    hit: +(hitRate(p) * 100).toFixed(0),
    calls: p.stats.callsPlaced,
    coins: +p.stats.coinsEarned.toFixed(1),
    spent: p.stats.coinsSpent,
    expired: +p.stats.coinsExpired.toFixed(1),
    time: +p.stats.timeEarned.toFixed(1),
    tApplied: +p.stats.timeApplied.toFixed(1),
    tLost: +p.stats.timeLost.toFixed(1),
    bank: +p.timeBank.toFixed(1),
    rejected: Object.entries(p.stats.rejected).map(([k, v]) => `${k}:${v}`).join(",") || "-",
  }));
  console.table(rows);
}

// CLI entry point. Importing this module (see calibrate.ts) runs nothing.
if (process.argv[1]?.replaceAll("\\", "/").endsWith("sim/run.ts")) {
  const seed = Number(process.argv[2] ?? 42);
  report("SPEC rules (as written)", SPEC_RULES, simulate(SPEC_RULES, seed));
  report("FIXED rules (no hedge, entry <= 0.65)", FIXED_RULES, simulate(FIXED_RULES, seed));
  const locked = simulate(LOCKED_RULES, seed);
  report("LOCKED rules (shipping: 1-week expiry, risk-scaled, Time bank, void refund)", LOCKED_RULES, locked);

  // Calibration gate (plan step 2). Exit non-zero if the shipping rules miss it.
  const checks = calibrationGate(LOCKED_RULES, locked);
  console.log("\n=== Calibration gate (LOCKED rules) ===");
  for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;

  // Expiry sweep: how long must a coin live before the cost curve is reachable at all?
  console.log("\n=== Expiry sweep (FIXED rules): tiers reached per archetype ===");
  const sweep: Record<string, Record<string, string>> = {};
  for (const [label, expiryRounds] of [["1 window (spec)", 1], ["1 day", 96], ["1 week", 672], ["season", 2688]] as const) {
    const s = simulate({ ...FIXED_RULES, expiryRounds }, seed);
    sweep[label] = Object.fromEntries(
      Object.values(s.players).map((p) => [p.id, `${p.farms.map((f) => `${f.template[0]}${f.tier}`).join(" ")} (spent ${p.stats.coinsSpent}, expired ${p.stats.coinsExpired.toFixed(0)})`]),
    );
  }
  console.table(sweep);

  // Cost-curve check: what does the full tree cost, versus what a season can yield?
  const r = LOCKED_RULES;
  const wheatToT5 = r.upgrades.reduce((n, u) => n + u.cost, 0) + Object.values(r.equipment).reduce((n, e) => n + e.cost, 0);
  const allTemplates = Object.values(r.templates).reduce((n, t) => n + t.cost, 0);
  const seasonCalls = DAYS * r.dailyCallCap;
  console.log(`\nCost curve: Wheat T1->T5 incl. equipment = ${wheatToT5} coins; all templates = ${allTemplates} coins.`);
  console.log(`Season budget: ${seasonCalls} calls max; at 55% all-Up = ${Math.round(seasonCalls * 0.55)} coins; at 100% all-Up = ${seasonCalls} coins.`);
}
