# farm-engine

Pure, deterministic rules engine for the farm game. No chain, no UI, no
dependencies at runtime. Exists to test the game design before anything is
built on top of it.

```
npm test        # 19 rule tests, node:test, zero deps
npm run sim     # 28-day season, 7 player archetypes, SPEC vs FIXED rules
npm run typecheck
```

Node 22.18+ required (runs `.ts` directly, no build step).

## Shape

```
src/rules.ts    every number from the spec + toggles the spec leaves open
src/types.ts    state, events, RuleViolation
src/engine.ts   reduce(rules, state, event) -> state   (never mutates input)
src/score.ts    farmValue, leaderboard
test/           one test per rule, plus one that pins a contradiction
sim/run.ts      season simulator
```

Events: `PLAYER_JOIN`, `WINDOW_TICK`, `CALL_PLACED`, `CALL_SETTLED`,
`BUY_EQUIPMENT`, `START_UPGRADE`, `BUY_TEMPLATE`. The chain adapter's only job
later is to turn on-chain facts into `CALL_PLACED` and `CALL_SETTLED`.

## What the engine found in the spec

Run `npm run sim` to reproduce. Seeded, so the numbers are stable.

1. **Nobody can ever spend a coin.** Spec: resources expire one round after
   settlement, and the cheapest upgrade costs 20 coins. With 8 calls a day the
   most a player can hold at once is well under 20, even at 100% accuracy.
   Every coin earned in a season expires unspent. Pinned by the test named
   `CONTRADICTION`. Expiry and the cost curve cannot both stand as written.
2. **Even with expiry removed, the curve is 4x too steep.** Wheat T1 to T5
   with equipment costs 850 coins; the four templates cost 730 more. A season
   yields at most 224 units total across both resources. A perfect player with
   season-long expiry ends at Wheat T3. Spec's "built against 123 units" is
   not true of these tables.
3. **Hedge exploit.** Up and Down on the same market costs two calls and
   guarantees one unit. Rule `oneDirectionPerMarket` closes it; sim shows the
   hedger rejected 112 times under FIXED rules.
4. **Late-entry exploit.** Buying at 0.95 with seconds left is a near-certain
   "correct call" for a flat unit. Rule `maxEntryPrice: 0.65` closes it
   (sniper rejected 224 times). `riskScaledReward` is the softer alternative.
5. **Time is mostly lost.** Under spec Time only applies to a running build.
   No build ever starts (see 1), so 100% of Time is lost. Even when builds
   run, short builds cannot absorb a day's Time.

## Knobs to tune before implementation

All in `src/rules.ts`. Candidates, in order of leverage:

- `expiryRounds` — 1 window is unplayable. 1 day still unplayable. A week
  begins to work. Or drop expiry and rely on the daily cap alone.
- `rewardPerCall` and the cost tables — pick one and rescale the other so a
  55% player reaches Wheat T4 in a season and a 65% player finishes it.
- `oneDirectionPerMarket: true` — no reason to leave this off.
- `maxEntryPrice` or `riskScaledReward` — one of them.
