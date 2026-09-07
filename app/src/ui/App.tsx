// Screen switching, the world behind everything, and the two things that float
// over it: a message and a settlement.

import { useEffect, useRef, useState } from "react";

import { GameProvider, useGame } from "../game/useGame.tsx";
import { FarmScene } from "./FarmScene.tsx";
import { Hud, type Tab } from "./Hud.tsx";
import { Note, Panel, cx } from "./kit.tsx";
import { BoardScreen } from "./screens/BoardScreen.tsx";
import { CallScreen } from "./screens/CallScreen.tsx";
import { FarmScreen } from "./screens/FarmScreen.tsx";
import { SettlementOverlay } from "./screens/SettlementOverlay.tsx";
import { TitleScreen } from "./screens/TitleScreen.tsx";

function Game() {
  const { view, actions, message, dismissMessage, settlement, dismissSettlement, wrongChain } = useGame();
  const [tab, setTab] = useState<Tab>("call");
  const [flash, setFlash] = useState<"coins" | "time" | null>(null);

  // A reward landing makes its counter react, once, as the icon reaches it.
  const lastSettlementId = useRef<string | null>(null);
  useEffect(() => {
    if (!settlement || settlement.id === lastSettlementId.current) return;
    lastSettlementId.current = settlement.id;
    if (settlement.outcome !== "right" || !settlement.reward) return;
    const kind = settlement.reward.kind;
    const id = window.setTimeout(() => {
      setFlash(kind);
      window.setTimeout(() => setFlash(null), 400);
    }, 1400);
    return () => window.clearTimeout(id);
  }, [settlement]);

  const farm = view.farms[0];

  return (
    <div className="relative h-full w-full overflow-hidden bg-grass">
      <FarmScene
        tier={farm?.tier ?? 1}
        equipment={farm?.equipment ?? []}
        preset={tab === "farm" ? "farm" : "stage"}
        className="absolute inset-0 h-full w-full"
      />
      {tab === "board" ? <div className="absolute inset-0 bg-[rgba(51,41,31,0.32)]" aria-hidden /> : null}

      <Hud view={view} tab={tab} onTab={setTab} flash={flash} />

      {tab === "call" ? <CallScreen /> : null}
      {tab === "farm" ? <FarmScreen /> : null}
      {tab === "board" ? <BoardScreen /> : null}

      {wrongChain ? (
        <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center p-4">
          <Panel className="flex items-center gap-4 p-4">
            <Note className="text-ink">Your wallet is on another network. Switch to Somnia to keep playing.</Note>
            <button
              type="button"
              onClick={() => void actions.connect()}
              className="chunky bg-terracotta px-4 py-2 text-cream"
            >
              Switch
            </button>
          </Panel>
        </div>
      ) : null}

      {message ? (
        <div className={cx("absolute inset-x-0 z-30 flex justify-center p-4", wrongChain ? "bottom-24" : "bottom-0")}>
          <Panel className="flex items-center gap-4 p-4">
            <Note className="text-ink">{message}</Note>
            <button type="button" onClick={dismissMessage} className="chunky bg-paper px-4 py-2 text-ink">
              Got it
            </button>
          </Panel>
        </div>
      ) : null}

      {settlement ? <SettlementOverlay call={settlement} onDismiss={dismissSettlement} /> : null}
    </div>
  );
}

function Screens() {
  const { view } = useGame();
  return view.connected ? <Game /> : <TitleScreen />;
}

export function App() {
  return (
    <GameProvider>
      <Screens />
    </GameProvider>
  );
}
