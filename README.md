# Harvest Call

**Play it: <https://harvest-call.vercel.app>**
(Somnia Shannon testnet — you will need a browser wallet and free test funds;
see [Wallet and test funds](#wallet-and-test-funds).)

A farm game where the crops grow because you read the market correctly.

Eight times a day you pick Bitcoin or Ethereum and say **Up** or **Down**. Call it
right and your farm gets paid. Call it wrong and it does not. Every one of those
calls is a real order on a real dreamDEX Event Contract, settled on the Somnia
Shannon testnet — but the player never sees a market, an order book, an order
type, or a price. They see a field, two signs, and a countdown.

---

## What this is trying to prove

Not "a farm game with trading in it". The claim is narrower and more useful:

> **A farm is a viable interface for Event Contracts.**

Prediction markets ask people to learn an order book before they can express an
opinion they already have. Most people have the opinion and never get past the
interface. Harvest Call removes the interface entirely and keeps the instrument:
you say which way you think it goes, and the consequence is a crop.

The one place the chain is allowed to surface is the settlement receipt — a
small link proving the call was a genuine on-chain contract. That link is the
whole reveal, and it is what separates this from a game with a price feed
bolted on.

### Why it might matter beyond the game

Event Contracts are a good instrument with a narrow audience, and the narrowness
is a presentation problem rather than a product one. Two properties here are the
interesting part:

- **The stake is fixed and invisible.** Every call is exactly 1 tUSDC. Progress
  depends on being right, never on having more money, so a large wallet cannot
  buy a bigger farm. That is a fairness claim a normal exchange interface cannot
  make.
- **The reward is scaled by risk, not by size.** Calling a round that is already
  decided is worth almost nothing. Reading a genuinely open round is worth up to
  twice the baseline. The game teaches the instrument's actual skill without
  naming a single one of its mechanics.

---

## The loop

| You do | The chain does | The farm does |
|---|---|---|
| Pick an asset and a direction | A `BUY_YES` (Up) or `BUY_NO` (Down) market order at a fixed 1 tUSDC stake | Nothing yet — the call is pending |
| Wait for the round | Settles on chain, Up or Down | The settlement overlay opens |
| — | Winning positions are redeemed back to your wallet | **Up pays Coins. Down pays Time.** |
| Spend | — | Coins buy upgrades and equipment; Time makes builds finish sooner |

Coins and Time never convert into each other, which is the dilemma the game runs
on: the upgrade you want costs Coins, but the build already running would finish
sooner with Time, and one call cannot be both.

**Rounds are short.** One-minute, five-minute and fifteen-minute rounds are all
supported and all verified end to end, so a call placed during a demo settles
while you are still watching.

---

## Architecture

Three npm workspaces, deliberately kept apart.

```
engine/   Pure rules. A reducer: reduce(rules, state, event) => state.
          Zero runtime dependencies. The chain never enters it.
app/      Vite + React. src/chain is the adapter, src/game is the seam,
          src/ui is screens. No game logic lives in a component.
spike/    Headless Node scripts that prove the chain path against testnet.
```

The separation is the point, and it is enforced rather than merely intended:

- **`engine/`** knows nothing about wallets, markets or React. It is validated by
  34 unit tests and a 28-day season simulation with a calibration gate, so a
  change to a reward number is checked against a whole season before it ships.
  Every tunable number lives in `engine/src/rules.ts`.
- **`app/src/chain/`** turns on-chain facts into exactly two engine events,
  `CALL_PLACED` and `CALL_SETTLED`. Nothing else crosses the boundary.
- **`app/src/game/`** owns the timers, the event log and the derived view.
  Game state is never stored — the event log is replayed through the engine on
  every load, so the rules are the only thing that decides what is true.

### What actually runs on chain

| On chain | Off chain |
|---|---|
| Round discovery and market status | The farm, its tiers and its builds |
| The order that places a call | Coins, Time and the daily call cap |
| Settlement and the winning outcome | The event log (browser `localStorage`) |
| Redemption of winning positions | Leaderboard scoring |

Coins and Time are game currency and have no on-chain existence. The collateral
is real, moves through the player's own wallet, and comes back on a win.

---

## Running it

Node 22.18 or newer. The app needs a browser wallet; the scripts need a key.

```bash
npm install
npm run dev -w app        # http://localhost:5173
```

Other commands:

```bash
npm test -w engine        # 34 rules tests
npm test -w app           # 73 adapter, store, view and queue tests
npm run typecheck -w app
npm run build -w app
npm run sim -w engine     # season simulation + calibration gate
```

### Configuration

Nothing needs configuring to run against Shannon testnet — the defaults are the
public endpoints published in the `@somnia-chain/markets-sdk` README and
pre-filled by the dreamDEX Event Contracts starter template. `.env.example`
documents every value.

| Variable | Used by | Purpose |
|---|---|---|
| `PRIVATE_KEY` | `spike/` only | Signs the headless scripts. The app never sees a key — it signs through the player's wallet. |
| `RPC_URL`, `WS_RPC_URL` | `spike/` | Somnia Shannon endpoints. |
| `INDEXER_URL` | `spike/` | GraphQL indexer. The SDK requires one at construction even though every read and write here is on chain. |
| `VITE_WS_RPC_URL`, `VITE_INDEXER_URL` | `app/` | The same two for the browser build. Vite only exposes names beginning with `VITE_`, and reads them at build time. |

Set the endpoint variables only to point at another network or your own indexer;
leaving them unset uses the public testnet defaults.

### Wallet and test funds

The game runs on **Somnia Shannon testnet**. Nothing here is real money.

1. Install a browser wallet (MetaMask or similar).
2. Open the app and press **Connect wallet**. It will offer to add and switch to
   Shannon for you.
3. Get free **STT** for gas at [testnet.somnia.network](https://testnet.somnia.network).
4. Press **Get test funds** in the app for **tUSDC**, the collateral each call is
   staked in.

Both are needed: STT pays for the transaction, tUSDC is what the call is made
with.

> **Without a wallet you will only see the title screen.** Everything past it
> needs an address to attach a game to, because the event log is stored per
> wallet. This is a deliberate limit, not a bug — but it does mean the app
> cannot be evaluated without completing the two steps above.

### The headless scripts

`spike/` proves the chain path without a browser. It signs with a private key
from a gitignored `.env`, so it is testnet-only and should never be pointed at a
key that matters.

```bash
cd spike
node --env-file=../.env src/combo.ts              # which rounds are live
node --env-file=../.env src/combo.ts --verify     # direction proof, no orders
node --env-file=../.env src/combo.ts --place --watch   # places real calls
```

`spike/RESULTS.md` is the run log: transaction hashes, settlement timings, and
the SDK behaviours worth knowing before building on it.

---

## The rules, and why they are what they are

Locked, tuned against a simulated season, and all in one file.

- **8 calls per day**, resetting at UTC midnight. Scarcity is what makes a call a
  decision rather than a click.
- **1 tUSDC per call**, fixed and never shown. This is the stake-independence
  claim; breaking it breaks the product.
- **Reward = `max(0.1, min(2, (1 − entry) / 0.5))`** units of the currency the
  direction earns. A coin-flip round pays 1. A round that is nearly decided pays
  the 0.1 floor, and the game says so before you spend a call on it. The floor
  exists so that being right is always visibly worth something; it sits exactly
  where the curve already was at a sniper's entry, so it rewards no one for
  waiting.
- **Up and Down on the same round is refused**, which would otherwise be a
  guaranteed win. Bitcoin Up alongside Ethereum Down is allowed, and is the
  point.
- **Coins expire** after a week of game windows. Time banks and never expires.
- **A voided round pays nothing and gives the call back**, credited to the day it
  was placed rather than the day it settled.

---

## Testing and verification

Three layers, because they answer different questions: the tests say the rules
do what they say, the simulation says the numbers make a playable season, and
the on-chain runs say the whole thing works against a real venue.

### Automated

| | |
|---|---|
| `npm test -w engine` | **34 passing** — rules, rewards, expiry, the hedge and sniper exploits, the reward floor, the resolved-market guard |
| `npm test -w app` | **73 passing** — 30 chain-adapter tests against a fake exchange, 43 store, view, loop and redemption-queue tests |
| `npm run typecheck` in each workspace | clean across `engine`, `app` and `spike` |
| `npm run build -w app` | clean production build |

No mocking framework and no test runner dependency: `node:test` throughout, and
the adapter tests drive a hand-written fake exchange, so the suite runs on a
clean checkout with nothing installed beyond the app's own dependencies.

### The season simulation

`npm run sim -w engine` plays **28 days of 15-minute windows** — 2,688 windows,
each carrying a Bitcoin and an Ethereum round, so 5,376 rounds in all — for
seven player archetypes, then checks the result against a calibration gate. It exists so a change to a reward number is measured against
a whole season rather than argued about.

The archetypes include two written specifically to break the rules rather than
play them: a **hedger** that calls Up and Down on the same market, and a
**sniper** that only calls rounds already decided. Both are meant to fail, and
the gate would notice if a tuning change made either profitable.

Measured across ten seeds:

| Check | Result |
|---|---|
| A casual player (55%, 4 calls/day) reaches Wheat Tier 4 | passes on **10 of 10** |
| A sharp player (65%, 8 calls/day) finishes Tier 5 | passes on **10 of 10** |
| A sharp player owns all three pieces of equipment | passes on **10 of 10** |
| A casual player loses under 15% of earned coins to expiry | passes on **6 of 10**, otherwise 18–24% |

Progression is solid on every seed tested. The fourth check is an efficiency
measure rather than a progression one — it counts surplus coins left over at the
end of a season with nothing cheap enough left to buy — and its threshold is
tuned finer than the simulation reliably supports. It is reported here rather
than quietly widened.

The reward floor was sized against this simulation. A floor of 0.25 units lifted
the sniper a full tier on every seed, level with a player who actually reads the
market; 0.1 leaves it bit-for-bit unchanged, because 0.1 is what the risk curve
already pays at a sniper's entry. That is why the number is 0.1.

### Against the live chain

`spike/` runs the whole path headlessly against Somnia Shannon, with no browser
involved. `spike/RESULTS.md` carries the run log and every transaction hash.

**All three demo round lengths, end to end.**
`node --env-file=../.env src/combo.ts --place --watch` discovers the 1-, 5- and
15-minute rounds, places one real call on each with the direction and asset
alternating, follows every one to settlement and redeems the winners. Two runs:
**six calls, six settlements, three redemptions, no retries and no voids.**

| Round | Asset | Call | Mode | Entry | Result |
|---|---|---|---|---|---|
| 1 min | BTC | Up | fixed | 0.718 | won, redeemed |
| 5 min | BTC | Down | reference | 0.434 | lost |
| 15 min | BTC | Up | reference | 0.968 | won, redeemed |
| 1 min | BTC | Up | fixed | 0.021 | lost |
| 5 min | ETH | Down | reference | 0.608 | lost |
| 15 min | BTC | Up | reference | 0.383 | won, redeemed |

**That one-minute rounds are genuine direction calls.**
They are `fixed` mode, which asks whether the price ended at or above a strike —
the same question as "did it go up" only if that strike is the price at the
round's open. Nothing publishes the price a round settled at, so this could not
be read off directly. But rounds are contiguous, each one's trading start being
the previous one's expiry, so the *next* round's strike is this round's
settlement price. Comparing the two against each round's winning outcome across
live BTC and ETH rounds: **86 of 86 consecutive pairs agree.** A single
disagreement would have sunk the reading. `src/combo.ts --verify` re-runs that
check and places no orders.

### Not verified

**The void path.** A voided round pays nothing and refunds the call, and that is
implemented and unit tested — but no voided round appeared on testnet across the
whole build, so it has never executed against a real one. It is tested code
rather than proven behaviour, and is described that way deliberately.

---

## Layout

```
engine/src/rules.ts     every tunable number, and the reasoning for each
engine/src/engine.ts    the reducer
engine/sim/run.ts       season simulation and the calibration gate
app/src/chain/          the adapter: discovery, placement, settlement, redemption
app/src/game/           event log, derived view, timers, the useGame() seam
app/src/ui/             five screens over one isometric world
spike/src/combo.ts      places and settles a call on each round length
spike/RESULTS.md        run log and SDK findings
```
