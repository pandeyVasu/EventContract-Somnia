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

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
