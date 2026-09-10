import { test } from "node:test";
import assert from "node:assert/strict";

import { LOCKED_RULES, initialState, reduce, type Event, type GameState } from "farm-engine";
import { currentWindowId } from "../src/chain/clock.ts";
import { openMarketIds, redeemablePairs, settlementEvents, tickEvent } from "../src/game/loop.ts";
import { buildView, formatCoins, formatCoinsWithUnit, formatCountdown, formatWait, formatWindows } from "../src/game/view.ts";
import type { LiveWindow, Settlement } from "../src/chain/types.ts";

const R = LOCKED_RULES;
const ME = "0xabc";
const BTC_MARKET = "0xbtc" as `0x${string}`;
const ETH_MARKET = "0xeth" as `0x${string}`;

const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW / 1000);

function windowAt(asset: string, marketId: `0x${string}`, secondsAway = 3600): LiveWindow {
  return {
    marketId,
    pool: "0xpool" as `0x${string}`,
    asset,
    intervalSec: 14400,
    expiry: NOW_SECONDS + secondsAway,
    secondsLeft: secondsAway,
  };
}

/** Build a state by feeding real events through the real reducer. */
function stateWith(events: Event[], startWindow = 1_000_000): GameState {
  let s = initialState(0);
  for (const ev of [{ type: "WINDOW_TICK", windowId: startWindow } as Event, { type: "PLAYER_JOIN", playerId: ME } as Event, ...events]) {
    s = reduce(R, s, ev);
  }
  return s;
}

function placed(marketId: `0x${string}`, asset: string, direction: "up" | "down", entryPrice = 0.5, callId = `tx:${marketId}:${direction}`): Event {
  return { type: "CALL_PLACED", playerId: ME, callId, marketId, asset, windowId: 1_000_000, direction, entryPrice };
}

function view(state: GameState, windows: LiveWindow[] = []) {
  return buildView({ rules: R, state, playerId: ME, address: ME, windows, now: NOW });
}

// --- loop: the three things that happen without the player ------------------

test("open markets are the undecided ones, listed once", () => {
  const s = stateWith([
    placed(BTC_MARKET, "BTC", "up"),
    placed(ETH_MARKET, "ETH", "down"),
    { type: "CALL_SETTLED", marketId: ETH_MARKET, result: "down", settledAtWindow: 1_000_001 },
  ]);
  assert.deepEqual(openMarketIds(s, ME), [BTC_MARKET]);
});

test("open markets are empty for a player who does not exist", () => {
  assert.deepEqual(openMarketIds(initialState(0), "nobody"), []);
});

test("a tick is only produced when the window has actually moved", () => {
  const now = Date.now();
  const current = currentWindowId(now);
  assert.equal(tickEvent({ windowId: current, players: {} }, now), null);
  const behind = tickEvent({ windowId: current - 4, players: {} }, now);
  assert.deepEqual(behind, { type: "WINDOW_TICK", windowId: current });
});

test("a clock that has run backwards never produces an event the engine would refuse", () => {
  const now = Date.now();
  assert.equal(tickEvent({ windowId: currentWindowId(now) + 99, players: {} }, now), null);
});

test("settlements become one engine event each, stamped with the settling window", () => {
  const settled: Settlement[] = [
    { marketId: BTC_MARKET, result: "up", winningOutcome: 0 },
    { marketId: ETH_MARKET, result: "void", winningOutcome: null },
  ];
  assert.deepEqual(settlementEvents(settled, 42), [
    { type: "CALL_SETTLED", marketId: BTC_MARKET, result: "up", settledAtWindow: 42 },
    { type: "CALL_SETTLED", marketId: ETH_MARKET, result: "void", settledAtWindow: 42 },
  ]);
});

test("only winning and voided calls are worth a redemption", () => {
  const s = stateWith([placed(BTC_MARKET, "BTC", "up"), placed(ETH_MARKET, "ETH", "down")]);
  const pairs = redeemablePairs(s, ME, [
    { marketId: BTC_MARKET, result: "down", winningOutcome: 1 }, // the Up call lost
    { marketId: ETH_MARKET, result: "void", winningOutcome: null },
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]!.call.marketId, ETH_MARKET);
  assert.equal(pairs[0]!.settlement.result, "void");
});

test("a redemption pair carries the direction, which is what decides the side to burn", () => {
  const s = stateWith([placed(BTC_MARKET, "BTC", "down")]);
  const pairs = redeemablePairs(s, ME, [{ marketId: BTC_MARKET, result: "down", winningOutcome: 1 }]);
  assert.equal(pairs[0]!.call.direction, "down");
});

// --- view: time is spoken as time ------------------------------------------

test("Time reads as hours and minutes, never as a count of windows", () => {
  assert.equal(formatWindows(7), "1h 45m");
  assert.equal(formatWindows(4), "1h");
  assert.equal(formatWindows(3), "45m");
  assert.equal(formatWindows(0), "none yet");
});


test("a coin amount never reads as nothing when it is something", () => {
  // The bug this exists to stop: a correct call paid 0.1 Coins and the overlay
  // showed "+0 Coins", and the bar showed 0 while coins were really adding up.
  assert.equal(formatCoins(0.1), "0.1");
  assert.equal(formatCoins(0.25), "0.25");
  assert.equal(formatCoins(1.6), "1.6");

  // Whole numbers stay whole. Nobody wants "3.00 Coins".
  assert.equal(formatCoins(3), "3");
  assert.equal(formatCoins(0), "0");

  // Two decimals is as fine as the display goes, but a real amount below that
  // still must not print as zero.
  assert.equal(formatCoins(0.004), "0.01");
  assert.equal(formatCoins(1.666), "1.67");

  // The unit agrees with the number.
  assert.equal(formatCoinsWithUnit(1), "1 Coin");
  assert.equal(formatCoinsWithUnit(0.1), "0.1 Coins");
  assert.equal(formatCoinsWithUnit(2), "2 Coins");
});

test("the round countdown is minutes and seconds", () => {
  assert.equal(formatCountdown(522), "08:42");
  assert.equal(formatCountdown(-5), "00:00");
});

// --- view: what the screens are told ---------------------------------------

test("a fresh farm starts at tier 1 with the full day of calls", () => {
  const v = view(stateWith([]));
  assert.equal(v.callsLeftToday, 8);
  assert.equal(v.farms[0]!.tier, 1);
  assert.equal(v.coins, 0);
});

test("each placed call takes one of the day's calls", () => {
  const v = view(stateWith([placed(BTC_MARKET, "BTC", "up"), placed(ETH_MARKET, "ETH", "down")]));
  assert.equal(v.callsLeftToday, 6);
  assert.equal(v.openCalls.length, 2);
});

test("an asset already called this round is closed, with a reason a player can read", () => {
  const s = stateWith([placed(BTC_MARKET, "BTC", "up")]);
  const v = view(s, [windowAt("BTC", BTC_MARKET), windowAt("ETH", ETH_MARKET)]);
  const btc = v.assets.find((a) => a.asset === "BTC")!;
  const eth = v.assets.find((a) => a.asset === "ETH")!;
  assert.equal(btc.state.kind, "closed");
  assert.match((btc.state as { reason: string }).reason, /already called Bitcoin this round/);
  assert.equal(btc.calledDirection, "up");
  assert.equal(eth.state.kind, "open");
});

test("an asset with no live round says so rather than offering a dead button", () => {
  const v = view(stateWith([]), [windowAt("BTC", BTC_MARKET)]);
  const eth = v.assets.find((a) => a.asset === "ETH")!;
  assert.equal(eth.state.kind, "closed");
  assert.match((eth.state as { reason: string }).reason, /Nothing open for Ethereum/);
});

test("the day's last call closes both assets with the cap as the reason", () => {
  const markets = Array.from({ length: 8 }, (_, i) => `0xm${i}` as `0x${string}`);
  const s = stateWith(markets.map((m, i) => placed(m, i % 2 ? "ETH" : "BTC", "up", 0.5, `tx${i}`)));
  const v = view(s, [windowAt("BTC", BTC_MARKET), windowAt("ETH", ETH_MARKET)]);
  assert.equal(v.callsLeftToday, 0);
  for (const a of v.assets) {
    assert.equal(a.state.kind, "closed");
    assert.match((a.state as { reason: string }).reason, /No calls left today/);
  }
});

test("Bitcoin Up and Ethereum Down in the same round are both accepted", () => {
  const s = stateWith([placed(BTC_MARKET, "BTC", "up"), placed(ETH_MARKET, "ETH", "down")]);
  const v = view(s);
  assert.equal(v.openCalls.length, 2);
  assert.deepEqual(v.openCalls.map((c) => c.direction).sort(), ["down", "up"]);
});

test("a correct Up call pays Coins and a correct Down call pays Time", () => {
  const s = stateWith([
    placed(BTC_MARKET, "BTC", "up"),
    placed(ETH_MARKET, "ETH", "down"),
    { type: "CALL_SETTLED", marketId: BTC_MARKET, result: "up", settledAtWindow: 1_000_001 },
    { type: "CALL_SETTLED", marketId: ETH_MARKET, result: "down", settledAtWindow: 1_000_001 },
  ]);
  const v = view(s);
  const up = v.finishedCalls.find((c) => c.direction === "up")!;
  const down = v.finishedCalls.find((c) => c.direction === "down")!;
  assert.equal(up.outcome, "right");
  assert.equal(up.reward!.kind, "coins");
  assert.equal(down.outcome, "right");
  assert.equal(down.reward!.kind, "time");
  assert.equal(v.coins, 1); // a 0.5 entry pays one unit
});

test("a wrong call is missed and pays nothing", () => {
  const s = stateWith([
    placed(BTC_MARKET, "BTC", "up"),
    { type: "CALL_SETTLED", marketId: BTC_MARKET, result: "down", settledAtWindow: 1_000_001 },
  ]);
  const v = view(s);
  assert.equal(v.finishedCalls[0]!.outcome, "missed");
  assert.equal(v.finishedCalls[0]!.reward, null);
  assert.equal(v.coins, 0);
});

test("a contrarian call is worth more than an obvious one", () => {
  const cheap = view(stateWith([
    placed(BTC_MARKET, "BTC", "up", 0.25),
    { type: "CALL_SETTLED", marketId: BTC_MARKET, result: "up", settledAtWindow: 1_000_001 },
  ]));
  const dear = view(stateWith([
    placed(BTC_MARKET, "BTC", "up", 0.75),
    { type: "CALL_SETTLED", marketId: BTC_MARKET, result: "up", settledAtWindow: 1_000_001 },
  ]));
  assert.ok(cheap.finishedCalls[0]!.reward!.amount > dear.finishedCalls[0]!.reward!.amount);
});

test("the receipt link is the placing transaction", () => {
  const s = stateWith([placed(BTC_MARKET, "BTC", "up", 0.5, "0xdeadbeef")]);
  assert.equal(view(s).openCalls[0]!.txHash, "0xdeadbeef");
});

test("an upgrade the player cannot afford says what it needs", () => {
  const v = view(stateWith([]));
  const up = v.farms[0]!.upgrade!;
  assert.equal(up.targetTier, 2);
  assert.equal(up.cost, 1);
  assert.equal(up.affordable, false);
  assert.match(up.blockedReason!, /Needs 1 Coins/);
});

test("one correct Up call is enough to start the first build", () => {
  const s = stateWith([
    placed(BTC_MARKET, "BTC", "up"),
    { type: "CALL_SETTLED", marketId: BTC_MARKET, result: "up", settledAtWindow: 1_000_001 },
  ]);
  const up = view(s).farms[0]!.upgrade!;
  assert.equal(up.affordable, true);
  assert.equal(up.blockedReason, null);
});

test("a running build blocks another and says why", () => {
  const s = stateWith([
    placed(BTC_MARKET, "BTC", "up"),
    { type: "CALL_SETTLED", marketId: BTC_MARKET, result: "up", settledAtWindow: 1_000_001 },
    { type: "START_UPGRADE", playerId: ME, farmId: `${ME}:wheat` },
  ]);
  const farm = view(s).farms[0]!;
  // An Up call pays Coins, so the Time bank is empty and the build has to run.
  assert.equal(farm.tier, 1);
  assert.equal(farm.build!.targetTier, 2);
  assert.match(farm.upgrade!.blockedReason!, /already building/);
});

test("banked Time drains into a build the moment it starts", () => {
  const s = stateWith([
    placed(BTC_MARKET, "BTC", "up"),
    placed(ETH_MARKET, "ETH", "down"),
    { type: "CALL_SETTLED", marketId: BTC_MARKET, result: "up", settledAtWindow: 1_000_001 },
    { type: "CALL_SETTLED", marketId: ETH_MARKET, result: "down", settledAtWindow: 1_000_001 },
    { type: "START_UPGRADE", playerId: ME, farmId: `${ME}:wheat` },
  ]);
  const farm = view(s).farms[0]!;
  // The Down call banked a window of Time, which is the whole of the first build.
  assert.equal(farm.tier, 2);
  assert.equal(farm.build, null);
  assert.equal(view(s).timeBank, 0);
});

test("equipment out of order is refused with a plain reason, not hidden", () => {
  const v = view(stateWith([]));
  const options = v.farms[0]!.equipmentOptions;
  const shed = options.find((e) => e.id === "shed")!;
  assert.equal(shed.buyable, false);
  assert.match(shed.reason!, /Needs the one before it first/);
  const irrigation = options.find((e) => e.id === "irrigation")!;
  assert.equal(irrigation.buyable, false);
  assert.match(irrigation.reason!, /Needs 2 Coins/);
});

test("costs shown are the locked ones and nothing else", () => {
  const options = view(stateWith([])).farms[0]!.equipmentOptions;
  assert.deepEqual(options.map((e) => [e.id, e.cost]), [["irrigation", 2], ["harvester", 4], ["shed", 8]]);
});

test("a voided call gives the day's call back and pays nothing", () => {
  const s = stateWith([
    placed(BTC_MARKET, "BTC", "up"),
    { type: "CALL_SETTLED", marketId: BTC_MARKET, result: "void", settledAtWindow: 1_000_001 },
  ]);
  const v = view(s);
  assert.equal(v.callsLeftToday, 8);
  assert.equal(v.finishedCalls[0]!.outcome, "void");
  assert.equal(v.coins, 0);
});

test("coins about to expire are counted separately so the bar can warn gently", () => {
  const s = stateWith([
    placed(BTC_MARKET, "BTC", "up"),
    { type: "CALL_SETTLED", marketId: BTC_MARKET, result: "up", settledAtWindow: 1_000_001 },
  ]);
  // Fresh coins last a week, so nothing is close to expiry yet.
  assert.equal(view(s).coinsExpiringSoon, 0);

  const nearly = reduce(R, s, { type: "WINDOW_TICK", windowId: 1_000_001 + R.expiryRounds - 10 });
  assert.equal(view(nearly).coinsExpiringSoon, 1);
});

test("a player with no save yet still gets a view the screens can render", () => {
  const v = buildView({ rules: R, state: initialState(0), playerId: ME, address: null, windows: [], now: Date.now() });
  assert.equal(v.connected, false);
  assert.equal(v.farms.length, 0);
  assert.equal(v.callsLeftToday, R.dailyCallCap);
});

// --- the clock the player waits on is the market's, not the game's -----------

test("a wait is spoken in whole minutes and hours, because a round can be hours", () => {
  assert.equal(formatWait(30), "under a minute");
  assert.equal(formatWait(56 * 60), "56 min");
  assert.equal(formatWait(4 * 3600), "4h");
  assert.equal(formatWait(4 * 3600 + 12 * 60), "4h 12m");
  assert.equal(formatWait(null), "settling now");
});

test("the countdown reports when the round settles, not when the game window rolls", () => {
  const v = view(stateWith([]), [windowAt("BTC", BTC_MARKET, 3360), windowAt("ETH", ETH_MARKET, 7200)]);
  // The game window is 15 minutes; the soonest round is 56. The screen shows 56.
  assert.equal(v.roundSettlesInSeconds, 3360);
  assert.ok(v.secondsLeftInWindow <= 900);
});

test("with no round open there is no countdown to show", () => {
  assert.equal(view(stateWith([])).roundSettlesInSeconds, null);
});

test("an asset already called says how long until it opens again", () => {
  const s = stateWith([placed(BTC_MARKET, "BTC", "up")]);
  const btc = view(s, [windowAt("BTC", BTC_MARKET, 3360)]).assets.find((a) => a.asset === "BTC")!;
  assert.match((btc.state as { reason: string }).reason, /opens again when this one settles, in 56 min/);
});

test("an open call carries the real time until it settles", () => {
  const s = stateWith([placed(BTC_MARKET, "BTC", "up")]);
  const call = view(s, [windowAt("BTC", BTC_MARKET, 3360)]).openCalls[0]!;
  assert.equal(call.settlesInSeconds, 3360);
});

test("a call whose round has left the live list is settling now, not stuck", () => {
  const s = stateWith([placed(BTC_MARKET, "BTC", "up")]);
  assert.equal(view(s, []).openCalls[0]!.settlesInSeconds, null);
});
