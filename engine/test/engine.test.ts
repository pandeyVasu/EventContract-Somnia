import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEC_RULES, FIXED_RULES, type Rules } from "../src/rules.ts";
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
