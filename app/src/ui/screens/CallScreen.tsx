// The main screen. Pick an asset, pick a direction. That is the whole interface.

import { Chunky, Note, Panel, Pill, AssetBadge, cx } from "../kit.tsx";
import { ClockIcon, CoinIcon, DownIcon, UpIcon } from "../icons.tsx";
import { formatRoundLength, formatWait } from "../../game/view.ts";
import type { AssetOption, CallView, GameView } from "../../game/view.ts";
import { useGame } from "../../game/useGame.tsx";
import type { Direction } from "../../chain/types.ts";

function DirectionButton({
  direction, reason, busy, nearlyDecided, onClick,
}: { direction: Direction; reason: string | null; busy: boolean; nearlyDecided: boolean; onClick(): void }) {
  const up = direction === "up";
  return (
    <Chunky
      variant={up ? "up" : "down"}
      reason={reason}
      busy={busy}
      onClick={onClick}
      className="flex h-24 flex-col items-center justify-center gap-1.5 px-0 shadow-[0_5px_0_#6f5334]"
    >
      {up ? <UpIcon size={26} /> : <DownIcon size={26} />}
      <span className="font-display text-xl font-semibold">{up ? "Up" : "Down"}</span>
      <span className="flex items-center gap-1.5 text-xs font-extrabold">
        {up ? <CoinIcon size={13} /> : <ClockIcon size={13} />}
        {nearlyDecided ? "pays very little" : `pays ${up ? "Coins" : "Time"}`}
      </span>
    </Chunky>
  );
}

/**
 * What the sign says under the buttons.
 *
 * A round that is nearly over has usually gone one way already, and calling
 * that way is right but worth almost nothing. The player has no prices to read,
 * so the game has to say it in words or they spend a call finding out.
 */
function noteFor(option: AssetOption, closed: boolean, hint: string): string {
  if (closed) return (option.state as { reason: string }).reason;
  const settled = (["up", "down"] as Direction[]).filter((d) => option.nearlyDecided[d]);
  if (settled.length === 1) {
    const decided = settled[0] === "up" ? "Up" : "Down";
    const other = settled[0] === "up" ? "Down" : "Up";
    return `This round has all but gone ${decided} already, so calling ${decided} earns very little. ${other} is the long shot.`;
  }
  return hint;
}

function AssetSign({ option, hint }: { option: AssetOption; hint: string }) {
  const { actions, pending } = useGame();
  const closed = option.state.kind === "closed";

  return (
    <div className="flex w-full max-w-[420px] flex-col items-center">
      <Panel className={cx("flex w-full flex-col gap-4 p-6", closed && "opacity-80")}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AssetBadge asset={option.asset} />
            <div className="flex flex-col">
              <span className="font-display text-[26px] font-semibold leading-tight">{option.label}</span>
              <span className={cx("text-sm font-bold", closed ? "text-muted" : "text-sage-ink")}>
                {closed ? "Called this round" : "Open for a call"}
              </span>
            </div>
          </div>
          {option.calledDirection ? (
            <span className="flex items-center gap-1 rounded-full border-2 border-bark bg-sand-dark px-2.5 py-1 text-[13px] font-extrabold text-[#5a4b3a]">
              {option.calledDirection === "up" ? <UpIcon size={14} /> : <DownIcon size={14} />}
              {option.calledDirection === "up" ? "Up" : "Down"}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {(["up", "down"] as Direction[]).map((d) => (
            <DirectionButton
              key={d}
              direction={d}
              reason={closed ? (option.state as { reason: string }).reason : null}
              busy={pending === `call:${option.asset}:${d}`}
              nearlyDecided={option.nearlyDecided[d]}
              onClick={() => void actions.placeCall(option.asset, d)}
            />
          ))}
        </div>

        <Note className="text-center">{noteFor(option, closed, hint)}</Note>
      </Panel>
      {/* The post that makes the panel a sign standing in the field. */}
      <div className="mt-1.5 h-[70px] w-[18px] rounded-b-md border-[3px] border-t-0 border-bark bg-plank" aria-hidden />
    </div>
  );
}

function PendingChip({ call }: { call: CallView }) {
  return (
    <Pill className="h-[46px] gap-2.5">
      <AssetBadge asset={call.asset} size={28} />
      <span>{call.label}</span>
      <span className={cx("flex items-center gap-1", call.direction === "up" ? "text-gold-ink" : "text-sage-ink")}>
        {call.direction === "up" ? <UpIcon size={15} /> : <DownIcon size={15} />}
        {call.direction === "up" ? "Up" : "Down"}
      </span>
      <span className="text-sm font-bold text-muted">
        {call.settlesInSeconds === null ? "settling now" : `settles in ${formatWait(call.settlesInSeconds)}`}
      </span>
    </Pill>
  );
}

/** The dilemma, in one sentence, only when it is actually a dilemma. */
function hintFor(view: GameView): string {
  const build = view.farms[0]?.build;
  if (build && view.timeBank <= 0) return "A build is running. Down pays Time and shortens it.";
  if (view.farms[0]?.upgrade && !view.farms[0].upgrade.affordable) {
    return "Your next upgrade needs Coins. Up pays Coins.";
  }
  return "Up pays Coins for upgrades. Down pays Time to finish them sooner.";
}

/**
 * How soon the player wants to find out.
 *
 * The only property of the underlying round the game ever names, and it is
 * named as a pace rather than as a market: "how soon do you want to know",
 * never a length of contract. It offers exactly the lengths that are open right
 * now, because what the venue runs changes through the day, and it hides itself
 * entirely when there is no choice to make.
 */
function RoundLengthPicker() {
  const { view, actions } = useGame();
  if (view.roundLengths.length < 2) return null;

  const choose = (v: number | null) => () => actions.chooseRoundLength(v);
  const active = view.preferredRoundLength;

  return (
    // Stacked, and the row wraps. Side by side, the label and the buttons were
    // wider than the space at any realistic window and sat on top of each other.
    <div className="flex max-w-full flex-col items-center gap-1.5">
      <span className="on-world text-[13px] font-extrabold">How soon do you want to know?</span>
      <div className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-[22px] border-[3px] border-bark bg-sand p-1">
        <button
          type="button"
          onClick={choose(null)}
          aria-pressed={active === null}
          className={cx(
            "h-8 rounded-full px-3 text-[13px] font-extrabold transition-colors",
            active === null ? "bg-terracotta text-cream" : "text-muted hover:text-ink",
          )}
        >
          Soonest
        </button>
        {view.roundLengths.map((seconds) => (
          <button
            key={seconds}
            type="button"
            onClick={choose(seconds)}
            aria-pressed={active === seconds}
            className={cx(
              "h-8 rounded-full px-3 text-[13px] font-extrabold tnum transition-colors",
              active === seconds ? "bg-terracotta text-cream" : "text-muted hover:text-ink",
            )}
          >
            {formatRoundLength(seconds)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CallScreen() {
  const { view } = useGame();
  const hint = hintFor(view);

  return (
    <>
      <div className="absolute inset-x-0 top-[104px] z-10 flex flex-col items-center gap-2 px-8">
        <h1 className="on-world m-0 text-center font-display text-[clamp(28px,3vw,40px)] font-semibold tracking-tight">
          Which way this round?
        </h1>
        {view.roundSettlesInSeconds !== null ? (
          <Pill className="h-10">
            <span className="text-muted"><ClockIcon size={18} /></span>
            <span className="font-bold text-muted">This round settles in</span>
            <span className="tnum">{formatWait(view.roundSettlesInSeconds)}</span>
          </Pill>
        ) : (
          <Pill className="h-10">
            <span className="font-bold text-muted">No round open right now</span>
          </Pill>
        )}
        <RoundLengthPicker />
      </div>

      <div className="absolute inset-x-0 top-[250px] z-10 flex justify-center gap-[clamp(24px,8vw,140px)] px-8">
        {view.assets.map((option) => (
          <AssetSign key={option.asset} option={option} hint={hint} />
        ))}
      </div>

      {view.openCalls.length ? (
        <div className="absolute inset-x-0 bottom-7 z-10 flex flex-col items-center gap-2.5 px-8">
          <span className="label on-world">Waiting to settle</span>
          <div className="flex flex-wrap justify-center gap-3">
            {view.openCalls.map((c) => (
              <PendingChip key={c.id} call={c} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
