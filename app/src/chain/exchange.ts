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

/**
 * Network endpoints, as configuration rather than constants.
 *
 * Both defaults are the public Shannon testnet endpoints published in the
 * markets-sdk README and pre-filled by the dreamDEX Event Contracts starter
 * template. The SDK requires an indexer URL at construction even though every
 * read and write here is on chain, so one has to be supplied.
 *
 * They are defaults only. A deployment that runs its own indexer, or points at
 * a different network, sets the environment variables and changes no code. Vite
 * inlines these at build time and only exposes names beginning with `VITE_`,
 * so the prefix is required rather than stylistic.
 *
 * `import.meta.env` does not exist outside a Vite build, hence the optional
 * access: this module must not throw merely for being imported under Node.
 */
export const DEFAULT_WS_RPC_URL = "wss://api.infra.testnet.somnia.network/ws";
export const DEFAULT_INDEXER_URL = "https://dev.smk.somnia.host/v1/graphql";

const WS_RPC_URL: string = import.meta.env?.VITE_WS_RPC_URL ?? DEFAULT_WS_RPC_URL;
const INDEXER_URL: string = import.meta.env?.VITE_INDEXER_URL ?? DEFAULT_INDEXER_URL;

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
