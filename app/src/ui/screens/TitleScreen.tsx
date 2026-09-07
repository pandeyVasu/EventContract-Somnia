// What a stranger sees first. One promise, one paragraph, two buttons.

import { FarmScene } from "../FarmScene.tsx";
import { Chunky, Note, Panel } from "../kit.tsx";
import { CoinIcon, WalletIcon, WheatIcon } from "../icons.tsx";
import { useGame } from "../../game/useGame.tsx";

export function TitleScreen() {
  const { actions, pending, message } = useGame();

  return (
    <div className="relative h-full w-full overflow-hidden bg-grass">
      <FarmScene tier={5} equipment={["irrigation", "harvester", "shed"]} preset="title" className="absolute inset-0 h-full w-full" />
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(90deg, rgba(51,41,31,0.28) 0%, rgba(51,41,31,0.08) 55%, rgba(51,41,31,0) 100%)" }}
        aria-hidden
      />

      <div className="absolute left-[6vw] top-1/2 flex w-[min(600px,52vw)] -translate-y-1/2 flex-col gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border-[3px] border-bark bg-terracotta text-cream shadow-drop">
            <WheatIcon size={32} />
          </div>
          <span className="on-world font-display text-2xl font-semibold">Harvest Call</span>
        </div>

        <h1 className="on-world m-0 font-display text-[clamp(40px,5.2vw,74px)] font-bold leading-[1.02] tracking-tight">
          Call the weather.
          <br />
          Grow the farm.
        </h1>

        <Panel className="flex flex-col gap-5 p-6">
          <p className="m-0 text-lg font-semibold leading-relaxed text-[#5a4b3a]">
            Eight times a day, pick Bitcoin or Ethereum and say Up or Down. Call it right and your farm
            gets paid: Up pays Coins to buy upgrades, Down pays Time to finish them sooner. Wrong calls
            pay nothing. Your farm grows only as well as you read the sky.
          </p>

          <div className="flex flex-wrap items-center gap-3.5">
            <Chunky
              variant="primary"
              busy={pending === "connect"}
              onClick={() => void actions.connect()}
              className="flex h-[58px] items-center gap-2.5 text-xl shadow-drop-lg"
            >
              <WalletIcon size={22} />
              Connect wallet
            </Chunky>
            <Chunky
              variant="gold"
              busy={pending === "faucet"}
              reason={null}
              onClick={() => void actions.getTestFunds()}
              className="flex h-[58px] items-center gap-2.5 text-xl shadow-drop-lg"
            >
              <CoinIcon size={22} />
              Get test funds
            </Chunky>
          </div>

          {message ? <Note className="text-ink">{message}</Note> : null}

          <Note className="text-xs text-faint">
            Runs on a test network. Nothing here is real money, and nothing leaves your wallet without
            you clicking. First time here? Get free STT for fees at{" "}
            <a
              href="https://testnet.somnia.network"
              target="_blank"
              rel="noreferrer"
              className="font-extrabold text-terracotta underline"
            >
              testnet.somnia.network
            </a>
            , then press Get test funds.
          </Note>
        </Panel>
      </div>
    </div>
  );
}
