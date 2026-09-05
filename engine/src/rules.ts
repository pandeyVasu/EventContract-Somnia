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
  /** Time units auto-apply to the farm's running build on settlement; if none, they are lost. */
  timeAutoApplies: boolean;
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
  timeAutoApplies: true,
};

/** Spec plus the three fixes proposed in the feasibility review. */
export const FIXED_RULES: Rules = {
  ...SPEC_RULES,
  oneDirectionPerMarket: true,
  maxEntryPrice: 0.65,
};

export function upgradeFrom(rules: Rules, tier: number): UpgradeDef | undefined {
  return rules.upgrades.find((u) => u.from === tier);
}

export function dayOf(rules: Rules, windowId: number): number {
  return Math.floor(windowId / rules.windowsPerDay);
}
