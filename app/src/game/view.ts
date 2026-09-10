// Everything the screens are allowed to know, derived from engine state.
//
// No component computes a cost, an affordability, an expiry or a reason. It all
// happens here, once, from the rules. Components render this and call actions.

import {
  available, dayOf, rewardUnits, tierCap, upgradeFrom,
  type Call, type EquipmentId, type GameState, type Player, type Rules,
} from "farm-engine";
import { GAME_WINDOW_SECONDS, secondsLeftInWindow } from "../chain/clock.ts";
import type { Direction, LiveWindow } from "../chain/types.ts";

/** Coins within a day of expiry get a gentle warning. A day's length is a rule. */
const expiryWarningWindows = (rules: Rules): number => rules.windowsPerDay;

export type AssetState =
  | { kind: "open" }
  | { kind: "closed"; reason: string };

export interface AssetOption {
  asset: string;
  label: string;
  state: AssetState;
  /** The direction already called on this round's market, if any. */
  calledDirection: Direction | null;
  /** Seconds until this asset's round settles, or null when nothing is open. */
  settlesInSeconds: number | null;
}

export interface EquipmentOption {
  id: EquipmentId;
  label: string;
  cost: number;
  owned: boolean;
  /** Buyable now: not owned, affordable, and the item before it is in. */
  buyable: boolean;
  /** Why it cannot be bought, when it cannot. */
  reason: string | null;
  unlocksTier: number;
}

export interface UpgradeOption {
  targetTier: number;
  cost: number;
  windows: number;
  affordable: boolean;
  /** Null when the upgrade can start. */
  blockedReason: string | null;
}

export interface BuildView {
  targetTier: number;
  remainingWindows: number;
  totalWindows: number;
  /** 0 to 1, how much of the build is done. */
  progress: number;
}

export interface FarmView {
  id: string;
  template: string;
  tier: number;
  maxTier: number;
  equipment: EquipmentId[];
  build: BuildView | null;
  upgrade: UpgradeOption | null;
  equipmentOptions: EquipmentOption[];
  /** Windows of the next build the banked Time would cover, as 0 to 1. */
  bankCoversNext: number;
}

export interface CallView {
  id: string;
  asset: string;
  label: string;
  direction: Direction;
  result: "up" | "down" | "void" | null;
  /** Right, missed, voided, or still open. */
  outcome: "right" | "missed" | "void" | "open";
  /** What a right call paid, in whole-ish units for display. Null unless right. */
  reward: { kind: "coins" | "time"; amount: number } | null;
  placedAtWindow: number;
  /** The placing transaction. Also the call id. */
  txHash: string;
  /**
   * Seconds until this call settles, or null once its round has left the live
   * list, which means it is settling now.
   */
  settlesInSeconds: number | null;
}

export interface GameView {
  connected: boolean;
  address: string | null;
  coins: number;
  timeBank: number;
  callsLeftToday: number;
  dailyCallCap: number;
  secondsLeftInWindow: number;
  /** Seconds until the soonest open round settles. This is the countdown to show. */
  roundSettlesInSeconds: number | null;
  windowId: number;
  coinsExpiringSoon: number;
  assets: AssetOption[];
  openCalls: CallView[];
  finishedCalls: CallView[];
  farms: FarmView[];
  farmValue: number;
  hitRate: { right: number; decided: number };
}

const ASSET_LABELS: Record<string, string> = { BTC: "Bitcoin", ETH: "Ethereum" };
export const assetLabel = (asset: string): string => ASSET_LABELS[asset] ?? asset;

const EQUIPMENT_LABELS: Record<EquipmentId, string> = {
  irrigation: "Irrigation",
  harvester: "Harvester",
  shed: "Shed",
};

/**
 * A coin amount as the player should read it: "3", "1.6", "0.1".
 *
 * Rewards are fractional, so a display that rounds to whole numbers tells a
 * player who just earned 0.1 Coins that they earned nothing, and a balance of
 * 0.9 that they have none. Both were real: a correct call once showed "+0 Coins"
 * and the bar sat at 0 while coins were genuinely accumulating.
 *
 * So: whole numbers stay whole, anything else keeps up to two decimals with the
 * trailing zeros trimmed, and a real amount never renders as "0".
 */
export function formatCoins(amount: number): string {
  if (amount === 0) return "0";
  const rounded = Math.round(amount * 100) / 100;
  // Smaller than two decimals can show. Saying "0" would be the original lie.
  if (rounded === 0) return amount > 0 ? "0.01" : "-0.01";
  return String(rounded);
}

/** "1 Coin" / "2 Coins" / "0.1 Coins", with the number formatted honestly. */
export function formatCoinsWithUnit(amount: number): string {
  return `${formatCoins(amount)} ${amount === 1 ? "Coin" : "Coins"}`;
}

/** Whole minutes of build time one unit of Time is worth. */
export const minutesPerWindow = GAME_WINDOW_SECONDS / 60;

/** "1h 45m", "45m", "none yet". Time is always spoken as time, never as a count. */
export function formatWindows(windows: number): string {
  const minutes = Math.round(windows * minutesPerWindow);
  if (minutes <= 0) return "none yet";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * "56 min", "4h 12m", "under a minute". Used for anything the player is waiting
 * on, which on testnet can be hours: the round length comes from the market, not
 * from the game.
 */
export function formatWait(seconds: number | null): string {
  if (seconds === null) return "settling now";
  if (seconds <= 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "08:42". Kept for anything genuinely short. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function callView(rules: Rules, c: Call, settlesInSeconds: number | null): CallView {
  const outcome: CallView["outcome"] =
    c.result === null ? "open" : c.result === "void" ? "void" : c.result === c.direction ? "right" : "missed";
  let reward: CallView["reward"] = null;
  if (outcome === "right") {
    // The formula lives in the engine. Never a second copy: a change there has to
    // reach the receipt the player reads.
    reward = { kind: rules.resourceFor[c.direction], amount: rewardUnits(rules, c.entryPrice) };
  }
  return {
    id: c.id,
    asset: c.asset,
    label: assetLabel(c.asset),
    direction: c.direction,
    result: c.result,
    outcome,
    reward,
    placedAtWindow: c.placedAtWindow,
    txHash: c.id,
    settlesInSeconds,
  };
}

function equipmentOptions(rules: Rules, farm: Player["farms"][number], coins: number): EquipmentOption[] {
  return (Object.keys(rules.equipment) as EquipmentId[]).map((id) => {
    const def = rules.equipment[id];
    const owned = farm.equipment.includes(id);
    // Equipment comes in tier order: no shed before the harvester.
    const inOrder = tierCap(rules, farm) >= def.unlocksTier - 1;
    const affordable = coins >= def.cost;
    let reason: string | null = null;
    if (!owned && !inOrder) reason = "Needs the one before it first.";
    else if (!owned && !affordable) reason = `Needs ${def.cost} Coins.`;
    return {
      id,
      label: EQUIPMENT_LABELS[id],
      cost: def.cost,
      owned,
      buyable: !owned && inOrder && affordable,
      reason,
      unlocksTier: def.unlocksTier,
    };
  });
}

function farmView(rules: Rules, p: Player, farm: Player["farms"][number], coins: number): FarmView {
  const up = upgradeFrom(rules, farm.tier);
  const cap = tierCap(rules, farm);

  let upgrade: UpgradeOption | null = null;
  if (up) {
    const capped = farm.tier + 1 > cap;
    const affordable = coins >= up.cost;
    let blockedReason: string | null = null;
    if (farm.build) blockedReason = "Something is already building.";
    else if (capped) blockedReason = "Needs new equipment first.";
    else if (!affordable) blockedReason = `Needs ${up.cost} Coins. You have ${formatCoins(coins)}.`;
    upgrade = { targetTier: farm.tier + 1, cost: up.cost, windows: up.windows, affordable, blockedReason };
  }

  const build: BuildView | null = farm.build
    ? (() => {
        const total = upgradeFrom(rules, farm.build!.targetTier - 1)?.windows ?? farm.build!.remainingWindows;
        return {
          targetTier: farm.build!.targetTier,
          remainingWindows: farm.build!.remainingWindows,
          totalWindows: total,
          progress: total > 0 ? Math.min(1, 1 - farm.build!.remainingWindows / total) : 1,
        };
      })()
    : null;

  const nextWindows = up?.windows ?? 0;
  return {
    id: farm.id,
    template: farm.template,
    tier: farm.tier,
    maxTier: rules.maxTier,
    equipment: [...farm.equipment],
    build,
    upgrade,
    equipmentOptions: equipmentOptions(rules, farm, coins),
    bankCoversNext: nextWindows > 0 ? Math.min(1, p.timeBank / nextWindows) : 0,
  };
}

function assetOptions(
  p: Player,
  windows: LiveWindow[],
  callsLeft: number,
  now: number,
): AssetOption[] {
  const known = ["BTC", "ETH"];
  const assets = [...new Set([...known, ...windows.map((w) => w.asset)])];

  return assets.map((asset) => {
    const window = windows.find((w) => w.asset === asset) ?? null;
    const openCall = window
      ? p.calls.find((c) => c.marketId === window.marketId && c.result === null) ?? null
      : null;

    const settlesInSeconds = window ? Math.max(0, window.expiry - Math.floor(now / 1000)) : null;

    let state: AssetState;
    if (!window) state = { kind: "closed", reason: `Nothing open for ${assetLabel(asset)} right now.` };
    else if (openCall) {
      // The wait is the market's, not the game's. Saying "when the round closes"
      // read as the 15-minute countdown and was wrong by hours.
      state = {
        kind: "closed",
        reason: `You already called ${assetLabel(asset)} this round. It opens again when this one settles, in ${formatWait(settlesInSeconds)}.`,
      };
    } else if (callsLeft <= 0) {
      state = { kind: "closed", reason: "No calls left today. They come back at midnight." };
    } else state = { kind: "open" };

    return { asset, label: assetLabel(asset), state, calledDirection: openCall?.direction ?? null, settlesInSeconds };
  });
}

export interface ViewInput {
  rules: Rules;
  state: GameState;
  playerId: string;
  address: string | null;
  windows: LiveWindow[];
  now: number;
}

export function buildView({ rules, state, playerId, address, windows, now }: ViewInput): GameView {
  const p = state.players[playerId];
  const windowId = state.windowId;

  if (!p) {
    return {
      connected: Boolean(address),
      address,
      coins: 0,
      timeBank: 0,
      callsLeftToday: rules.dailyCallCap,
      dailyCallCap: rules.dailyCallCap,
      secondsLeftInWindow: secondsLeftInWindow(now),
      roundSettlesInSeconds: null,
      windowId,
      coinsExpiringSoon: 0,
      assets: [],
      openCalls: [],
      finishedCalls: [],
      farms: [],
      farmValue: 0,
      hitRate: { right: 0, decided: 0 },
    };
  }

  const coins = available(p, "coins", windowId);
  const used = p.callsByDay[dayOf(rules, windowId)] ?? 0;
  const callsLeftToday = Math.max(0, rules.dailyCallCap - used);

  const coinsExpiringSoon = p.lots
    .filter((l) => l.kind === "coins" && l.expiresAfterWindow >= windowId && l.expiresAfterWindow - windowId <= expiryWarningWindows(rules))
    .reduce((n, l) => n + l.amount, 0);

  // A call settles when its market expires. Once that market drops off the live
  // list there is nothing left to count, which is itself the answer: any moment.
  const nowSeconds = Math.floor(now / 1000);
  const expiryOf = (marketId: string): number | null => {
    const w = windows.find((x) => x.marketId === marketId);
    return w ? Math.max(0, w.expiry - nowSeconds) : null;
  };
  const calls = p.calls.map((c) => callView(rules, c, c.result === null ? expiryOf(c.marketId) : null));
  const farmValue = p.farms.reduce((n, f) => n + f.tier * rules.templates[f.template].multiplier * p.prestige, 0);

  return {
    connected: Boolean(address),
    address,
    coins,
    timeBank: p.timeBank,
    callsLeftToday,
    dailyCallCap: rules.dailyCallCap,
    secondsLeftInWindow: secondsLeftInWindow(now),
    roundSettlesInSeconds: windows.length
      ? Math.min(...windows.map((w) => Math.max(0, w.expiry - nowSeconds)))
      : null,
    windowId,
    coinsExpiringSoon,
    assets: assetOptions(p, windows, callsLeftToday, now),
    openCalls: calls.filter((c) => c.outcome === "open").reverse(),
    finishedCalls: calls.filter((c) => c.outcome !== "open").reverse(),
    farms: p.farms.map((f) => farmView(rules, p, f, coins)),
    farmValue,
    hitRate: { right: p.stats.callsCorrect, decided: p.stats.callsCorrect + p.stats.callsWrong },
  };
}
