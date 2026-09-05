import type { Rules } from "./rules.ts";
import type { GameState, Player } from "./types.ts";

/** Spec: farm value = sum over farms of (tier x template multiplier x prestige multiplier). */
export function farmValue(rules: Rules, p: Player): number {
  return p.farms.reduce((n, f) => n + f.tier * rules.templates[f.template].multiplier * p.prestige, 0);
}

export function hitRate(p: Player): number {
  const decided = p.stats.callsCorrect + p.stats.callsWrong;
  return decided === 0 ? 0 : p.stats.callsCorrect / decided;
}

export interface LeaderboardRow {
  playerId: string;
  farmValue: number;
  hitRate: number;
  callsPlaced: number;
}

/** Ranked by farm value, then hit rate, then fewer calls (efficiency) as tiebreakers. */
export function leaderboard(rules: Rules, state: GameState): LeaderboardRow[] {
  return Object.values(state.players)
    .map((p) => ({ playerId: p.id, farmValue: farmValue(rules, p), hitRate: hitRate(p), callsPlaced: p.stats.callsPlaced }))
    .sort((a, b) => b.farmValue - a.farmValue || b.hitRate - a.hitRate || a.callsPlaced - b.callsPlaced);
}
