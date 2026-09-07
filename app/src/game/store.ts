// The game state lives nowhere but here, and it is never written directly.
//
// What is persisted is the EVENT LOG, not the state. Every state the player can
// see is the result of replaying that log through the engine's reducer, so a
// rules change reshapes history correctly on the next load and a bug can never
// leave a state the rules would forbid.
//
// One log per wallet address. Switching wallets switches games.

import { LOCKED_RULES, applySafe, initialState, type Event, type GameState, type RuleViolation } from "farm-engine";
import { currentWindowId } from "../chain/clock.ts";

const VERSION = 1;
const KEY_PREFIX = `farm:v${VERSION}:`;

/** A log longer than this is a bug or a very long season; either way, stop growing. */
const MAX_EVENTS = 20_000;

export const RULES = LOCKED_RULES;

export function playerIdFor(address: string): string {
  return address.toLowerCase();
}

function keyFor(address: string): string {
  return KEY_PREFIX + playerIdFor(address);
}

function readLog(address: string): Event[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(keyFor(address));
  } catch {
    return []; // storage blocked; the session simply does not persist
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    for (const ev of parsed) {
      if (!ev || typeof ev !== "object" || typeof (ev as Event).type !== "string") {
        throw new Error("not an event");
      }
    }
    return parsed as Event[];
  } catch (e) {
    // A corrupt log is not recoverable and must not take the app down with it.
    console.warn("[farm] saved game was unreadable, starting fresh:", e);
    try {
      window.localStorage.removeItem(keyFor(address));
    } catch {
      // nothing more to do
    }
    return [];
  }
}

function writeLog(address: string, log: Event[]): void {
  try {
    window.localStorage.setItem(keyFor(address), JSON.stringify(log));
  } catch (e) {
    console.warn("[farm] could not save:", e);
  }
}

/**
 * Replay a log into a state.
 *
 * `applySafe` rather than `reduce`: an event the rules once accepted may be
 * rejected after a rules change, and that must skip the event rather than throw
 * away the whole save.
 */
function replay(log: Event[]): GameState {
  let state = initialState(0);
  for (const ev of log) {
    state = applySafe(RULES, state, ev).state;
  }
  return state;
}

export interface Store {
  readonly playerId: string;
  getState(): GameState;
  /** Apply an event. Returns the violation if the rules refused it; nothing is saved then. */
  dispatch(ev: Event): RuleViolation | null;
  subscribe(fn: () => void): () => void;
  /** Throw the save away. Only the player asks for this. */
  reset(): void;
}

export function createStore(address: string): Store {
  const playerId = playerIdFor(address);
  let log = readLog(address);
  let state = replay(log);
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  // A fresh save starts at the current window so the first tick is not a leap
  // from zero, then joins the player.
  if (!state.players[playerId]) {
    const opening: Event[] = [
      { type: "WINDOW_TICK", windowId: currentWindowId() },
      { type: "PLAYER_JOIN", playerId },
    ];
    for (const ev of opening) {
      const out = applySafe(RULES, state, ev);
      state = out.state;
      if (!out.error) log.push(ev);
    }
    writeLog(address, log);
  }

  return {
    playerId,
    getState: () => state,
    dispatch(ev: Event) {
      const out = applySafe(RULES, state, ev);
      state = out.state;
      if (out.error) {
        // Rejections are already counted in the player's stats by applySafe.
        notify();
        return out.error;
      }
      log.push(ev);
      if (log.length > MAX_EVENTS) log = log.slice(-MAX_EVENTS);
      writeLog(address, log);
      notify();
      return null;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reset() {
      try {
        window.localStorage.removeItem(keyFor(address));
      } catch {
        // already gone
      }
      log = [];
      state = replay(log);
      notify();
    },
  };
}
