// The demo combination test: prove 1-minute, 5-minute and 15-minute rounds all
// work end to end, in one run, on real markets.
//
//   node --env-file=E:/somnia-hackathon/.env src/combo.ts
//   node --env-file=E:/somnia-hackathon/.env src/combo.ts --place
//   node --env-file=E:/somnia-hackathon/.env src/combo.ts --place --watch
//   node --env-file=E:/somnia-hackathon/.env src/combo.ts --intervals 60,300 --place --watch
//   node --env-file=E:/somnia-hackathon/.env src/combo.ts --verify        (checks the direction
//                                                                        reading, places nothing)
//
// Three phases, each printable on its own:
//
//   DISCOVER  which of the wanted round lengths are live right now, filtered by
//             exactly the rule the app uses (direction modes, scaled lock guard).
//   PLACE     one real fixed-stake call per round length, directions alternating
//             so a single run exercises both Up and Down.
//   WATCH     poll each call to final, then check two separate things: that the
//             venue agreed with our side, and — for a fixed-mode round — that
//             "settled at or above the strike" really does mean "went up".
//             That second check is the one claim the app rests on and has never
//             been tested against a live settlement.
//
// Results are written to spike/combo.json so a failed watch can be re-read
// without replacing the calls.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { ORDER_TYPE, quoteBinaryStakeOverBook, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { ONE_COLLATERAL, STAKE, fmtUsdc, iso, makeExchange, shutdown, toProbability, txLink } from "./client.ts";

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
function value(flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
}

const WANTED = value("--intervals", "60,300,900").split(",").map((s) => Number(s.trim()));
const DO_PLACE = has("--place");
const DO_WATCH = has("--watch");
const DO_VERIFY = has("--verify");
const POLL_SECONDS = 20;
const MAX_WAIT_MINUTES = 40;

const LABELS: Record<number, string> = {
  60: "1 min", 300: "5 min", 900: "15 min", 1800: "30 min",
  3600: "1 hour", 14400: "4 hours", 86400: "1 day",
};
const label = (s: number) => LABELS[s] ?? `${s}s`;

const LOG = new URL("../combo.json", import.meta.url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Close the socket and stop, here and now.
 *
 * `shutdown` alone only schedules an exit, so the lines after it still run. In
 * a script whose later phases send real orders, "still runs" would mean an
 * order nobody asked for, so every stop goes through this instead.
 */
async function stop(): Promise<never> {
  await shutdown(ex);
  process.exit(process.exitCode ?? 0);
}

// ------------------------------------------------- the app's own two filters
// Kept identical to app/src/chain/windows.ts on purpose. If these two ever
// disagree, the spike is testing something the game does not do.

const DIRECTION_MODES = new Set(["reference", "fixed"]);

function minSecondsLeft(intervalSec: number): number {
  return Math.min(300, Math.max(20, Math.floor(intervalSec / 6)));
}

const ex = makeExchange();
const client = ex.client as any;
const me = ex.walletAddress as `0x${string}`;
const usdc = SOMNIA_TESTNET_ADDRESSES.testUsdc as `0x${string}`;

/**
 * The claim the whole short-round demo rests on.
 *
 * A fixed-mode round asks "did it end at or above the strike", and the game
 * shows that to the player as "did it go up". Those are the same question only
 * if the strike is the price at the round's open.
 *
 * Nothing publishes the price a round settled at — not the indexer, not the
 * chain. Only the strike and the winning outcome survive. But the rounds are
 * contiguous: each one's `tradingStart` is the previous one's `expiry`. So if
 * the strike really is spot at the open, the NEXT round's strike is this
 * round's settlement price, and "the next strike is at or above this one" has
 * to agree with "this round paid Up" every single time.
 *
 * One agreement could be luck. A dozen in a row across live rounds cannot be,
 * and a single disagreement means the direction reading is wrong and short
 * rounds have to be dropped back to reference mode.
 */
async function verifyFixedDirection(asset: string, intervalSec: number): Promise<void> {
  const finished = (await client
    .listBinaryMarkets({ status: "Finalized", limit: 60, intervalSec })
    .catch(() => [])) as any[];

  const rounds = finished
    .filter((m) => String(m.asset) === asset && String(m.mode) === "fixed" && !m.voided)
    .sort((a, b) => Number(a.expiry) - Number(b.expiry));

  if (rounds.length < 2) {
    console.log(`    cannot check ${asset}: only ${rounds.length} finished fixed round(s) to compare`);
    return;
  }

  let agreed = 0;
  let checked = 0;
  const disagreements: string[] = [];

  for (let i = 0; i < rounds.length - 1; i += 1) {
    const round = rounds[i]!;
    const next = rounds[i + 1]!;
    // Only consecutive rounds prove anything: a gap means the next strike is
    // spot at some later moment, not at this round's expiry.
    if (Number(next.tradingStart) !== Number(round.expiry)) continue;

    const settled = Number(next.strike);
    const wentUp = settled >= Number(round.strike);
    const paidUp = Number(round.winningOutcome) === 0;
    checked += 1;
    if (wentUp === paidUp) agreed += 1;
    else {
      disagreements.push(
        `${iso(Number(round.expiry))}: strike ${round.strike} -> ${next.strike}`
        + ` reads ${wentUp ? "up" : "down"}, but the venue paid outcome ${round.winningOutcome}`,
      );
    }
  }

  if (!checked) {
    console.log(`    cannot check ${asset}: no two finished rounds were back to back`);
    return;
  }

  console.log(`    strike chain: ${agreed} of ${checked} consecutive ${asset} rounds agree that "at or above the strike" means "went up"`);
  if (disagreements.length) {
    console.log("    THE DIRECTION READING IS WRONG. Disagreements:");
    for (const d of disagreements.slice(0, 5)) console.log(`      ${d}`);
    process.exitCode = 1;
  }
}

// ================================================================= DISCOVER

console.log(`combination test — ${WANTED.map(label).join(", ")}`);
console.log(`wallet ${me}`);
console.log(`mode: ${DO_PLACE ? (DO_WATCH ? "place and watch to settlement" : "place only") : "discovery only (add --place to trade)"}\n`);

type Candidate = {
  intervalSec: number; marketId: `0x${string}`; pool: `0x${string}`;
  asset: string; mode: string; expiry: number; secondsLeft: number; strike: string;
};

const nowSec = () => Math.floor(Date.now() / 1000);

async function discover(intervalSec: number): Promise<Candidate[]> {
  let live: any[] = [];
  try {
    live = (await client.listLiveBinaryMarkets({ limit: 100, intervalSec })) as any[];
  } catch (e) {
    console.log(`  ${label(intervalSec)}: the venue refused the query (${(e as Error).message})`);
    return [];
  }
  const now = nowSec();
  const candidates = live
    .filter((m) => DIRECTION_MODES.has(String(m.mode)))
    .map((m) => ({
      intervalSec: Number(m.intervalSec),
      marketId: String(m.marketId) as `0x${string}`,
      pool: (m.pool ?? m.poolAddress) as `0x${string}`,
      asset: String(m.asset),
      mode: String(m.mode),
      expiry: Number(m.expiry),
      secondsLeft: Number(m.expiry) - now,
      strike: String(m.strike ?? "-"),
    }))
    .filter((m) => m.secondsLeft > minSecondsLeft(m.intervalSec));

  // Status is time-derived and the indexer lags, so every candidate is confirmed.
  const confirmed: Candidate[] = [];
  for (const c of candidates) {
    const onchain = await client.getMarketOnchain(c.marketId).catch(() => null);
    if (onchain?.status === 1) confirmed.push(c);
  }
  return confirmed.sort((a, b) => a.secondsLeft - b.secondsLeft);
}

const found = new Map<number, Candidate[]>();
for (const intervalSec of WANTED) {
  const cs = await discover(intervalSec);
  found.set(intervalSec, cs);
  console.log(
    `${label(intervalSec).padEnd(7)} ${cs.length} tradeable`
    + (cs.length
      ? ` — ${[...new Set(cs.map((c) => c.asset))].join("/")}, ${[...new Set(cs.map((c) => c.mode))].join("/")} mode,`
        + ` soonest in ${Math.round(cs[0]!.secondsLeft)}s (needs > ${minSecondsLeft(intervalSec)}s)`
      : ` — nothing callable; the venue may not be running this length right now`),
  );
}

const usable = WANTED.filter((s) => (found.get(s) ?? []).length > 0);
console.log(`\n${usable.length} of ${WANTED.length} round lengths are callable right now: ${usable.map(label).join(", ") || "none"}`);

if (DO_VERIFY) {
  // The direction reading, checked against settled history alone. No trades.
  console.log("\nchecking the fixed-mode direction reading against rounds that have already settled");
  for (const asset of ["BTC", "ETH"]) {
    for (const intervalSec of WANTED) await verifyFixedDirection(asset, intervalSec);
  }
}

if (!DO_PLACE) {
  console.log("\nDiscovery only. Re-run with --place --watch to trade each of them and check settlement.");
  await stop();
}

// ==================================================================== PLACE

type Placed = Candidate & {
  at: string; direction: "up" | "down"; side: string; outcomeIdx: 0 | 1;
  shares: string; entryProbability: number; hash?: string;
};

async function place(c: Candidate, direction: "up" | "down"): Promise<Placed | null> {
  const side = direction === "up" ? "BUY_YES" : "BUY_NO";
  console.log(`\n--- ${label(c.intervalSec)} ${c.asset} ${direction.toUpperCase()} (${c.mode} mode, settles ${iso(c.expiry)})`);

  const onchain = (await client.getMarketOnchain(c.marketId)) as any;
  if (onchain.status !== 1) {
    console.log(`    it left Trading before we got there (status ${onchain.status}); skipping`);
    return null;
  }

  const book = (await client.getBinaryOrderBook(c.pool)) as any;
  const grid = (await client.getBinaryBookParams(c.pool)) as any;
  const levels = side === "BUY_YES" ? book.yesAsks : book.noAsks;
  console.log(`    book: ${levels.length} level(s) on our side`);
  if (!levels.length) {
    console.log("    empty book — nothing to trade against. This length is live but unfillable.");
    return null;
  }

  const quote = quoteBinaryStakeOverBook(book, side as any, STAKE, ONE_COLLATERAL, grid);
  if (!quote) {
    console.log("    the book cannot fill a one-unit stake; skipping");
    return null;
  }

  const res = (await ex.trader.placeOrder({
    pool: c.pool, side: quote.side, price: quote.yesPrice,
    quantity: quote.quantity, orderType: ORDER_TYPE.MARKET,
  })) as any;

  const fills = res.fills ?? [];
  if (!fills.length) {
    console.log("    NO FILLS — nothing happened on chain, so this is not a call.");
    return null;
  }

  // fillPrice is always the YES price, even on BUY_NO.
  const yesPrice = toProbability(BigInt(fills[0].fillPrice ?? fills[0].price));
  const entryProbability = side === "BUY_YES" ? yesPrice : 1 - yesPrice;
  const shares = fills.reduce((n: bigint, f: any) => n + BigInt(f.quantityFilled ?? 0n), 0n);
  const hash = res.hash ?? res.transactionHash;

  console.log(`    filled ${shares} shares, entry probability ${entryProbability.toFixed(4)}`);
  if (hash) console.log(`    receipt: ${txLink(hash)}`);

  const placed: Placed = {
    ...c, at: iso(nowSec()), direction, side,
    outcomeIdx: side === "BUY_YES" ? 0 : 1,
    shares: String(shares), entryProbability, hash,
  };
  appendFileSync(LOG, JSON.stringify(placed) + "\n");
  return placed;
}

const balanceBefore = (await client.getErc20Balance(usdc, me)) as bigint;
console.log(`\ntUSDC before: ${fmtUsdc(balanceBefore)}`);

const calls: Placed[] = [];
let n = 0;
for (const intervalSec of usable) {
  const candidates = found.get(intervalSec)!;
  // Alternate both the direction and the asset. Alternating direction covers
  // both of the game's currencies in one run — a correct Up pays Coins, a
  // correct Down pays Time. Alternating the asset reproduces the demo moment
  // the rules exist for: BTC Up and ETH Down held at the same time, which the
  // one-direction-per-market rule has to allow. Falling back to whatever is
  // there keeps the run going when only one asset is listed.
  const direction: "up" | "down" = n % 2 === 0 ? "up" : "down";
  const wantAsset = n % 2 === 0 ? "BTC" : "ETH";
  n += 1;
  const pick = candidates.find((c) => c.asset === wantAsset) ?? candidates[0]!;
  const done = await place(pick, direction);
  if (done) calls.push(done);
}

console.log(`\n${calls.length} real call(s) placed across ${usable.length} round length(s).`);
if (!calls.length) {
  console.log("Nothing to watch.");
  await stop();
}
if (!DO_WATCH) {
  console.log("Recorded in spike/combo.json. Re-run with --watch, or use `npm run redeem` later.");
  await stop();
}

// ==================================================================== WATCH

async function waitForFinal(marketId: `0x${string}`): Promise<any> {
  const deadline = Date.now() + MAX_WAIT_MINUTES * 60_000;
  for (;;) {
    const m = (await client.getMarketOnchain(marketId)) as any;
    if (m.isResolved || m.isVoided) return m;
    if (Date.now() > deadline) throw new Error(`still unresolved after ${MAX_WAIT_MINUTES} minutes`);
    await sleep(POLL_SECONDS * 1000);
  }
}

console.log(`\nWatching ${calls.length} call(s) to settlement (polling every ${POLL_SECONDS}s, giving up after ${MAX_WAIT_MINUTES} min).`);

const results: Record<string, unknown>[] = [];
for (const c of calls) {
  console.log(`\n--- ${label(c.intervalSec)} ${c.asset} ${c.direction.toUpperCase()}`);
  let m: any;
  try {
    m = await waitForFinal(c.marketId);
  } catch (e) {
    console.log(`    ${(e as Error).message}`);
    results.push({ round: label(c.intervalSec), asset: c.asset, call: c.direction, result: "timed out", reward: "-" });
    continue;
  }

  if (m.isVoided) {
    // Void pays no reward, and the game refunds the call on the day it was placed.
    console.log("    VOIDED — no reward, the daily call is refunded");
    results.push({ round: label(c.intervalSec), asset: c.asset, call: c.direction, result: "void", reward: "refund" });
    continue;
  }

  const won = Number(m.winningOutcome) === c.outcomeIdx;
  console.log(`    winningOutcome ${m.winningOutcome} (0 = Up, 1 = Down) -> ${won ? "WON" : "LOST"}`);
  if (c.mode === "fixed") await verifyFixedDirection(c.asset, c.intervalSec);
  else console.log("    reference mode — direction is the question by construction");

  // What the game would pay: reward = min(2, (1 - entry) / 0.5) units of the
  // currency the direction earns. Up pays Coins, Down pays Time.
  const units = won ? Math.min(2, (1 - c.entryProbability) / 0.5) : 0;
  const currency = c.direction === "up" ? "Coins" : "Time";
  console.log(`    the game would pay ${units.toFixed(2)} ${currency}`);

  if (won) {
    const held = (await client.getOutcomeBalance({
      outcomeToken: m.outcomeToken, account: me,
      id: c.outcomeIdx === 0 ? m.yesId : m.noId,
    })) as bigint;
    if (held > 0n) {
      const r = (await ex.trader.redeem({ marketId: c.marketId, amount: held, outcomeIdx: c.outcomeIdx })) as any;
      const hash = r?.hash ?? r?.transactionHash;
      console.log(`    redeemed ${held} tokens${hash ? `: ${txLink(hash)}` : ""}`);
    }
  }

  results.push({
    round: label(c.intervalSec), asset: c.asset, call: c.direction,
    mode: c.mode, entry: c.entryProbability.toFixed(3),
    result: won ? "won" : "lost", reward: won ? `${units.toFixed(2)} ${currency}` : "-",
  });
}

// ================================================================== SUMMARY

console.log("\n=== combination summary ===");
console.table(results);

const balanceAfter = (await client.getErc20Balance(usdc, me)) as bigint;
console.log(`tUSDC after: ${fmtUsdc(balanceAfter)} (change ${fmtUsdc(balanceAfter - balanceBefore)})`);

const settled = results.filter((r) => r.result === "won" || r.result === "lost");
console.log(
  `\n${settled.length} of ${calls.length} call(s) reached a real settlement`
  + ` across ${new Set(settled.map((r) => r.round)).size} round length(s).`,
);
if (existsSync(LOG)) {
  const lines = readFileSync(LOG, "utf8").split("\n").filter(Boolean).length;
  console.log(`spike/combo.json now holds ${lines} recorded call(s).`);
}

await stop();
