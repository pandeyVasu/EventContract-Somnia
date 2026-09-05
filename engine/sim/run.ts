// Season simulator. Player archetypes play 28 days of BTC/ETH 15-minute windows
// against the pure engine, under SPEC rules and FIXED rules. Prints what each
// archetype ends the season with. Deterministic: seeded PRNG.

import { SPEC_RULES, FIXED_RULES, upgradeFrom, type Rules, type Direction } from "../src/rules.ts";
import { initialState, applySafe, available, reduce } from "../src/engine.ts";
import { farmValue, hitRate } from "../src/score.ts";
import type { GameState, Player, Event } from "../src/types.ts";

const DAYS = 28;
const WINDOWS_PER_DAY = 96;
const ASSETS = ["BTC", "ETH"];
const VOID_RATE = 0.02;

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
  pickDirection: (p: Player, rng: () => number) => Direction;
}

const needsDriven = (p: Player): Direction => (p.farms.some((f) => f.build) ? "down" : "up");

const ARCHETYPES: Archetype[] = [
  { id: "casual-55%",  hitRate: 0.55, sessionsPerDay: 2, hedge: false, snipe: false, pickDirection: (_, r) => (r() < 0.5 ? "up" : "down") },
  { id: "sharp-65%",   hitRate: 0.65, sessionsPerDay: 4, hedge: false, snipe: false, pickDirection: needsDriven },
  { id: "allup-55%",   hitRate: 0.55, sessionsPerDay: 4, hedge: false, snipe: false, pickDirection: () => "up" },
  { id: "perfect-100%",hitRate: 1.00, sessionsPerDay: 4, hedge: false, snipe: false, pickDirection: needsDriven },
  { id: "coinflip-50%",hitRate: 0.50, sessionsPerDay: 4, hedge: false, snipe: false, pickDirection: needsDriven },
  { id: "HEDGER",      hitRate: 0.50, sessionsPerDay: 2, hedge: true,  snipe: false, pickDirection: () => "up" },
  { id: "SNIPER",      hitRate: 0.50, sessionsPerDay: 4, hedge: false, snipe: true,  pickDirection: needsDriven },
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

function simulate(rules: Rules, seed: number): GameState {
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
          const price = a.snipe ? 0.95 : 0.5;
          const wanted = a.pickDirection(s.players[a.id]!, rng);
          // A player with hit rate h is right with probability h regardless of what they "wanted";
          // the wanted direction only matters when they are right (it is what they called).
          const correct = rng() < acc;
          const direction: Direction = correct ? truth : truth === "up" ? "down" : "up";
          // needs-driven players still get their wanted resource only when truth agrees; record intent for realism
          void wanted;
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
    tApplied: p.stats.timeApplied,
    tLost: +p.stats.timeLost.toFixed(1),
    rejected: Object.entries(p.stats.rejected).map(([k, v]) => `${k}:${v}`).join(",") || "-",
  }));
  console.table(rows);
}

const seed = Number(process.argv[2] ?? 42);
report("SPEC rules (as written)", SPEC_RULES, simulate(SPEC_RULES, seed));
report("FIXED rules (no hedge, entry <= 0.65)", FIXED_RULES, simulate(FIXED_RULES, seed));

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
const r = SPEC_RULES;
const wheatToT5 = r.upgrades.reduce((n, u) => n + u.cost, 0) + Object.values(r.equipment).reduce((n, e) => n + e.cost, 0);
const allTemplates = Object.values(r.templates).reduce((n, t) => n + t.cost, 0);
const seasonCalls = DAYS * r.dailyCallCap;
console.log(`\nCost curve: Wheat T1->T5 incl. equipment = ${wheatToT5} coins; all templates = ${allTemplates} coins.`);
console.log(`Season budget: ${seasonCalls} calls max; at 55% all-Up = ${Math.round(seasonCalls * 0.55)} coins; at 100% all-Up = ${seasonCalls} coins.`);
