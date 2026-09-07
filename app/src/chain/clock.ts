// Two clocks meet here.
//
// The GAME runs on 15-minute windows. Every rule the engine owns — the daily call
// cap, coin expiry, build times — counts in those windows, and the season was
// calibrated against them.
//
// The MARKET runs on whatever window lengths dreamDEX actually lists. On testnet
// today the shortest Up/Down market is an hour. A call placed in game window W
// therefore rides a market that settles some time after W ends, and the engine is
// told about it when it settles, not when the market's own window closes.
//
// Nothing else in the codebase may divide a timestamp by a window length.

export const GAME_WINDOW_SECONDS = 900;

/** The game window a moment falls in. */
export function windowIdAt(unixSeconds: number): number {
  return Math.floor(unixSeconds / GAME_WINDOW_SECONDS);
}

/** The game window we are in now. */
export function currentWindowId(now: number = Date.now()): number {
  return windowIdAt(Math.floor(now / 1000));
}

/** Seconds until the current game window rolls over. Drives the countdown. */
export function secondsLeftInWindow(now: number = Date.now()): number {
  const seconds = Math.floor(now / 1000);
  return GAME_WINDOW_SECONDS - (seconds % GAME_WINDOW_SECONDS);
}

// A window's day is the engine's arithmetic and stays there: `dayOf(rules, windowId)`.
// A second copy here would be a rule with two homes.
