// The payoff. A round closed, and here is what it did to your farm.
//
// The one place the chain is allowed to show: a small link proving the call was
// a real contract that really settled.

import { Panel } from "../kit.tsx";
import { ClockIcon, CoinIcon, ExternalIcon } from "../icons.tsx";
import { formatWindows } from "../../game/view.ts";
import type { CallView } from "../../game/view.ts";
import { txLink } from "../../chain/exchange.ts";

interface Props {
  call: CallView;
  onDismiss(): void;
}

export function SettlementOverlay({ call, onDismiss }: Props) {
  const right = call.outcome === "right";
  const voided = call.outcome === "void";
  const paysCoins = call.reward?.kind === "coins";

  let headline: string;
  if (voided) headline = `The ${call.label} round was cancelled.`;
  else if (right) headline = `${call.label} went ${call.direction === "up" ? "Up" : "Down"}. You called it.`;
  else headline = `${call.label} went the other way this time.`;

  let reward: string | null = null;
  if (right && call.reward) {
    reward = paysCoins
      ? `+${Math.round(call.reward.amount * 10) / 10} ${call.reward.amount === 1 ? "Coin" : "Coins"}`
      : `+${formatWindows(call.reward.amount)}`;
  } else if (voided) reward = "Your call came back";

  return (
    <div
      className="absolute inset-x-0 bottom-0 top-[88px] z-30 flex items-center justify-center bg-[rgba(51,41,31,0.48)] px-8"
      role="dialog"
      aria-modal="true"
      aria-label="A round has closed"
      onClick={onDismiss}
    >
      <Panel className="relative flex w-[min(540px,92vw)] animate-pop flex-col items-center gap-5 p-10 pb-8">
        <div className="relative flex h-32 w-32 items-center justify-center">
          <div className={`absolute inset-0 rounded-full border-[3px] border-bark ${right ? (paysCoins ? "bg-gold" : "bg-sage") : "bg-sand-dark"}`} />
          <div className={`relative ${right ? (paysCoins ? "text-gold-ink" : "text-sage-ink") : "text-faint"}`}>
            {paysCoins || !right ? <CoinIcon size={74} /> : <ClockIcon size={74} />}
          </div>
          {right ? (
            <div
              className="absolute -right-2 -top-2 flex h-11 w-11 animate-fly items-center justify-center rounded-full border-[3px] border-bark"
              style={
                {
                  // Fly to where this reward lives in the bar.
                  "--fly-to": paysCoins
                    ? "translate(-320px, -330px) scale(0.4)"
                    : "translate(-140px, -330px) scale(0.4)",
                  background: paysCoins ? "#f2cf7a" : "#9fc7b2",
                } as React.CSSProperties
              }
              aria-hidden
            >
              <span className={paysCoins ? "text-gold-ink" : "text-sage-ink"}>
                {paysCoins ? <CoinIcon size={24} /> : <ClockIcon size={24} />}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          <span className="label">Round closed</span>
          <h2 className="m-0 font-display text-[clamp(26px,3vw,38px)] font-semibold leading-tight">{headline}</h2>
          {reward ? (
            <span
              className={`mt-1.5 flex h-[50px] items-center gap-2 rounded-full border-[3px] border-bark px-5 font-display text-2xl font-semibold shadow-drop ${
                paysCoins ? "bg-gold text-gold-ink" : "bg-sage text-sage-ink"
              }`}
            >
              {paysCoins ? <CoinIcon size={22} /> : <ClockIcon size={22} />}
              {reward}
            </span>
          ) : (
            <span className="mt-1.5 text-base font-bold text-muted">Nothing this time. Eight calls a day, and the next round is close.</span>
          )}
        </div>

        <div className="mt-1 flex flex-col items-center gap-2">
          <a
            href={txLink(call.txHash)}
            target="_blank"
            rel="noreferrer"
            title="See this call on the explorer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 text-[13px] font-extrabold text-faint hover:text-muted"
          >
            This call settled on Somnia
            <ExternalIcon size={12} />
          </a>
          <span className="text-[13px] font-bold text-[#b8a890]">Click anywhere to keep going</span>
        </div>
      </Panel>
    </div>
  );
}
