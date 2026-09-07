// Neighbouring farms. Local for now, and honest about it.

import { Note, Panel } from "../kit.tsx";
import { useGame } from "../../game/useGame.tsx";

function shortAddress(address: string | null): string {
  if (!address) return "You";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function BoardScreen() {
  const { view } = useGame();
  const { right, decided } = view.hitRate;
  const perTen = decided > 0 ? Math.round((right / decided) * 10) : null;

  return (
    <div className="absolute inset-x-0 top-[120px] z-10 flex flex-col items-center px-8">
      <div className="flex flex-col items-center gap-1.5 rounded-t-[18px] border-[3px] border-bark bg-plank px-10 py-3.5">
        <h1 className="m-0 font-display text-[34px] font-semibold text-cream" style={{ textShadow: "0 2px 0 #6f5334" }}>
          Neighbouring farms
        </h1>
        <span className="text-sm font-extrabold text-gold">Ranked by farm value</span>
      </div>
      <div className="-my-[3px] flex gap-[300px]" aria-hidden>
        <div className="h-[26px] w-3.5 bg-bark" />
        <div className="h-[26px] w-3.5 bg-bark" />
      </div>

      <Panel className="flex w-[min(860px,90vw)] flex-col overflow-hidden">
        <div className="label grid grid-cols-[64px_1fr_150px_130px_130px] items-center border-b-[3px] border-bark bg-sand-dark px-7 py-3 text-muted">
          <span>Rank</span>
          <span>Farmer</span>
          <span className="text-right">Farm value</span>
          <span className="text-right">Calls right</span>
          <span className="text-right">Calls made</span>
        </div>
        <div className="grid grid-cols-[64px_1fr_150px_130px_130px] items-center bg-[#f7e6c2] px-7 py-4 text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-bark bg-gold font-display font-bold text-gold-ink">1</span>
          <span className="flex items-center gap-2.5 font-extrabold">
            {shortAddress(view.address)}
            <span className="rounded-full border-2 border-bark bg-terracotta px-2.5 py-0.5 text-xs font-extrabold text-cream">You</span>
          </span>
          <span className="tnum text-right font-extrabold">{Math.round(view.farmValue * 10) / 10}</span>
          <span className="tnum text-right font-bold text-muted">{perTen === null ? "—" : `${perTen} in 10`}</span>
          <span className="tnum text-right font-bold text-muted">{decided}</span>
        </div>
      </Panel>

      <Note className="mt-4 text-center text-cream" >
        This board is local to your browser. Other farms appear when the game is played from a shared server.
      </Note>
    </div>
  );
}
