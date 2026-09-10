import { test } from "node:test";
import assert from "node:assert/strict";

import { LOCKED_RULES, dayOf } from "farm-engine";
import { GAME_WINDOW_SECONDS, currentWindowId, secondsLeftInWindow, windowIdAt } from "../src/chain/clock.ts";
import { listLiveWindows, minSecondsLeft, pickWindow, tradeableAssets } from "../src/chain/windows.ts";
import { pickConnector } from "../src/chain/wagmi.ts";
import { ONE_COLLATERAL, entryPriceFrom, outcomeIdxFor, placeCall, sideFor } from "../src/chain/place.ts";
import { pollSettlements, readSettlement } from "../src/chain/settle.ts";
import { redeemCall } from "../src/chain/redeem.ts";
import { hashOf, receiptSucceeded } from "../src/chain/receipt.ts";
import type { ChainMarket, Exchange, LiveWindow, OrderBook } from "../src/chain/types.ts";

const MARKET = "0xmarket" as `0x${string}`;
const POOL = "0xpool" as `0x${string}`;
const ME = "0xme" as `0x${string}`;

function level(price: number, quantity: bigint) {
  return { price: BigInt(Math.round(price * Number(ONE_COLLATERAL))), quantity };
}

function book(over: Partial<OrderBook> = {}): OrderBook {
  return {
    yesBids: [level(0.5, 200_000_000n)],
    yesAsks: [level(0.6, 200_000_000n)],
    noBids: [level(0.4, 200_000_000n)],
    noAsks: [level(0.45, 200_000_000n)],
    ...over,
  };
}

function chainMarket(over: Partial<ChainMarket> = {}): ChainMarket {
  return {
    status: 1, isResolved: false, isVoided: false, winningOutcome: 0,
    outcomeToken: "0xtoken" as `0x${string}`, yesId: 1n, noId: 2n, pool: POOL,
    ...over,
  };
}

interface FakeOptions {
  market?: ChainMarket;
  redeemReceipt?: any;
  book?: OrderBook;
  fills?: { quantityFilled: bigint; fillPrice: bigint }[];
  held?: bigint;
  liveMarkets?: any[];
}

function fakeExchange(o: FakeOptions = {}) {
  const sent: any[] = [];
  const ex: Exchange = {
    walletAddress: ME,
    client: {
      listLiveBinaryMarkets: async () => o.liveMarkets ?? [],
      getMarketOnchain: async () => o.market ?? chainMarket(),
      getBinaryOrderBook: async () => o.book ?? book(),
      getBinaryBookParams: async () => ({ tickSize: 1000n, lotSize: 1000n, minQuantity: 1000n }),
      getOutcomeBalance: async () => o.held ?? 0n,
    },
    trader: {
      placeOrder: async (p) => {
        sent.push(p);
        return { fills: o.fills ?? [], transactionHash: "0xtx" };
      },
      redeem: async (p) => {
        sent.push(p);
        return o.redeemReceipt ?? { status: "success", transactionHash: "0xredeem" };
      },
    },
  };
  return { ex, sent };
}

const WINDOW: LiveWindow = {
  marketId: MARKET, pool: POOL, asset: "BTC", intervalSec: 3600,
  expiry: 1_700_003_600, secondsLeft: 3600,
};

// --- clock: the game runs on 15-minute windows whatever the market does -------

test("a game window is 15 minutes and a day holds 96 of them", () => {
  assert.equal(GAME_WINDOW_SECONDS, 900);
  assert.equal(windowIdAt(0), 0);
  assert.equal(windowIdAt(899), 0);
  assert.equal(windowIdAt(900), 1);
  // A window's day is the engine's arithmetic, not the adapter's.
  assert.equal(dayOf(LOCKED_RULES, 95), 0);
  assert.equal(dayOf(LOCKED_RULES, 96), 1);
});

test("the countdown reports time left in the game window, not the market", () => {
  assert.equal(secondsLeftInWindow(100_000 * 1000), 900 - (100_000 % 900));
  assert.equal(currentWindowId(900_000), windowIdAt(900));
});

// --- discovery ---------------------------------------------------------------

test("discovery takes both direction shapes and confirms status on chain", async () => {
  const now = 1_700_000_000_000;
  const nowSec = now / 1000;
  const { ex } = fakeExchange({
    liveMarkets: [
      { marketId: "0xa", poolAddress: POOL, asset: "BTC", mode: "reference", intervalSec: 3600, expiry: nowSec + 3600 },
      { marketId: "0xb", poolAddress: POOL, asset: "ETH", mode: "reference", intervalSec: 900, expiry: nowSec + 800 },
      { marketId: "0xc", poolAddress: POOL, asset: "BTC", mode: "fixed", intervalSec: 60, expiry: nowSec + 50 },
      { marketId: "0xd", poolAddress: POOL, asset: "ETH", mode: "reference", intervalSec: 3600, expiry: nowSec + 60 },
      { marketId: "0xe", poolAddress: POOL, asset: "BTC", mode: "swaps", intervalSec: 60, expiry: nowSec + 3600 },
    ],
  });
  const windows = await listLiveWindows(ex.client, now);
  const ids = windows.map((w) => w.marketId);
  assert.ok(ids.includes("0xa" as `0x${string}`), "an hourly round is offered");
  assert.ok(ids.includes("0xb" as `0x${string}`), "a quarter-hour round is offered");
  assert.ok(
    ids.includes("0xc" as `0x${string}`),
    "a one-minute round is a direction call too: its strike is the price at the open",
  );
  assert.ok(!ids.includes("0xd" as `0x${string}`), "too close to its lock for an order to land");
  assert.ok(!ids.includes("0xe" as `0x${string}`), "a shape we have not verified is left alone");
  assert.equal(windows[0]!.marketId, "0xc", "shortest round first, so the game feels immediate");
});

test("discovery drops a market the chain does not report as Trading", async () => {
  const now = 1_700_000_000_000;
  const { ex } = fakeExchange({
    market: chainMarket({ status: 2 }),
    liveMarkets: [{ marketId: "0xa", poolAddress: POOL, asset: "BTC", mode: "reference", intervalSec: 3600, expiry: now / 1000 + 3600 }],
  });
  assert.deepEqual(await listLiveWindows(ex.client, now), []);
});

test("picking a window is by asset, and says nothing rather than guessing", () => {
  const windows = [WINDOW];
  assert.equal(pickWindow(windows, "BTC")?.marketId, MARKET);
  assert.equal(pickWindow(windows, "ETH"), null);
  assert.deepEqual(tradeableAssets(windows), ["BTC"]);
});

test("the lock guard scales with the round, so a short round is still callable", () => {
  // A flat five minutes excluded every round shorter than five minutes and made
  // a quarter-hour round callable for only two thirds of its life.
  assert.equal(minSecondsLeft(300), 50);
  assert.equal(minSecondsLeft(900), 150);
  assert.equal(minSecondsLeft(3600), 300);
  assert.equal(minSecondsLeft(14400), 300);
  // Never so small that an order cannot land.
  assert.equal(minSecondsLeft(60), 20);
});

test("a five-minute round is offered, where the old flat guard hid it", async () => {
  const now = 1_700_000_000_000;
  const nowSeconds = now / 1000;
  const { ex } = fakeExchange({
    liveMarkets: [
      { marketId: "0xshort", poolAddress: POOL, asset: "BTC", mode: "reference", intervalSec: 300, expiry: nowSeconds + 240 },
    ],
  });
  const live = await listLiveWindows(ex.client, now);
  assert.equal(live.length, 1);
  assert.equal(live[0]!.intervalSec, 300);
});

test("the demo combination — one, five and fifteen minutes — is all offered at once", async () => {
  // The demo shows the same game at three speeds: a call that resolves while
  // the judge is watching, one that resolves within the pitch, and the
  // quarter-hour round the farm's own clock is built around. All three have to
  // be callable in the same moment, and the fastest has to come first.
  const now = 1_700_000_000_000;
  const nowSeconds = now / 1000;
  const { ex } = fakeExchange({
    liveMarkets: [
      { marketId: "0x15b", poolAddress: POOL, asset: "BTC", mode: "reference", intervalSec: 900, expiry: nowSeconds + 800 },
      { marketId: "0x01b", poolAddress: POOL, asset: "BTC", mode: "fixed", intervalSec: 60, expiry: nowSeconds + 44 },
      { marketId: "0x05e", poolAddress: POOL, asset: "ETH", mode: "reference", intervalSec: 300, expiry: nowSeconds + 276 },
      { marketId: "0x15e", poolAddress: POOL, asset: "ETH", mode: "reference", intervalSec: 900, expiry: nowSeconds + 800 },
    ],
  });

  const live = await listLiveWindows(ex.client, now);
  assert.deepEqual(live.map((w) => w.intervalSec), [60, 300, 900, 900], "shortest round first");
  assert.equal(live[0]!.marketId, "0x01b", "a one-minute round leads, so the demo can settle on camera");

  // Both assets remain callable, which is what makes BTC Up beside ETH Down work.
  assert.deepEqual(tradeableAssets(live).sort(), ["BTC", "ETH"]);

  // Each asset rides its own fastest round, not merely the fastest overall.
  assert.equal(pickWindow(live, "BTC")!.intervalSec, 60);
  assert.equal(pickWindow(live, "ETH")!.intervalSec, 300);
});

test("a round about to lock is still skipped, whatever its length", async () => {
  const now = 1_700_000_000_000;
  const nowSeconds = now / 1000;
  const { ex } = fakeExchange({
    liveMarkets: [
      { marketId: "0xclosing", poolAddress: POOL, asset: "BTC", mode: "reference", intervalSec: 300, expiry: nowSeconds + 30 },
    ],
  });
  assert.deepEqual(await listLiveWindows(ex.client, now), []);
});

// --- placement ---------------------------------------------------------------

test("Up buys YES and Down buys NO", () => {
  assert.equal(sideFor("up"), "BUY_YES");
  assert.equal(sideFor("down"), "BUY_NO");
  assert.equal(outcomeIdxFor("up"), 0);
  assert.equal(outcomeIdxFor("down"), 1);
});

test("the Down entry price is inverted, because a fill always reports the YES price", () => {
  assert.equal(entryPriceFrom(585_000n, "up"), 0.585);
  assert.ok(Math.abs(entryPriceFrom(636_000n, "down") - 0.364) < 1e-9);
});

test("a filled call reports its size-weighted entry price", async () => {
  const { ex } = fakeExchange({
    fills: [
      { quantityFilled: 1_000_000n, fillPrice: 500_000n },
      { quantityFilled: 3_000_000n, fillPrice: 700_000n },
    ],
  });
  const call = await placeCall(ex, WINDOW, "up", 1_700_000_000_000);
  assert.ok(call);
  assert.equal(call.shares, 4_000_000n);
  assert.equal(call.entryPrice, 0.65, "weighted, not the first or the last fill");
  assert.equal(call.windowId, currentWindowId(1_700_000_000_000));
  assert.equal(call.txHash, "0xtx");
});

test("an order that fills nothing is not a call", async () => {
  const { ex } = fakeExchange({ fills: [] });
  assert.equal(await placeCall(ex, WINDOW, "up"), null);
});

test("a fill of zero shares is not a call either", async () => {
  const { ex } = fakeExchange({ fills: [{ quantityFilled: 0n, fillPrice: 500_000n }] });
  assert.equal(await placeCall(ex, WINDOW, "up"), null);
});

test("a book too thin to fill the stake sends no order at all", async () => {
  const { ex, sent } = fakeExchange({ book: book({ yesAsks: [] }) });
  assert.equal(await placeCall(ex, WINDOW, "up"), null);
  assert.equal(sent.length, 0, "nothing reached the chain");
});

test("a market that stopped trading between discovery and the click sends nothing", async () => {
  const { ex, sent } = fakeExchange({
    market: chainMarket({ status: 2 }),
    fills: [{ quantityFilled: 1n, fillPrice: 500_000n }],
  });
  assert.equal(await placeCall(ex, WINDOW, "up"), null);
  assert.equal(sent.length, 0);
});

// --- settlement --------------------------------------------------------------

test("outcome 0 is Up and outcome 1 is Down", () => {
  assert.deepEqual(readSettlement(MARKET, { isVoided: false, isResolved: true, winningOutcome: 0 }),
    { marketId: MARKET, result: "up", winningOutcome: 0 });
  assert.deepEqual(readSettlement(MARKET, { isVoided: false, isResolved: true, winningOutcome: 1 }),
    { marketId: MARKET, result: "down", winningOutcome: 1 });
});

test("void wins over a stale winning outcome", () => {
  const s = readSettlement(MARKET, { isVoided: true, isResolved: true, winningOutcome: 0 });
  assert.equal(s?.result, "void");
  assert.equal(s?.winningOutcome, null);
});

test("an unfinished market settles nothing", () => {
  assert.equal(readSettlement(MARKET, { isVoided: false, isResolved: false, winningOutcome: 0 }), null);
});

test("a failed read is retried next poll rather than reported as a settlement", async () => {
  const client = { getMarketOnchain: async () => { throw new Error("rpc down"); } } as any;
  assert.deepEqual(await pollSettlements(client, [MARKET]), []);
});

// --- redemption --------------------------------------------------------------

test("a losing call never reaches the chain", async () => {
  const { ex, sent } = fakeExchange({ held: 5n });
  const r = await redeemCall(ex, { direction: "up", marketId: MARKET } as any,
    { marketId: MARKET, result: "down", winningOutcome: 1 });
  assert.equal(r.skipped, "lost");
  assert.equal(sent.length, 0);
});

test("a winning call redeems the whole position", async () => {
  const { ex, sent } = fakeExchange({ held: 1_658_000n, market: chainMarket({ isResolved: true, winningOutcome: 0 }) });
  const r = await redeemCall(ex, { direction: "up", marketId: MARKET } as any,
    { marketId: MARKET, result: "up", winningOutcome: 0 });
  assert.equal(r.redeemed, 1_658_000n);
  assert.equal(r.txHash, "0xredeem");
  assert.equal(sent[0].outcomeIdx, 0);
  assert.equal(sent[0].amount, 1_658_000n);
});

test("a void redeems the side actually held", async () => {
  const { ex, sent } = fakeExchange({ held: 900n, market: chainMarket({ isVoided: true }) });
  const r = await redeemCall(ex, { direction: "down", marketId: MARKET } as any,
    { marketId: MARKET, result: "void", winningOutcome: null });
  assert.equal(r.redeemed, 900n);
  assert.equal(sent[0].outcomeIdx, 1, "the side held, not the winner of a resolved market");
});

test("a winning call with no position left claims nothing", async () => {
  const { ex, sent } = fakeExchange({ held: 0n });
  const r = await redeemCall(ex, { direction: "up", marketId: MARKET } as any,
    { marketId: MARKET, result: "up", winningOutcome: 0 });
  assert.equal(r.skipped, "no-position");
  assert.equal(sent.length, 0);
});

// --- receipts: mined is not the same as worked -------------------------------

test("every shape the status field arrives in is understood", () => {
  assert.equal(receiptSucceeded({ status: "success" }), true);
  assert.equal(receiptSucceeded({ status: 1n }), true);
  assert.equal(receiptSucceeded({ status: 1 }), true);
  assert.equal(receiptSucceeded({ status: "reverted" }), false, "the string is truthy but the transaction failed");
  assert.equal(receiptSucceeded({ status: 0n }), false);
  assert.equal(receiptSucceeded({ status: 0 }), false);
  assert.equal(receiptSucceeded({}), false, "a receipt with no status is not proof of anything");
  assert.equal(receiptSucceeded(null), false);
});

test("the hash is found wherever the SDK put it", () => {
  assert.equal(hashOf({ transactionHash: "0xa" }), "0xa");
  assert.equal(hashOf({ hash: "0xb" }), "0xb");
  assert.equal(hashOf({ receipt: { transactionHash: "0xc" } }), "0xc");
  assert.equal(hashOf({}), null);
});

test("a redemption that reverted is reported as reverted, not as a payout", async () => {
  const { ex } = fakeExchange({
    held: 1_000n,
    redeemReceipt: { status: "reverted", transactionHash: "0xdead" },
  });
  const r = await redeemCall(ex, { direction: "up", marketId: MARKET } as any,
    { marketId: MARKET, result: "up", winningOutcome: 0 });
  assert.equal(r.skipped, "reverted");
  assert.equal(r.redeemed, 0n, "nothing came back, whatever the receipt looked like");
  assert.equal(r.txHash, "0xdead", "the hash is kept so the failure can be looked up");
});

// --- choosing between wallets ----------------------------------------------

test("a browser with several wallets connects to MetaMask, not whichever is first", () => {
  // wagmi lists every wallet it discovers plus a generic connector pointed at
  // window.ethereum. Taking the first handed a Brave user their built-in wallet
  // instead of the MetaMask the setup steps told them to install.
  const brave = { id: "com.brave.wallet", name: "Brave Wallet" };
  const metamask = { id: "io.metamask", name: "MetaMask" };
  const generic = { id: "injected", name: "Injected", type: "injected" };

  assert.equal(pickConnector([generic, brave, metamask])!.id, "io.metamask");
  assert.equal(pickConnector([metamask, brave])!.id, "io.metamask");

  // No MetaMask: take a wallet that actually announced itself over the shim.
  assert.equal(pickConnector([generic, brave])!.id, "com.brave.wallet");

  // One wallet, or only the shim, still works.
  assert.equal(pickConnector([generic])!.id, "injected");
  assert.equal(pickConnector([]), undefined, "and nothing is not a crash");
});
