// The bar that never leaves. Coins, Time, calls left, where you are, who you are.

import { CallPips, Pill, cx } from "./kit.tsx";
import { ClockIcon, CoinIcon, WheatIcon } from "./icons.tsx";
import { formatWindows } from "../game/view.ts";
import type { GameView } from "../game/view.ts";

export type Tab = "call" | "farm" | "board";

const TABS: { id: Tab; label: string }[] = [
  { id: "call", label: "Call" },
  { id: "farm", label: "Farm" },
  { id: "board", label: "Board" },
];

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface HudProps {
  view: GameView;
  tab: Tab;
  onTab(tab: Tab): void;
  /** Set briefly when a reward has just landed, so the counter can react. */
  flash: "coins" | "time" | null;
}

export function Hud({ view, tab, onTab, flash }: HudProps) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-[88px] items-center justify-between gap-4 px-8">
      <div className="pointer-events-auto flex items-center gap-3">
        <div className="flex h-12 items-center gap-2 rounded-2xl border-[3px] border-bark bg-terracotta pl-3 pr-4 text-cream shadow-drop">
          <WheatIcon size={24} />
          <span className="font-display text-xl font-semibold">Harvest Call</span>
        </div>

        <Pill className={cx(flash === "coins" && "animate-flash")}>
          <span className="text-gold-ink"><CoinIcon size={20} /></span>
          <span className="tnum">{Math.floor(view.coins)}</span>
          {view.coinsExpiringSoon > 0 ? (
            <span className="text-xs font-bold text-faint">
              {Math.floor(view.coinsExpiringSoon)} expire soon
            </span>
          ) : (
            <span className="text-xs font-bold text-faint">Coins</span>
          )}
        </Pill>

        <Pill className={cx(flash === "time" && "animate-flash")}>
          <span className="text-sage-ink"><ClockIcon size={20} /></span>
          <span className="tnum">{formatWindows(view.timeBank)}</span>
          <span className="text-xs font-bold text-faint">saved</span>
        </Pill>

        <Pill>
          <CallPips left={view.callsLeftToday} total={view.dailyCallCap} />
          <span className="text-sm">{view.callsLeftToday} calls left</span>
        </Pill>
      </div>

      <nav className="pointer-events-auto flex items-center gap-2.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={cx(
              "flex h-11 items-center rounded-full border-[3px] border-bark px-[18px] font-display text-[17px] font-semibold text-ink shadow-drop transition-transform active:translate-y-1 active:shadow-none",
              tab === t.id ? "bg-gold" : "bg-paper",
            )}
          >
            {t.label}
          </button>
        ))}
        {view.address ? (
          <Pill className="text-sm font-bold text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-sage-ink" aria-hidden />
            <span className="tnum">{shortAddress(view.address)}</span>
          </Pill>
        ) : null}
      </nav>
    </header>
  );
}
