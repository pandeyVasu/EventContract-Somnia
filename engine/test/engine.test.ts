import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEC_RULES, FIXED_RULES, LOCKED_RULES, rewardUnits, type Rules } from "../src/rules.ts";
import { initialState, reduce, available } from "../src/engine.ts";
import { farmValue, leaderboard } from "../src/score.ts";
import { RuleViolation, type Event, type GameState } from "../src/types.ts";

const P = "alice";

function run(rules: Rules, events: Event[], start = initialState()): GameState {
  return events.reduce((s, e) => reduce(rules, s, e), start);
}

function join(): Event { return { type: "PLAYER_JOIN", playerId: P }; }
function tick(w: number): Event { return { type: "WINDOW_TICK", windowId: w }; }
function call(id: string, market: string, direction: "up" | "down", price = 0.5, windowId = 0): Event {
  return { type: "CALL_PLACED", playerId: P, callId: id, marketId: market, asset: "BTC", windowId, direction, entryPrice: price };
}
function settle(market: string, result: "up" | "down" | "void", at: number): Event {
  return { type: "CALL_SETTLED", marketId: market, result, settledAtWindow: at };
}
function expectViolation(reason: string, fn: () => unknown) {
  assert.throws(fn, (e: unknown) => e instanceof RuleViolation && e.reason === reason, `expected ${reason}`);
}

/** Spec rules with expiry switched off. Needed by every build test: under the spec's
 *  one-round expiry, 20 coins can never be held at once (see the contradiction test). */
const LONG: Rules = { ...SPEC_RULES, expiryRounds: 1_000_000 };

/** Give a player N coins directly via N correct Up calls, spread over days so the cap never bites. */
function grant(rules: Rules, s: GameState, coins: number): GameState {
  let state = s;
  for (let i = 0; i < coins; i++) {
    const w = state.windowId;
    const m = `grant-${w}-${i}`;
    state = reduce(rules, state, call(m, m, "up", 0.5, w));
    state = reduce(rules, state, settle(m, "up", w));
    if ((i + 1) % rules.dailyCallCap === 0) state = reduce(rules, state, tick(w + rules.windowsPerDay));
  }
  return state;
}

test("correct Up earns 1 Coin, correct Down earns 1 Time, wrong earns nothing", () => {
  let s = run(SPEC_RULES, [join(), call("c1", "btc-0", "up"), call("c2", "eth-0", "down"), call("c3", "sol-0", "up")]);
  s = run(SPEC_RULES, [settle("btc-0", "up", 1), settle("eth-0", "down", 1), settle("sol-0", "down", 1)], s);
  const p = s.players[P]!;
  assert.equal(p.stats.coinsEarned, 1);
  assert.equal(p.stats.timeEarned, 1);
  assert.equal(p.stats.callsWrong, 1);
  assert.equal(available(p, "coins", 1), 1);
});

test("reward is stake-independent: engine has no stake field at all", () => {
  const ev = call("c1", "m", "up");
  assert.ok(!("stake" in ev));
});

test("void market awards 0.5 of both resources", () => {
  const s = run({ ...SPEC_RULES, timeAutoApplies: false }, [join(), call("c1", "m", "up"), settle("m", "void", 1)]);
  const p = s.players[P]!;
  assert.equal(available(p, "coins", 1), 0.5);
  assert.equal(available(p, "time", 1), 0.5);
});

test("daily cap of 8 calls, resets next day", () => {
  let s = run(SPEC_RULES, [join()]);
  for (let i = 0; i < 8; i++) s = reduce(SPEC_RULES, s, call(`c${i}`, `m${i}`, "up"));
  expectViolation("DAILY_CAP", () => reduce(SPEC_RULES, s, call("c9", "m9", "up")));
  s = reduce(SPEC_RULES, s, tick(96));
  s = reduce(SPEC_RULES, s, call("c9", "m9", "up", 0.5, 96));
  assert.equal(s.players[P]!.stats.callsPlaced, 9);
});

test("coins expire one round after settlement", () => {
  let s = run(SPEC_RULES, [join(), call("c1", "m", "up"), settle("m", "up", 10)]);
  assert.equal(available(s.players[P]!, "coins", 10), 1);
  s = reduce(SPEC_RULES, s, tick(11));
  assert.equal(available(s.players[P]!, "coins", 11), 1, "still usable the round after");
  s = reduce(SPEC_RULES, s, tick(12));
  assert.equal(available(s.players[P]!, "coins", 12), 0, "gone two rounds after");
  assert.equal(s.players[P]!.stats.coinsExpired, 1);
});

test("Time with no running build is lost", () => {
  const s = run(SPEC_RULES, [join(), call("c1", "m", "down"), settle("m", "down", 1)]);
  assert.equal(s.players[P]!.stats.timeLost, 1);
  assert.equal(s.players[P]!.stats.timeApplied, 0);
});

test("Time removes windows from a running build; build completes on tick", () => {
  let s = run(LONG, [join()]);
  s = grant(LONG, s, 20);
  const w = s.windowId;
  s = reduce(LONG, s, { type: "START_UPGRADE", playerId: P, farmId: `${P}:wheat` });
  assert.equal(s.players[P]!.farms[0]!.build?.remainingWindows, 4);
  s = reduce(LONG, s, call("t1", "d1", "down", 0.5, w));
  s = reduce(LONG, s, settle("d1", "down", w));
  assert.equal(s.players[P]!.farms[0]!.build?.remainingWindows, 3);
  s = reduce(LONG, s, tick(w + 3));
  assert.equal(s.players[P]!.farms[0]!.tier, 2);
  assert.equal(s.players[P]!.farms[0]!.build, null);
});

test("coins committed to a build are consumed; expiry cannot claw them back", () => {
  let s = run(LONG, [join()]);
  s = grant(LONG, s, 20);
  s = reduce(LONG, s, { type: "START_UPGRADE", playerId: P, farmId: `${P}:wheat` });
  s = reduce(LONG, s, tick(s.windowId + 500));
  assert.equal(s.players[P]!.farms[0]!.tier, 2);
  assert.equal(s.players[P]!.stats.coinsSpent, 20);
});

test("tier cap: T3 needs Irrigation, equipment must be bought in order", () => {
  let s = run(LONG, [join()]);
  s = grant(LONG, s, 400);
  const farm = `${P}:wheat`;
  s = reduce(LONG, s, { type: "START_UPGRADE", playerId: P, farmId: farm });
  s = reduce(LONG, s, tick(s.windowId + 4));
  assert.equal(s.players[P]!.farms[0]!.tier, 2);
  expectViolation("TIER_CAP", () => reduce(LONG, s, { type: "START_UPGRADE", playerId: P, farmId: farm }));
  expectViolation("EQUIPMENT_ORDER", () => reduce(LONG, s, { type: "BUY_EQUIPMENT", playerId: P, farmId: farm, item: "harvester" }));
  s = reduce(LONG, s, { type: "BUY_EQUIPMENT", playerId: P, farmId: farm, item: "irrigation" });
  s = reduce(LONG, s, { type: "START_UPGRADE", playerId: P, farmId: farm });
  assert.equal(s.players[P]!.farms[0]!.build?.targetTier, 3);
  expectViolation("ALREADY_BUILDING", () => reduce(LONG, s, { type: "START_UPGRADE", playerId: P, farmId: farm }));
});

test("insufficient coins rejects the purchase and leaves state untouched", () => {
  const s = run(SPEC_RULES, [join()]);
  expectViolation("INSUFFICIENT", () => reduce(SPEC_RULES, s, { type: "START_UPGRADE", playerId: P, farmId: `${P}:wheat` }));
  assert.equal(s.players[P]!.farms[0]!.build, null);
});

test("templates unlock in sequence and add farm value", () => {
  let s = run(LONG, [join()]);
  s = grant(LONG, s, 300);
  expectViolation("TEMPLATE_ORDER", () => reduce(LONG, s, { type: "BUY_TEMPLATE", playerId: P, template: "vineyard" }));
  s = reduce(LONG, s, { type: "BUY_TEMPLATE", playerId: P, template: "orchard" });
  assert.equal(farmValue(LONG, s.players[P]!), 1 * 1.0 + 1 * 1.4);
  expectViolation("ALREADY_OWNED", () => reduce(LONG, s, { type: "BUY_TEMPLATE", playerId: P, template: "orchard" }));
});

test("SPEC rules allow the hedge: Up and Down on one market = guaranteed unit", () => {
  const s = run(SPEC_RULES, [join(), call("a", "m", "up"), call("b", "m", "down"), settle("m", "down", 1)]);
  assert.equal(s.players[P]!.stats.callsCorrect, 1);
  assert.equal(s.players[P]!.stats.timeEarned, 1);
});

test("FIXED rules forbid the hedge", () => {
  const s = run(FIXED_RULES, [join(), call("a", "m", "up")]);
  expectViolation("HEDGE", () => reduce(FIXED_RULES, s, call("b", "m", "down")));
});

test("same direction twice on one market is always a duplicate", () => {
  const s = run(SPEC_RULES, [join(), call("a", "m", "up")]);
  expectViolation("DUPLICATE_DIRECTION", () => reduce(SPEC_RULES, s, call("b", "m", "up")));
});

test("FIXED rules reject a late entry above 0.65", () => {
  const s = run(FIXED_RULES, [join()]);
  expectViolation("ENTRY_TOO_LATE", () => reduce(FIXED_RULES, s, call("a", "m", "up", 0.95)));
  assert.doesNotThrow(() => reduce(FIXED_RULES, s, call("a", "m", "up", 0.65)));
});

test("risk-scaled reward pays (1 - entryPrice)", () => {
  const rules = { ...SPEC_RULES, riskScaledReward: true };
  const s = run(rules, [join(), call("a", "m", "up", 0.8), settle("m", "up", 1)]);
  assert.ok(Math.abs(s.players[P]!.stats.coinsEarned - 0.2) < 1e-9);
});

test("reducer never mutates its input", () => {
  const s0 = run(SPEC_RULES, [join()]);
  const snapshot = JSON.stringify(s0);
  reduce(SPEC_RULES, s0, call("a", "m", "up"));
  assert.equal(JSON.stringify(s0), snapshot);
});

test("leaderboard breaks farm-value ties by hit rate", () => {
  let s = run(SPEC_RULES, [join(), { type: "PLAYER_JOIN", playerId: "bob" }]);
  s = reduce(SPEC_RULES, s, call("a", "m", "up"));
  s = reduce(SPEC_RULES, s, { type: "CALL_PLACED", playerId: "bob", callId: "b", marketId: "m", asset: "BTC", windowId: 0, direction: "down", entryPrice: 0.5 });
  s = reduce(SPEC_RULES, s, settle("m", "down", 1));
  const rows = leaderboard(SPEC_RULES, s);
  assert.equal(rows[0]!.playerId, "bob");
  assert.equal(rows[0]!.farmValue, rows[1]!.farmValue);
});

test("CONTRADICTION: under spec expiry, the cheapest upgrade (20 coins) is unreachable even at 100% accuracy", () => {
  let s = run(SPEC_RULES, [join()]);
  let peak = 0;
  for (let w = 0; w < 96 * 7; w++) {
    s = reduce(SPEC_RULES, s, tick(w));
    // best case: two markets per window, always right, cap allowing
    for (const a of ["BTC", "ETH"]) {
      const r = (() => { try { return reduce(SPEC_RULES, s, call(`${a}${w}`, `${a}${w}`, "up", 0.5, w)); } catch { return null; } })();
      if (r) { s = reduce(SPEC_RULES, r, settle(`${a}${w}`, "up", w)); }
    }
    peak = Math.max(peak, available(s.players[P]!, "coins", w));
  }
  assert.ok(peak < 20, `peak coins held = ${peak}`);
});

// ---------------------------------------------------------------------------
// LOCKED_RULES — the rules the game ships with (plan step 2)
// ---------------------------------------------------------------------------

const L = LOCKED_RULES;
const WHEAT = `${P}:wheat`;
function upgrade(): Event { return { type: "START_UPGRADE", playerId: P, farmId: WHEAT }; }

test("LOCKED reward: min(2, (1 - p) / 0.5) -> 0.5 pays 1, 0.2 pays 1.6, cap 2", () => {
  assert.ok(Math.abs(rewardUnits(L, 0.5) - 1) < 1e-9);
  assert.ok(Math.abs(rewardUnits(L, 0.2) - 1.6) < 1e-9);
  assert.ok(Math.abs(rewardUnits(L, 0.8) - 0.4) < 1e-9, "scaling still bites well above the baseline");
  assert.ok(Math.abs(rewardUnits(L, 0.01) - 1.98) < 1e-9, "cap of 2 is only reached at p -> 0");
  assert.equal(rewardUnits({ ...L, riskBaselinePrice: 0.25 }, 0.1), 2, "cap binds");
  const s = run(L, [join(), call("a", "m", "up", 0.2), settle("m", "up", 1)]);
  assert.ok(Math.abs(s.players[P]!.stats.coinsEarned - 1.6) < 1e-9);
});

test("LOCKED: a correct call is never worth nothing the player can see", () => {
  // A player who calls a round that is nearly decided has read almost nothing,
  // and the scaling says so. But they cannot see prices, so paying them 0.04 and
  // showing it as zero tells a player who was RIGHT that being right did nothing.
  assert.ok(Math.abs(rewardUnits(L, 0.98) - 0.1) < 1e-9, "an all-but-settled round still pays the floor");
  assert.ok(Math.abs(rewardUnits(L, 0.999) - 0.1) < 1e-9, "and it cannot be driven below the floor");

  // It reaches the farm, not just the formula.
  const s = run(L, [join(), call("a", "m", "up", 0.98), settle("m", "up", 1)]);
  assert.ok(Math.abs(s.players[P]!.stats.coinsEarned - 0.1) < 1e-9);

  // A wrong call is still worth nothing: the floor rewards being right, not turning up.
  const wrong = run(L, [join(), call("b", "m2", "up", 0.98), settle("m2", "down", 1)]);
  assert.equal(wrong.players[P]!.stats.coinsEarned, 0);

  // A void pays voidReward, which LOCKED sets to zero. The floor must not leak in.
  const voided = run(L, [join(), call("c", "m3", "up", 0.98), settle("m3", "void", 1)]);
  assert.equal(voided.players[P]!.stats.coinsEarned, 0, "a cancelled round is not a correct call");

  // Without the floor the number is the one that displayed as "+0 Coins".
  assert.ok(rewardUnits({ ...L, minRewardUnits: 0 }, 0.98) < 0.05);
});

test("LOCKED: the floor sits at the sniper's entry, so it pays sniping nothing extra", () => {
  // The floor has to make a correct call visible without quietly undoing the
  // risk scaling that discourages waiting for a decided round. A sniper enters
  // around 0.95, which the curve already pays 0.1 — so at 0.1 the floor never
  // binds for them. Seasons simulated across five seeds put the sniper on the
  // same tier with the floor on and off; at 0.25 it gains a tier on every seed.
  assert.ok(Math.abs(rewardUnits(L, 0.95) - 0.1) < 1e-9, "the curve, not the floor, still decides at 0.95");
  assert.ok(rewardUnits(L, 0.9) > 0.1, "and everything below it is pure curve");
  assert.ok(Math.abs(rewardUnits({ ...L, minRewardUnits: 0 }, 0.95) - rewardUnits(L, 0.95)) < 1e-9,
    "a sniper is paid exactly what they were paid before the floor existed");
});

test("LOCKED: first build completes after one correct Up call at a 0.5 entry", () => {
  let s = run(L, [join(), call("a", "m", "up", 0.5), settle("m", "up", 1)]);
  s = reduce(L, s, upgrade());
  assert.equal(s.players[P]!.farms[0]!.build?.remainingWindows, 1);
  s = reduce(L, s, tick(2));
  assert.equal(s.players[P]!.farms[0]!.tier, 2);
});

test("LOCKED Time bank: fills when no build is running, nothing is lost", () => {
  const s = run(L, [join(), call("a", "m", "down", 0.5), settle("m", "down", 1)]);
  const p = s.players[P]!;
  assert.equal(p.timeBank, 1);
  assert.equal(p.stats.timeLost, 0);
  assert.equal(p.stats.timeApplied, 0);
});

test("LOCKED Time bank: running build is served first, remainder banks", () => {
  let s = run(L, [join(), call("c", "m1", "up", 0.5), settle("m1", "up", 1)]);
  s = reduce(L, s, upgrade());                       // T1->T2, 1 window remaining
  s = reduce(L, s, call("d", "m2", "down", 0.2));    // 1.6 Time
  s = reduce(L, s, settle("m2", "down", 1));
  const p = s.players[P]!;
  assert.equal(p.farms[0]!.tier, 2, "build finished by the applied Time");
  assert.ok(Math.abs(p.timeBank - 0.6) < 1e-9, "excess banked");
  assert.equal(p.stats.timeApplied, 1);
});

test("LOCKED Time bank: drains into the next START_UPGRADE, keeps the remainder, completes immediately", () => {
  let s = run(L, [join()]);
  for (const [i, dir] of (["up", "down", "down", "down"] as const).entries()) {
    s = reduce(L, s, call(`c${i}`, `m${i}`, dir, 0.5));
    s = reduce(L, s, settle(`m${i}`, dir, 1));
  }
  let p = s.players[P]!;
  assert.equal(p.timeBank, 3);
  s = reduce(L, s, upgrade());                        // costs 1 coin, 1 window; bank covers it
  p = s.players[P]!;
  assert.equal(p.farms[0]!.tier, 2, "completed without a tick");
  assert.equal(p.farms[0]!.build, null);
  assert.equal(p.timeBank, 2, "remainder kept");
  assert.equal(p.stats.timeApplied, 1);
});

test("LOCKED Time bank never expires", () => {
  let s = run(L, [join(), call("a", "m", "down", 0.5), settle("m", "down", 1)]);
  s = reduce(L, s, tick(1 + L.expiryRounds * 10));
  assert.equal(s.players[P]!.timeBank, 1);
});

test("LOCKED void: no reward, daily slot refunded on the day the call was placed (cross-midnight)", () => {
  let s = run(L, [join(), tick(95)]);                 // last window of day 0
  s = reduce(L, s, call("a", "m", "up", 0.5, 95));
  s = reduce(L, s, call("b", "n", "up", 0.5, 95));
  s = reduce(L, s, tick(97));                          // day 1
  s = reduce(L, s, call("c", "o", "up", 0.5, 97));
  assert.equal(s.players[P]!.callsByDay[0], 2);
  assert.equal(s.players[P]!.callsByDay[1], 1);
  s = reduce(L, s, settle("m", "void", 97));
  const p = s.players[P]!;
  assert.equal(p.callsByDay[0], 1, "day 0 decremented");
  assert.equal(p.callsByDay[1], 1, "day 1 untouched");
  assert.equal(p.stats.callsVoid, 1);
  assert.equal(p.stats.coinsEarned, 0);
  assert.equal(p.stats.timeEarned, 0);
  assert.equal(p.timeBank, 0);
});

test("LOCKED void refund floors at zero", () => {
  let s = run(L, [join(), call("a", "m", "up", 0.5)]);
  s.players[P]!.callsByDay[0] = 0;                     // simulate a corrupt/replayed count
  s = reduce(L, s, settle("m", "void", 1));
  assert.equal(s.players[P]!.callsByDay[0], 0);
});

test("LOCKED: BTC Up + ETH Down in the same window is accepted; Up + Down on one market is not", () => {
  let s = run(L, [join()]);
  s = reduce(L, s, { type: "CALL_PLACED", playerId: P, callId: "a", marketId: "BTC-7", asset: "BTC", windowId: 7, direction: "up", entryPrice: 0.5 });
  assert.doesNotThrow(() =>
    reduce(L, s, { type: "CALL_PLACED", playerId: P, callId: "b", marketId: "ETH-7", asset: "ETH", windowId: 7, direction: "down", entryPrice: 0.5 }));
  expectViolation("HEDGE", () =>
    reduce(L, s, { type: "CALL_PLACED", playerId: P, callId: "c", marketId: "BTC-7", asset: "BTC", windowId: 7, direction: "down", entryPrice: 0.5 }));
});

test("LOCKED: entry price is never gated", () => {
  const s = run(L, [join()]);
  assert.doesNotThrow(() => reduce(L, s, call("a", "m", "up", 0.99)));
});

test("LOCKED: CALL_PLACED.windowId is informational; cap and day use state.windowId", () => {
  let s = run(L, [join(), tick(96)]);                  // day 1
  s = reduce(L, s, call("a", "m", "up", 0.5, 0));      // claims window 0 (day 0)
  assert.equal(s.players[P]!.callsByDay[1], 1);
  assert.equal(s.players[P]!.callsByDay[0], undefined);
});

test("LOCKED cost tables: Wheat T1->T5 with equipment = 36 coins, T4 path = 16", () => {
  const ups = L.upgrades.reduce((n, u) => n + u.cost, 0);
  const eq = Object.values(L.equipment).reduce((n, e) => n + e.cost, 0);
  assert.equal(ups + eq, 36);
  const t4 = L.upgrades.filter((u) => u.from <= 3).reduce((n, u) => n + u.cost, 0)
    + L.equipment.irrigation.cost + L.equipment.harvester.cost;
  assert.equal(t4, 16);
});
