// Spike 1: claim TestUSDC and print the balance. Testnet only.

import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { dump, fmtUsdc, makeExchange, shutdown, txLink } from "./client.ts";

const ex = makeExchange();
const me = ex.walletAddress as `0x${string}`;
const usdc = SOMNIA_TESTNET_ADDRESSES.testUsdc as `0x${string}`;
console.log("wallet:", me);

// Positional, not an options object: getErc20Balance(token, account).
const balance = () => ex.client.getErc20Balance(usdc, me) as Promise<bigint>;

const before = await balance();
console.log("tUSDC before:", fmtUsdc(before));

if (before >= 100_000_000n) {
  console.log("already funded (>= 100 tUSDC), skipping the faucet");
} else {
  const res = await ex.trader.faucet({});
  dump("faucet result:", res);
  const hash = typeof res === "string" ? res : (res as { hash?: string; transactionHash?: string })?.hash
    ?? (res as { transactionHash?: string })?.transactionHash;
  if (hash) console.log("receipt:", txLink(hash));
  console.log("tUSDC after:", fmtUsdc(await balance()));
}

await shutdown(ex);
