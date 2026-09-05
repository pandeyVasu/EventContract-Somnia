# SDK spike results

What the five scripts in `src/` proved against Somnia Shannon testnet on
2026-09-05, and every surprise worth passing back as SDK feedback.

Wallet `0x87F16035FF5c1aDB1712Dd646353ee9A2CcA8151`. Package
`@somnia-chain/markets-sdk@0.29.0`, `viem@2.56.3`, Node 22.23.2.

## Headline

The whole loop works: discover a live Up/Down market, place a fixed-stake call
on it, watch it settle, redeem the winner. Two calls were placed in the same
window, one Up on BTC and one Down on ETH, which is the moment the demo is
built around.

| Step | Result |
|---|---|
| Faucet | 10,000 tUSDC, one call, no arguments needed |
| Discovery | 12 live markets, 8 of them Up/Down |
| Placement | Both calls filled on the first attempt |
| Settlement | Resolved 2 seconds after the window closed |
| Redemption | See the run log at the bottom |

## The finding that changes the plan

**There are no 15-minute Up/Down markets on testnet.** The plan assumed a
900-second window everywhere. What actually exists:

| Window | Mode | Usable for the game |
|---|---|---|
| 60 s, 300 s | `fixed` | No. Strike-based, not a direction call |
| 3600 s | `reference` | Yes. The shortest one we can use |
| 14400 s, 86400 s, 3888000 s | `reference` | Yes, but too slow for a demo |

The two short windows are a different instrument: `mode: "fixed"` carries a real
strike price, so a player would be betting on a level rather than a direction,
and the interface would have to show them a number. The game trades
`mode: "reference"` only, where the strike is `"0"` and the question is purely
"higher or lower than where it opened".

So the live window is **one hour, not fifteen minutes**. Both assets are
available at every reference window length, so the BTC-Up-plus-ETH-Down beat
survives intact. The engine's window length is a single rule constant, and
nothing in the reducer assumes a particular wall-clock duration.

## Gotchas, in the order they cost time

1. **The SDK never lets the process exit.** It opens a websocket at
   construction, so a script that finishes its work just hangs. Every script
   here ends with a `shutdown` helper that stops the live feed, closes the
   exchange, and force-exits on a short unref'd timer. Without it the first
   faucet run sat there silently after the transaction had already landed.

2. **The order book is split by outcome.** `getBinaryOrderBook` returns
   `yesBids`, `yesAsks`, `noBids` and `noAsks`. There are no plain `bids` and
   `asks` arrays. Reading those returns `undefined`, which looks exactly like a
   market with no liquidity, and the first discovery run reported an empty book
   on a market that had three levels a side.

3. **`quoteBinaryStake` on the client returns `null` unless you are tailing the
   market over the websocket.** It reads the live store, not the chain. The pure
   helper `quoteBinaryStakeOverBook(book, side, stake, oneCollateral, grid)`
   works off a book you fetched yourself, and is what the game uses. The `grid`
   argument is the output of `getBinaryBookParams(pool)`: tick size, lot size,
   minimum quantity.

4. **A fill reports `quantityFilled`, not `quantity`.** Summing `quantity`
   yields zero shares while the transaction plainly filled, which is a silent
   wrong answer rather than an error.

5. **`getErc20Balance` takes positional arguments,** `(token, account)`, while
   most of the client takes an options object. Passing an object gives
   `Address "undefined" is invalid` from deep inside viem.

6. **The market object from the indexer has `poolAddress`, not `pool`.** The
   on-chain read returns `pool`. Both names are live in the same workflow.

7. **`fillPrice` is always the YES price.** Confirmed on a real `BUY_NO`: the
   fill reported 0.636, and the Down entry probability is one minus that,
   0.364. The adapter must invert or every Down call is mispriced.

8. Approval never came up. The first order approved collateral automatically
   and nothing since has needed attention, exactly as the source suggested.

## Numbers worth keeping

- **Settlement lag: 2 seconds** after expiry on both hourly reference markets
  sampled, and 0 seconds on the short fixed ones. A 30-second poll is
  comfortable. The plan budgeted for an unknown here.
- **Liquidity is real but shallow.** Three levels a side, around 200-460 shares
  each. A 1 tUSDC stake filled instantly at one level both times.
- **Entry prices drift well away from 0.5.** The two fills came in at 0.585 and
  0.636 on the YES side. The engine's risk-scaled reward pays 0.83 units for the
  first and 1.27 for the second, so the spread the simulation assumed
  (0.35 to 0.65) is realistic.
- **Finalized listing composition:** of the 200 most recent finalized markets,
  166 were 60-second fixed, 32 were 300-second fixed, and only 2 were hourly
  reference. Filtering by `mode` is not optional.

## Open question still open

**No voided market appeared in any sample.** Two hundred finalized markets, zero
with `isVoided`. The void path in both the engine and the adapter is therefore
written from the documentation and is untested against a real void. The engine
side is covered by unit tests; the chain side is a known risk.

## Transactions

| What | Hash |
|---|---|
| BTC Up, entry 0.585 | `0x4e4c89f132610a963e38b1954ecbc146af934d8e043c54f8fcccd4bbfe4497eb` |
| ETH Down, entry 0.364 | `0x38e0561da3cc3f17dcce73c69492ae9375b5e5124969138d3ce532a1b1eae03e` |

Both on the hour window ending 2026-09-05T16:00:00Z. Explorer:
`https://shannon-explorer.somnia.network`.

## Redemption run

Filled in when `redeem.ts` runs after the window closes.
