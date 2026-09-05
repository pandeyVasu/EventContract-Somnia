import { dayOf, rewardUnits, upgradeFrom, type Rules, type Resource } from "./rules.ts";
import { RuleViolation, type Event, type Farm, type GameState, type Player, type PlayerStats } from "./types.ts";

// A pure reducer: (state, event) -> new state. Never mutates its input.
// Throws RuleViolation for a player action the rules forbid; the caller decides
// whether that is a UI error or a logged rejection (see `applySafe`).

export function initialState(windowId = 0): GameState {
  return { windowId, players: {} };
}

function emptyStats(): PlayerStats {
  return {
    callsPlaced: 0, callsCorrect: 0, callsWrong: 0, callsVoid: 0,
    coinsEarned: 0, timeEarned: 0, coinsSpent: 0, timeApplied: 0,
    coinsExpired: 0, timeLost: 0, rejected: {},
  };
}

function newPlayer(id: string): Player {
  return {
    id,
    farms: [{ id: `${id}:wheat`, template: "wheat", tier: 1, equipment: [], build: null }],
    lots: [],
    calls: [],
    callsByDay: {},
    timeBank: 0,
    prestige: 1,
    stats: emptyStats(),
  };
}

function getPlayer(state: GameState, id: string): Player {
  const p = state.players[id];
  if (!p) throw new RuleViolation("NO_PLAYER", id);
  return p;
}

function getFarm(p: Player, farmId: string): Farm {
  const f = p.farms.find((x) => x.id === farmId);
  if (!f) throw new RuleViolation("NO_FARM", farmId);
  return f;
}

export function available(p: Player, kind: Resource, windowId: number): number {
  return p.lots
    .filter((l) => l.kind === kind && l.expiresAfterWindow >= windowId)
    .reduce((n, l) => n + l.amount, 0);
}

function tierCap(rules: Rules, farm: Farm): number {
  let cap = rules.baseTierCap;
  for (const e of farm.equipment) cap = Math.max(cap, rules.equipment[e].unlocksTier);
  return Math.min(cap, rules.maxTier);
}

/** Consume `amount` of a resource, oldest lots first. Throws if short. */
function spend(p: Player, kind: Resource, amount: number, windowId: number): void {
  if (available(p, kind, windowId) < amount) {
    throw new RuleViolation("INSUFFICIENT", `${kind} need ${amount}, have ${available(p, kind, windowId)}`);
  }
  let left = amount;
  const lots = [...p.lots].sort((a, b) => a.earnedAtWindow - b.earnedAtWindow);
  for (const l of lots) {
    if (left <= 0) break;
    if (l.kind !== kind || l.expiresAfterWindow < windowId) continue;
    const take = Math.min(l.amount, left);
    l.amount -= take;
    left -= take;
  }
  p.lots = lots.filter((l) => l.amount > 0);
  if (kind === "coins") p.stats.coinsSpent += amount;
}

/** Push Time into the first running build. The remainder banks (rules.timeBanks) or is lost (spec). */
function applyTime(rules: Rules, p: Player, units: number): void {
  let left = units;
  for (const f of p.farms) {
    if (left <= 0) break;
    if (!f.build) continue;
    const use = Math.min(left, f.build.remainingWindows);
    f.build.remainingWindows -= use;
    p.stats.timeApplied += use;
    left -= use;
  }
  if (rules.timeBanks) p.timeBank += left;
  else p.stats.timeLost += left;
}

function completeFinishedBuilds(p: Player): void {
  for (const f of p.farms) {
    if (f.build && f.build.remainingWindows <= 0) {
      f.tier = f.build.targetTier;
      f.build = null;
    }
  }
}

export function reduce(rules: Rules, prev: GameState, ev: Event): GameState {
  const state = structuredClone(prev);

  switch (ev.type) {
    case "PLAYER_JOIN": {
      if (state.players[ev.playerId]) throw new RuleViolation("DUPLICATE_PLAYER", ev.playerId);
      state.players[ev.playerId] = newPlayer(ev.playerId);
      return state;
    }

    case "WINDOW_TICK": {
      if (ev.windowId < state.windowId) throw new RuleViolation("TIME_BACKWARDS");
      const steps = ev.windowId - state.windowId;
      state.windowId = ev.windowId;
      for (const p of Object.values(state.players)) {
        for (const f of p.farms) {
          if (f.build) f.build.remainingWindows = Math.max(0, f.build.remainingWindows - steps);
        }
        completeFinishedBuilds(p);
        const keep = [];
        for (const l of p.lots) {
          if (l.expiresAfterWindow >= ev.windowId) keep.push(l);
          else if (l.kind === "coins") p.stats.coinsExpired += l.amount;
          else p.stats.timeLost += l.amount;
        }
        p.lots = keep;
      }
      return state;
    }

    case "CALL_PLACED": {
      const p = getPlayer(state, ev.playerId);
      if (!(ev.entryPrice > 0 && ev.entryPrice < 1)) throw new RuleViolation("BAD_PRICE", String(ev.entryPrice));
      if (p.calls.some((c) => c.id === ev.callId)) throw new RuleViolation("DUPLICATE_CALL", ev.callId);
      const day = dayOf(rules, state.windowId);
      const used = p.callsByDay[day] ?? 0;
      if (used >= rules.dailyCallCap) throw new RuleViolation("DAILY_CAP", `${used}/${rules.dailyCallCap}`);
      if (rules.maxEntryPrice !== null && ev.entryPrice > rules.maxEntryPrice) {
        throw new RuleViolation("ENTRY_TOO_LATE", `price ${ev.entryPrice} > ${rules.maxEntryPrice}`);
      }
      const same = p.calls.filter((c) => c.marketId === ev.marketId && c.result === null);
      if (rules.oneDirectionPerMarket && same.some((c) => c.direction !== ev.direction)) {
        throw new RuleViolation("HEDGE", `already ${same[0]!.direction} on ${ev.marketId}`);
      }
      if (same.some((c) => c.direction === ev.direction)) {
        throw new RuleViolation("DUPLICATE_DIRECTION", `already ${ev.direction} on ${ev.marketId}`);
      }
      p.callsByDay[day] = used + 1;
      p.stats.callsPlaced++;
      p.calls.push({
        id: ev.callId, marketId: ev.marketId, asset: ev.asset, windowId: ev.windowId,
        direction: ev.direction, entryPrice: ev.entryPrice, placedAtWindow: state.windowId, result: null,
      });
      return state;
    }

    case "CALL_SETTLED": {
      const expires = ev.settledAtWindow + rules.expiryRounds;
      for (const p of Object.values(state.players)) {
        for (const c of p.calls) {
          if (c.marketId !== ev.marketId || c.result !== null) continue;
          c.result = ev.result;
          const award = (kind: Resource, amount: number) => {
            if (amount <= 0) return;
            if (kind === "coins") {
              p.stats.coinsEarned += amount;
              p.lots.push({ kind, amount, earnedAtWindow: ev.settledAtWindow, expiresAfterWindow: expires });
            } else {
              p.stats.timeEarned += amount;
              if (rules.timeAutoApplies) applyTime(rules, p, amount);
              else p.lots.push({ kind, amount, earnedAtWindow: ev.settledAtWindow, expiresAfterWindow: expires });
            }
          };
          if (ev.result === "void") {
            p.stats.callsVoid++;
            award("coins", rules.voidReward);
            award("time", rules.voidReward);
            if (rules.voidRefundsCall) {
              // Refund the slot on the day the call was PLACED, not the settlement day.
              const day = dayOf(rules, c.placedAtWindow);
              p.callsByDay[day] = Math.max(0, (p.callsByDay[day] ?? 0) - 1);
            }
          } else if (ev.result === c.direction) {
            p.stats.callsCorrect++;
            award(rules.resourceFor[c.direction], rewardUnits(rules, c.entryPrice));
          } else {
            p.stats.callsWrong++;
          }
        }
        completeFinishedBuilds(p);
      }
      return state;
    }

    case "BUY_EQUIPMENT": {
      const p = getPlayer(state, ev.playerId);
      const f = getFarm(p, ev.farmId);
      if (f.equipment.includes(ev.item)) throw new RuleViolation("ALREADY_OWNED", ev.item);
      const def = rules.equipment[ev.item];
      // Equipment unlocks in tier order: cannot own the shed without the harvester.
      const needsCap = def.unlocksTier - 1;
      if (tierCap(rules, f) < needsCap) throw new RuleViolation("EQUIPMENT_ORDER", `${ev.item} needs cap ${needsCap}`);
      spend(p, "coins", def.cost, state.windowId);
      f.equipment.push(ev.item);
      return state;
    }

    case "START_UPGRADE": {
      const p = getPlayer(state, ev.playerId);
      const f = getFarm(p, ev.farmId);
      if (f.build) throw new RuleViolation("ALREADY_BUILDING", ev.farmId);
      if (f.tier >= rules.maxTier) throw new RuleViolation("MAX_TIER");
      if (f.tier + 1 > tierCap(rules, f)) throw new RuleViolation("TIER_CAP", `cap ${tierCap(rules, f)}`);
      const up = upgradeFrom(rules, f.tier);
      if (!up) throw new RuleViolation("NO_UPGRADE", `from tier ${f.tier}`);
      spend(p, "coins", up.cost, state.windowId);
      f.build = { targetTier: f.tier + 1, remainingWindows: up.windows, startedAtWindow: state.windowId };
      if (rules.timeBanks && p.timeBank > 0) {
        // Drain the bank into the new build, keep any remainder, finish now if fully covered.
        const drain = Math.min(p.timeBank, f.build.remainingWindows);
        f.build.remainingWindows -= drain;
        p.timeBank -= drain;
        p.stats.timeApplied += drain;
      }
      completeFinishedBuilds(p);
      return state;
    }

    case "BUY_TEMPLATE": {
      const p = getPlayer(state, ev.playerId);
      const def = rules.templates[ev.template];
      if (p.farms.some((f) => f.template === ev.template)) throw new RuleViolation("ALREADY_OWNED", ev.template);
      if (def.unlockAfter && !p.farms.some((f) => f.template === def.unlockAfter)) {
        throw new RuleViolation("TEMPLATE_ORDER", `${ev.template} needs ${def.unlockAfter}`);
      }
      spend(p, "coins", def.cost, state.windowId);
      p.farms.push({ id: `${p.id}:${ev.template}`, template: ev.template, tier: 1, equipment: [], build: null });
      return state;
    }
  }
}

/** Like `reduce`, but a RuleViolation is recorded in the player's stats instead of thrown. */
export function applySafe(rules: Rules, state: GameState, ev: Event): { state: GameState; error: RuleViolation | null } {
  try {
    return { state: reduce(rules, state, ev), error: null };
  } catch (e) {
    if (!(e instanceof RuleViolation)) throw e;
    const pid = "playerId" in ev ? ev.playerId : null;
    if (pid && state.players[pid]) {
      const next = structuredClone(state);
      const r = next.players[pid]!.stats.rejected;
      r[e.reason] = (r[e.reason] ?? 0) + 1;
      return { state: next, error: e };
    }
    return { state, error: e };
  }
}
