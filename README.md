# Harvest Call

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
  33 unit tests and a 28-day season simulation with a calibration gate, so a
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
npm test -w engine        # 33 rules tests
npm test -w app           # 69 adapter, store and view tests
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

## Known limits

Stated plainly, because a demo that hides these is worth less than one that does
not.

- **The void path is unverified in the wild.** It is implemented and unit
  tested, but no voided round has appeared on testnet across the whole build, so
  it has never executed against a real one. Treat it as tested code, not as
  proven behaviour.
- **The event log is local and unsigned.** Every entry in it originates from a
  chain fact — a fill, a settlement — but the log itself lives in the browser
  and a determined player can edit it. Progression and the board both read from
  it, so they are honest for solo play and are **not** a trustworthy basis for
  competition. A competitive version would have to derive progression from chain
  data directly rather than from a local record of it.
- **Two tabs on the same wallet converge rather than merge.** They follow each
  other's writes now instead of silently overwriting, but two calls placed in
  the same instant can still lose one: the log is last-write-wins, and merging
  divergent branches would need an identity on every event. The losing call is
  refused by the chain in any case.
- **The calibration gate is tuned finer than it reliably holds.** Across ten
  seeds all three progression checks pass every time — a casual player reaches
  Tier 4, a sharp one finishes Tier 5 with every tool. The fourth, that a casual
  player loses under 15% of earned coins to expiry, fails on four of those ten
  at 18-24%. That loss is surplus at the end of a season with nothing cheap
  enough left to buy, so it costs efficiency rather than progression — but the
  threshold is calibrated finer than the simulation actually supports.
- **Order-book depth on testnet is thin** — a handful of levels. The fixed
  1 tUSDC stake fills reliably today, but the app handles an unfillable quote by
  declining the call rather than pretending.

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
