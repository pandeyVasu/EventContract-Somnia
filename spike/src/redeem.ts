// Spike 5: settle and redeem every call recorded by place.ts.
//
// Reads spike/placed.json (one JSON object per line), waits for each market to
// finalize, decides won / lost / void the way the adapter will, and redeems the
// winning position. This is the last link in the chain the game depends on.

import { readFileSync } from "node:fs";
import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { dump, fmtUsdc, iso, makeExchange, shutdown, txLink } from "./client.ts";

const POLL_SECONDS = 30;
const MAX_WAIT_MINUTES = 20;

const ex = makeExchange();
const me = ex.walletAddress as `0x${string}`;
const usdc = SOMNIA_TESTNET_ADDRESSES.testUsdc as `0x${string}`;

const lines = readFileSync(new URL("../placed.json", import.meta.url), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
console.log(`${lines.length} recorded call(s)`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForFinal(marketId: `0x${string}`): Promise<any> {
  const deadline = Date.now() + MAX_WAIT_MINUTES * 60_000;
  for (;;) {
    const m = (await ex.client.getMarketOnchain(marketId)) as any;
    if (m.isResolved || m.isVoided) return m;
    if (Date.now() > deadline) throw new Error(`still unresolved after ${MAX_WAIT_MINUTES} minutes`);
    console.log(`  status ${m.status}, not final yet; polling again in ${POLL_SECONDS}s`);
    await sleep(POLL_SECONDS * 1000);
  }
}

const balanceBefore = (await ex.client.getErc20Balance(usdc, me)) as bigint;
console.log("tUSDC before redeeming:", fmtUsdc(balanceBefore));

for (const call of lines) {
  console.log(`\n--- ${call.asset} ${call.direction.toUpperCase()}, market ${call.marketId.slice(0, 12)}...`);
  console.log(`    placed ${call.at}, window ends ${call.expiry}, entry probability ${call.entryProbability}`);
  const m = await waitForFinal(call.marketId);

  if (m.isVoided) {
    // Void: no game reward, and both sides redeem at half. Only the side we hold matters.
    console.log("    VOIDED");
  } else {
    const won = Number(m.winningOutcome) === call.outcomeIdx;
    console.log(`    winningOutcome ${m.winningOutcome} (0 = Up, 1 = Down) -> ${won ? "WON" : "LOST"}`);
    if (!won) continue;
  }

  const held = (await ex.client.getOutcomeBalance({
    outcomeToken: m.outcomeToken,
    account: me,
    id: call.outcomeIdx === 0 ? m.yesId : m.noId,
  })) as bigint;
  console.log(`    holding ${held} outcome tokens`);
  if (held <= 0n) {
    console.log("    nothing to redeem");
    continue;
  }

  const res = (await ex.trader.redeem({
    marketId: call.marketId,
    amount: held,
    outcomeIdx: call.outcomeIdx as 0 | 1,
  })) as any;
  const hash = res?.hash ?? res?.transactionHash;
  console.log("    redeemed:", hash ? txLink(hash) : "no hash in the result");
  if (!hash) dump("    redeem result:", res);
}

const balanceAfter = (await ex.client.getErc20Balance(usdc, me)) as bigint;
console.log(`\ntUSDC after redeeming: ${fmtUsdc(balanceAfter)} (change ${fmtUsdc(balanceAfter - balanceBefore)})`);
console.log("finished at", iso(Math.floor(Date.now() / 1000)));

await shutdown(ex);
