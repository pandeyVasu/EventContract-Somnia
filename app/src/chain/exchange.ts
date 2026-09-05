// Building the SDK client.
//
// In the browser the signer is the player's wallet. The SDK resolves the signer
// from walletClient.account, and throws SignerRequiredError when that is missing,
// which is easy to hit because a viem walletClient is perfectly valid without one.

import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaTestnet } from "viem/chains";
import type { Exchange } from "./types.ts";

export const CHAIN = somniaTestnet;
export const EXPLORER = "https://shannon-explorer.somnia.network";
export const COLLATERAL = SOMNIA_TESTNET_ADDRESSES.testUsdc as `0x${string}`;

const WS_RPC_URL = "wss://api.infra.testnet.somnia.network/ws";
const INDEXER_URL = "https://dev.smk.somnia.host/v1/graphql";

/** One exchange per wallet address; rebuilding drops the socket it holds open. */
const cache = new Map<string, Exchange>();

export function getExchange(walletClient: { account?: { address?: string } }): Exchange {
  const address = walletClient?.account?.address;
  if (!address) {
    throw new Error("The wallet client has no account. Connect a wallet before trading.");
  }
  const existing = cache.get(address.toLowerCase());
  if (existing) return existing;

  const ex = new SomniaMarkets({
    chain: CHAIN,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    walletClient: walletClient as any,
    wsRpcUrl: WS_RPC_URL,
    indexerUrl: INDEXER_URL,
  }) as unknown as Exchange;

  cache.set(address.toLowerCase(), ex);
  return ex;
}

/**
 * Drop an exchange and close its socket. The SDK opens a websocket at
 * construction and nothing closes it on its own, which is what kept every spike
 * script alive after its work was done.
 */
export function releaseExchange(address: string): void {
  const key = address.toLowerCase();
  const ex = cache.get(key) as any;
  cache.delete(key);
  try {
    ex?.client?.stopLive?.();
    ex?.close?.();
  } catch {
    // closing a socket that has already gone is not worth reporting
  }
}

export function txLink(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}
