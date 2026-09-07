// The farm: what you have built, what you are building, what it would cost next.

import { Chunky, Label, Note, Panel, ProgressBar, AssetBadge, cx } from "../kit.tsx";
import { CheckIcon, ClockIcon, CoinIcon, CrossIcon, DownIcon, ExternalIcon, UpIcon, EQUIPMENT_ICONS } from "../icons.tsx";
import { formatWindows } from "../../game/view.ts";
import type { CallView, EquipmentOption, FarmView } from "../../game/view.ts";
import { useGame } from "../../game/useGame.tsx";
import { txLink } from "../../chain/exchange.ts";

const TIER_NAMES = ["", "first rows", "a proper field", "heads on every stalk", "taller rows", "the full harvest"];

function BuildPanel({ farm, timeBank }: { farm: FarmView; timeBank: number }) {
  const { actions, pending } = useGame();
  const upgrade = farm.upgrade;

  return (
    <Panel className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="font-display text-[28px] font-semibold leading-tight">Wheat field</span>
          <span className="text-sm font-bold text-muted">Tier {farm.tier} of {farm.maxTier}</span>
        </div>
        <div className="flex gap-1.5" aria-label={`Tier ${farm.tier} of ${farm.maxTier}`}>
          {Array.from({ length: farm.maxTier }, (_, i) => (
            <span key={i} className={cx("h-4 w-4 rounded-full border-2 border-bark", i < farm.tier ? "bg-[#7a9c3a]" : "bg-sand-dark")} />
          ))}
        </div>
      </div>

      <div className="inset flex flex-col gap-2.5 p-4">
        {farm.build ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-extrabold">Building Tier {farm.build.targetTier}</span>
              <span className="tnum text-[13px] font-bold text-muted">{formatWindows(farm.build.remainingWindows)} left</span>
            </div>
            <ProgressBar value={farm.build.progress} />
            <Note className="text-[13px]">Time you earn goes straight into this build.</Note>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-extrabold">Nothing building right now</span>
              {upgrade ? (
                <span className="tnum text-[13px] font-bold text-muted">Tier {upgrade.targetTier} takes {formatWindows(upgrade.windows)}</span>
              ) : null}
            </div>
            <ProgressBar value={farm.bankCoversNext} />
            <Note className="text-[13px]">
              {farm.bankCoversNext > 0
                ? `Your ${formatWindows(timeBank)} of saved Time covers this much the moment you start.`
                : "Time you win goes into your next build the moment it starts."}
            </Note>
          </>
        )}
      </div>

      {upgrade ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="font-display text-xl font-semibold">
              Tier {upgrade.targetTier}, {TIER_NAMES[upgrade.targetTier] ?? "more of everything"}
            </span>
            <span className="flex h-[34px] items-center gap-1.5 rounded-full border-2 border-bark bg-gold px-3 text-sm font-extrabold text-gold-ink">
              <CoinIcon size={16} />
              {upgrade.cost} Coins
            </span>
          </div>
          <Chunky
            variant="primary"
            reason={upgrade.blockedReason}
            busy={pending === `upgrade:${farm.id}`}
            onClick={() => void actions.startUpgrade(farm.id)}
            className="h-[54px] text-[19px] shadow-drop-lg"
          >
            {upgrade.blockedReason ? "Not yet" : `Start building Tier ${upgrade.targetTier}`}
          </Chunky>
          {upgrade.blockedReason ? <Note>{upgrade.blockedReason}</Note> : null}
        </>
      ) : (
        <Note>Your field is finished. Nothing left to build.</Note>
      )}
    </Panel>
  );
}

function EquipmentRow({ farmId, item }: { farmId: string; item: EquipmentOption }) {
  const { actions, pending } = useGame();
  const Icon = EQUIPMENT_ICONS[item.id];

  return (
    <div className={cx("flex items-center gap-3 rounded-[14px] p-3", item.owned ? "inset" : "border-2 border-dashed border-[#b8a890] bg-sand")}>
      <span className={cx("flex h-10 w-10 items-center justify-center rounded-xl border-2 border-bark", item.owned ? "bg-sage text-sage-ink" : "bg-sand-dark text-muted")}>
        <Icon size={20} />
      </span>
      <div className="flex flex-1 flex-col">
        <span className="text-[15px] font-extrabold">{item.label}</span>
        <span className="text-xs font-bold text-muted">
          {item.owned ? `Owned. Opens Tier ${item.unlocksTier}.` : item.reason ?? `Opens Tier ${item.unlocksTier}.`}
        </span>
      </div>
      {item.owned ? (
        <span className="text-sage-ink"><CheckIcon size={18} /></span>
      ) : (
        <Chunky
          variant="gold"
          reason={item.buyable ? null : item.reason ?? "Not yet."}
          busy={pending === `equip:${farmId}:${item.id}`}
          onClick={() => void actions.buyEquipment(farmId, item.id)}
          className="flex h-[38px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-extrabold"
        >
          <CoinIcon size={13} />
          Buy for {item.cost}
        </Chunky>
      )}
    </div>
  );
}

function CallRow({ call }: { call: CallView }) {
  const right = call.outcome === "right";
  const voided = call.outcome === "void";
  const tone = right ? (call.reward?.kind === "coins" ? "text-gold-ink" : "text-sage-ink") : "text-faint";

  let text = "Missed";
  if (right && call.reward) {
    text = call.reward.kind === "coins"
      ? `Right, +${Math.round(call.reward.amount * 10) / 10} ${call.reward.amount === 1 ? "Coin" : "Coins"}`
      : `Right, +${formatWindows(call.reward.amount)}`;
  } else if (voided) text = "Round cancelled, call refunded";

  return (
    <div className="flex h-11 items-center gap-2.5 border-b-2 border-sand-dark last:border-b-0">
      <AssetBadge asset={call.asset} size={28} />
      <span className="w-20 text-sm font-extrabold">{call.label}</span>
      <span className={cx("flex w-[58px] items-center gap-1 text-sm font-extrabold", call.direction === "up" ? "text-gold-ink" : "text-sage-ink")}>
        {call.direction === "up" ? <UpIcon size={14} /> : <DownIcon size={14} />}
        {call.direction === "up" ? "Up" : "Down"}
      </span>
      <span className={cx("flex flex-1 items-center gap-1.5 whitespace-nowrap text-sm font-extrabold", tone)}>
        {right ? <CheckIcon size={14} /> : <CrossIcon size={14} />}
        {text}
      </span>
      <a
        href={txLink(call.txHash)}
        target="_blank"
        rel="noreferrer"
        title="See this call on the explorer"
        className="flex h-[26px] w-[26px] items-center justify-center rounded-md border-2 border-line text-faint hover:text-muted"
      >
        <ExternalIcon size={12} />
      </a>
    </div>
  );
}

export function FarmScreen() {
  const { view } = useGame();
  const farm = view.farms[0];
  if (!farm) return null;

  return (
    <>
      <div className="absolute left-8 top-[108px] z-10 flex w-[min(400px,32vw)] flex-col gap-4">
        <BuildPanel farm={farm} timeBank={view.timeBank} />

        <Panel className="flex flex-col gap-2.5 p-5">
          <Label>Finished calls</Label>
          {view.finishedCalls.length ? (
            <div className="flex flex-col">
              {view.finishedCalls.slice(0, 6).map((c) => (
                <CallRow key={c.id} call={c} />
              ))}
            </div>
          ) : (
            <Note>Nothing has settled yet. Your first call will show up here with a receipt.</Note>
          )}
        </Panel>
      </div>

      <div className="absolute right-8 top-[108px] z-10 flex w-[min(340px,28vw)] flex-col gap-4">
        <Panel className="flex flex-col gap-2.5 p-5">
          <Label>Equipment</Label>
          {farm.equipmentOptions.map((item) => (
            <EquipmentRow key={item.id} farmId={farm.id} item={item} />
          ))}
        </Panel>

        <Panel className="flex items-center gap-3.5 border-[#b6d0c3] bg-sage p-5">
          <span className="flex h-13 w-13 items-center justify-center rounded-2xl border-[3px] border-bark bg-paper p-3 text-sage-ink">
            <ClockIcon size={26} />
          </span>
          <div className="flex flex-col">
            <span className="font-display text-[22px] font-semibold text-sage-ink">
              {formatWindows(view.timeBank)} saved up
            </span>
            <span className="text-[13px] font-bold text-sage-ink">
              Pours into your next build the moment it starts. Never runs out.
            </span>
          </div>
        </Panel>
      </div>
    </>
  );
}
