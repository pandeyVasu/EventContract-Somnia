// Every number the spec quotes lives here, plus the toggles the spec is silent on.
// Nothing in engine.ts hardcodes a figure.

export type Resource = "coins" | "time";
export type Direction = "up" | "down";
export type MarketResult = "up" | "down" | "void";

export type TemplateId = "wheat" | "orchard" | "vineyard" | "greenhouse";
export type EquipmentId = "irrigation" | "harvester" | "shed";

export interface TemplateDef {
  cost: number;          // coins; 0 = starting farm
  multiplier: number;    // score multiplier
  unlockAfter: TemplateId | null; // must own this first
}

export interface UpgradeDef {
  from: number;
  cost: number;          // coins
  windows: number;       // build time in 15-minute windows
}

export interface EquipmentDef {
  cost: number;          // coins
  unlocksTier: number;   // owning it raises the tier cap to this
}

export interface Rules {
  windowsPerDay: number;
  dailyCallCap: number;
  rewardPerCall: number;         // units per correct call
  voidReward: number;            // units of BOTH resources on a voided market
  /** Lots earned at settlement window W are usable through W + expiryRounds, purged after. */
  expiryRounds: number;
  /** Which direction earns which resource. */
  resourceFor: Record<Direction, Resource>;
  templates: Record<TemplateId, TemplateDef>;
  upgrades: UpgradeDef[];
  equipment: Record<EquipmentId, EquipmentDef>;
  baseTierCap: number;           // tier reachable with no equipment
  maxTier: number;

  // --- Toggles for gaps the spec does not settle. Default = spec as written. ---

  /** Forbid Up AND Down on the same market. Closes the guaranteed-hedge exploit. */
  oneDirectionPerMarket: boolean;
  /** Reject a call whose entry price (probability of its own side) exceeds this. null = no limit. */
  maxEntryPrice: number | null;
  /** Reward scaled by (1 - entryPrice) instead of flat. Alternative to maxEntryPrice. */
  riskScaledReward: boolean;
  /** With riskScaledReward: units = rewardPerCall * min(maxRewardMultiplier, (1 - entryPrice) / riskBaselinePrice). */
  riskBaselinePrice: number;
  maxRewardMultiplier: number;
  /**
   * The least a correct call may ever pay.
   *
   * Risk scaling is what stops a player calling a round that is already decided
   * and collecting a full reward for no read. Taken alone it also means a
   * correct call entered very late pays a number so small it reads as nothing:
   * an entry at 0.98 earns 0.04 units, and the player who called it right is
   * told they earned zero. They cannot see prices, so they have no way to have
   * known. The floor keeps the discouragement while making sure being right is
   * always worth something the player can see. 0 restores the pure scaling.
   *
   * Sized deliberately at the sniper's own entry. A player who waits until a
   * round is all but decided enters around 0.95, which the curve already pays
   * 0.1, so a floor of 0.1 hands that player nothing extra: seasons simulated
   * on five seeds put the sniper on exactly the same tier with the floor on and
   * off. A floor of 0.25 does not hold that line — it pays the sniper two and a
   * half times over and lifts it to the casual player's tier on every seed.
   */
  minRewardUnits: number;
  /** Time units auto-apply to the farm's running build on settlement; if none, they are lost. */
  timeAutoApplies: boolean;
  /** Time left over after applying to running builds goes to Player.timeBank (never expires) instead of being lost.
   *  The bank drains into the next START_UPGRADE. */
  timeBanks: boolean;
  /** A voided call gives back the daily-cap slot on the day it was placed (dayOf(placedAtWindow)). */
  voidRefundsCall: boolean;
}

export const SPEC_RULES: Rules = {
  windowsPerDay: 96,
  dailyCallCap: 8,
  rewardPerCall: 1,
  voidReward: 0.5,
  expiryRounds: 1,
  resourceFor: { up: "coins", down: "time" },
  templates: {
    wheat:      { cost: 0,   multiplier: 1.0, unlockAfter: null },
    orchard:    { cost: 80,  multiplier: 1.4, unlockAfter: "wheat" },
    vineyard:   { cost: 200, multiplier: 1.8, unlockAfter: "orchard" },
    greenhouse: { cost: 450, multiplier: 2.5, unlockAfter: "vineyard" },
  },
  upgrades: [
    { from: 1, cost: 20,  windows: 4 },
    { from: 2, cost: 50,  windows: 12 },
    { from: 3, cost: 120, windows: 32 },
    { from: 4, cost: 280, windows: 96 },
  ],
  equipment: {
    irrigation: { cost: 40,  unlocksTier: 3 },
    harvester:  { cost: 100, unlocksTier: 4 },
    shed:       { cost: 240, unlocksTier: 5 },
  },
  baseTierCap: 2,
  maxTier: 5,

  oneDirectionPerMarket: false,
  maxEntryPrice: null,
  riskScaledReward: false,
  riskBaselinePrice: 1,       // plain (1 - p) when riskScaledReward is on
  maxRewardMultiplier: Infinity,
  minRewardUnits: 0,          // the spec sets no floor
  timeAutoApplies: true,
  timeBanks: false,
  voidRefundsCall: false,
};

/** Spec plus the three fixes proposed in the feasibility review. */
export const FIXED_RULES: Rules = {
  ...SPEC_RULES,
  oneDirectionPerMarket: true,
  maxEntryPrice: 0.65,
};

/**
 * The rules the game ships with. Locked 2026-09-05.
 *
 * Season arithmetic behind the cost tables (28 days, 15-minute windows):
 *   sharp 65% at 8 calls/day  ≈ 146 correct calls ≈ 73 coins if half are Up
 *   casual 55% at 4 calls/day ≈  62 correct calls ≈ 31 coins
 * Season simulation over five seeds then set the tables (see `sim/run.ts`):
 * Wheat T1→T5 with all equipment = 36 coins, the T4 path = 16 coins. At those numbers
 * the casual player lands on T4 and the sharp player finishes T5 with every tool.
 * First build (T1→T2) costs 1 coin and 1 window: one correct Up call at a 0.5 entry.
 */
export const LOCKED_RULES: Rules = {
  ...SPEC_RULES,
  voidReward: 0,
  expiryRounds: 672,            // one week
  templates: {
    wheat:      { cost: 0,  multiplier: 1.0, unlockAfter: null },
    orchard:    { cost: 15, multiplier: 1.4, unlockAfter: "wheat" },
    vineyard:   { cost: 40, multiplier: 1.8, unlockAfter: "orchard" },
    greenhouse: { cost: 90, multiplier: 2.5, unlockAfter: "vineyard" },
  },
  upgrades: [
    { from: 1, cost: 1,  windows: 1 },
    { from: 2, cost: 3,  windows: 12 },
    { from: 3, cost: 6,  windows: 32 },
    { from: 4, cost: 12, windows: 96 },
  ],
  equipment: {
    irrigation: { cost: 2, unlocksTier: 3 },
    harvester:  { cost: 4, unlocksTier: 4 },
    shed:       { cost: 8, unlocksTier: 5 },
  },

  oneDirectionPerMarket: true,  // keyed by marketId; BTC Up + ETH Down in one window is allowed
  maxEntryPrice: null,          // never reject a late order
  riskScaledReward: true,       // 0.5 entry pays 1, 0.2 pays 1.6, 0.9 pays 0.2
  riskBaselinePrice: 0.5,
  maxRewardMultiplier: 2,
  minRewardUnits: 0.1,          // a correct call is never worth nothing visible, and never rewards sniping
  timeAutoApplies: true,
  timeBanks: true,
  voidRefundsCall: true,
};

/**
 * Reward units for a correct call entered at `entryPrice` (probability of the
 * chosen side), never less than `minRewardUnits`.
 *
 * The floor applies only to a call that was actually right. A wrong call pays
 * nothing and never reaches here, and a voided round pays `voidReward`.
 */
export function rewardUnits(rules: Rules, entryPrice: number): number {
  if (!rules.riskScaledReward) return rules.rewardPerCall;
  const scaled = rules.rewardPerCall * Math.min(rules.maxRewardMultiplier, (1 - entryPrice) / rules.riskBaselinePrice);
  return Math.max(rules.minRewardUnits, scaled);
}

export function upgradeFrom(rules: Rules, tier: number): UpgradeDef | undefined {
  return rules.upgrades.find((u) => u.from === tier);
}

export function dayOf(rules: Rules, windowId: number): number {
  return Math.floor(windowId / rules.windowsPerDay);
}
