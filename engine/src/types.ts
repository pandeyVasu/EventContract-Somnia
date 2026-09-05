import type { Direction, EquipmentId, MarketResult, Resource, TemplateId } from "./rules.ts";

export interface ResourceLot {
  kind: Resource;
  amount: number;
  earnedAtWindow: number;
  expiresAfterWindow: number; // usable while windowId <= this
}

export interface Build {
  targetTier: number;
  remainingWindows: number;
  startedAtWindow: number;
}

export interface Farm {
  id: string;
  template: TemplateId;
  tier: number;
  equipment: EquipmentId[];
  build: Build | null;
}

export interface Call {
  id: string;
  marketId: string;
  asset: string;
  windowId: number;     // window the market belongs to
  direction: Direction;
  entryPrice: number;   // probability of the chosen side at entry, (0,1)
  placedAtWindow: number;
  result: MarketResult | null;
}

export interface PlayerStats {
  callsPlaced: number;
  callsCorrect: number;
  callsWrong: number;
  callsVoid: number;
  coinsEarned: number;
  timeEarned: number;
  coinsSpent: number;
  timeApplied: number;
  coinsExpired: number;
  timeLost: number;      // time earned with no running build to apply to
  rejected: Record<string, number>; // reason -> count
}

export interface Player {
  id: string;
  farms: Farm[];
  lots: ResourceLot[];
  calls: Call[];
  callsByDay: Record<number, number>;
  prestige: number;
  stats: PlayerStats;
}

export interface GameState {
  windowId: number;
  players: Record<string, Player>;
}

export type Event =
  | { type: "PLAYER_JOIN"; playerId: string }
  | { type: "WINDOW_TICK"; windowId: number }
  | {
      type: "CALL_PLACED";
      playerId: string;
      callId: string;
      marketId: string;
      asset: string;
      windowId: number;
      direction: Direction;
      entryPrice: number;
    }
  | { type: "CALL_SETTLED"; marketId: string; result: MarketResult; settledAtWindow: number }
  | { type: "BUY_EQUIPMENT"; playerId: string; farmId: string; item: EquipmentId }
  | { type: "START_UPGRADE"; playerId: string; farmId: string }
  | { type: "BUY_TEMPLATE"; playerId: string; template: TemplateId };

export class RuleViolation extends Error {
  readonly reason: string;
  constructor(reason: string, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.reason = reason;
  }
}
