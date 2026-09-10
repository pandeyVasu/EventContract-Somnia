// Shared construction for every spike script. Private-key signing, testnet only.
// Run scripts with `node --env-file=../.env src/<name>.ts` so PRIVATE_KEY is loaded.

import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaTestnet } from "viem/chains";

/**
 * Network endpoints, as configuration rather than constants.
 *
 * Both defaults are the public Shannon testnet endpoints published in the
 * markets-sdk README and pre-filled by the dreamDEX Event Contracts starter
 * template. The SDK requires an indexer URL at construction even though every
 * read and write in these scripts is on chain.
 *
 * `WS_RPC_URL` and `INDEXER_URL` in the env file override them, so pointing at
 * a different network or a self-hosted indexer needs no code change. The names
 * match the starter template's so an existing .env works unchanged.
 */
export const DEFAULT_WS_RPC_URL = "wss://api.infra.testnet.somnia.network/ws";
export const DEFAULT_INDEXER_URL = "https://dev.smk.somnia.host/v1/graphql";

/** Collateral is TestUSDC, 6 decimals. One whole unit in raw units. */
export const ONE_COLLATERAL = 1_000_000n;

/** Fixed stake per call, matching the game's rule of one unit per call. */
export const STAKE = ONE_COLLATERAL;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing. Run with --env-file=../.env`);
  return v;
}

export function makeExchange() {
  const privateKey = required("PRIVATE_KEY") as `0x${string}`;
  return new SomniaMarkets({
    chain: somniaTestnet,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    privateKey,
    wsRpcUrl: process.env.WS_RPC_URL ?? DEFAULT_WS_RPC_URL,
    indexerUrl: process.env.INDEXER_URL ?? DEFAULT_INDEXER_URL,
  });
}

/**
 * The SDK opens a websocket at construction and keeps the process alive after the
 * work is done. Call this at the end of every script, or the script hangs forever.
 */
export async function shutdown(ex: ReturnType<typeof makeExchange>): Promise<void> {
  try {
    ex.client.stopLive?.();
    await (ex as unknown as { close?: () => Promise<void> | void }).close?.();
  } catch {
    // closing a socket that is already gone is not an error worth reporting
  }
  // Anything still holding the loop open is the SDK's, not ours.
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
}

export const EXPLORER = "https://shannon-explorer.somnia.network";

export function txLink(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

/** 6-decimal raw units as a readable number. */
export function fmtUsdc(raw: bigint): string {
  return (Number(raw) / Number(ONE_COLLATERAL)).toFixed(4);
}

/** A probability in (0,1) from a raw 6-decimal price. */
export function toProbability(rawPrice: bigint): number {
  return Number(rawPrice) / Number(ONE_COLLATERAL);
}

export function iso(seconds: number | bigint): string {
  return new Date(Number(seconds) * 1000).toISOString().replace(".000", "");
}

/** Print an unknown value without exploding on bigints. */
export function dump(label: string, value: unknown): void {
  console.log(label, JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 2));
}
