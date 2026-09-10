// Wallet wiring. One chain, one connector: the player's own injected wallet on
// Somnia Shannon. Nothing here knows about the game.

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { somniaTestnet } from "viem/chains";

export const CHAIN = somniaTestnet;

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [injected()],
  transports: { [CHAIN.id]: http() },
});

/** The shape we need off a wagmi connector, without importing its whole type. */
interface ConnectorLike {
  id: string;
  name: string;
  type?: string;
}

/**
 * Which wallet to talk to when the browser has more than one.
 *
 * wagmi announces every injected wallet it discovers (EIP-6963) and also keeps
 * a generic connector aimed at `window.ethereum`. Taking the first of those
 * took whichever happened to be listed first, and in a browser with a built-in
 * wallet sitting beside an extension the built-in one usually owns
 * `window.ethereum` — so a player who installed MetaMask was quietly handed the
 * other wallet, or nothing at all, and the connect button did nothing they
 * could explain.
 *
 * So: prefer MetaMask by name, because that is the wallet the setup steps name;
 * then any specifically discovered wallet, which is a real one rather than a
 * shim; then whatever is left, so a browser with a single wallet still works.
 */
export function pickConnector<T extends ConnectorLike>(connectors: readonly T[]): T | undefined {
  const named = (c: T) => `${c.id} ${c.name}`.toLowerCase();
  return (
    connectors.find((c) => named(c).includes("metamask"))
    ?? connectors.find((c) => c.type !== "injected" || c.id !== "injected")
    ?? connectors[0]
  );
}

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
