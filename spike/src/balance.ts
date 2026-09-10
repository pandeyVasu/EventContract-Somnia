// What the wallet actually holds, in both currencies that matter.
//
// A call needs two things: STT to pay for the transaction, and tUSDC to stake.
// Running out of either fails the call, but they fail differently — one is
// rejected before it is sent, the other reverts on chain — so when a call will
// not go through, this is the first thing to rule out.

import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { createPublicClient, http, formatEther } from "viem";
import { somniaTestnet } from "viem/chains";
import { fmtUsdc, makeExchange, shutdown } from "./client.ts";

const ex = makeExchange();
const me = ex.walletAddress as `0x${string}`;
const usdc = SOMNIA_TESTNET_ADDRESSES.testUsdc as `0x${string}`;

console.log(`wallet ${me}`);

const usdcBalance = (await ex.client.getErc20Balance(usdc, me)) as bigint;
console.log(`tUSDC (the stake):  ${fmtUsdc(usdcBalance)}`);

// The native token pays for gas and the SDK does not expose it, so read it directly
// from the chain.
const pub = createPublicClient({ chain: somniaTestnet, transport: http() });
const stt = await pub.getBalance({ address: me });
console.log(`STT   (the gas):    ${formatEther(stt)}`);

console.log("");
if (usdcBalance < 1_000_000n) console.log("NOT ENOUGH tUSDC: a call stakes exactly 1.");
if (stt === 0n) console.log("NO STT: nothing can be sent at all.");
if (stt > 0n && stt < 10n ** 15n) {
  console.log("STT is very low. Somnia reserves gas up front, so a transaction can be");
  console.log("refused or revert even when the balance looks non-zero.");
}
if (usdcBalance >= 1_000_000n && stt >= 10n ** 15n) {
  console.log("Both balances are fine. A failing call is not a funding problem.");
}

await shutdown(ex);
