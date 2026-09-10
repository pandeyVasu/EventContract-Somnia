// The one seam between the game and everything else.
//
// Components read `view` and call `actions`. They never touch the store, the
// engine, the exchange or a timer. If a component needs to know a rule, the rule
// belongs in the engine and its answer belongs in `buildView`.

import { initialState } from "farm-engine";
import type { EquipmentId, GameState } from "farm-engine";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";

import { currentWindowId } from "../chain/clock.ts";
import { getExchange, releaseExchange } from "../chain/exchange.ts";
import { placeCall } from "../chain/place.ts";
import { failureKind, isTerminal, redeemSettled } from "../chain/redeem.ts";
import { pollSettlements } from "../chain/settle.ts";
import { quoteEntries } from "../chain/place.ts";
import { listLiveWindows, pickWindow } from "../chain/windows.ts";
import type { Direction, Exchange, LiveWindow, Settlement } from "../chain/types.ts";
import { CHAIN } from "../chain/wagmi.ts";
import { SETTLE_POLL_MS, TICK_MS, WINDOWS_POLL_MS, openMarketIds, pendingPairs, redeemablePairs, settlementEvents, tickEvent } from "./loop.ts";
import { due, enqueue, exhausted, loadQueue, readQueue, recordFailure, remove, saveQueue } from "./redeemQueue.ts";
import { RULES, createStore, playerIdFor, type Store } from "./store.ts";
import { buildView, type CallView, type GameView } from "./view.ts";

export interface GameActions {
  connect(): Promise<void>;
  disconnect(): void;
  getTestFunds(): Promise<void>;
  placeCall(asset: string, direction: Direction): Promise<void>;
  startUpgrade(farmId: string): Promise<void>;
  buyEquipment(farmId: string, item: EquipmentId): Promise<void>;
}

export interface Game {
  view: GameView;
  actions: GameActions;
  /** Which action is in flight, by key. Buttons read their own key. */
  pending: string | null;
  /** One plain sentence, or null. Never an error code. */
  message: string | null;
  dismissMessage(): void;
  /** A call that just finished and has not been shown yet. */
  settlement: CallView | null;
  dismissSettlement(): void;
  /** True while the wallet is on some other chain. */
  wrongChain: boolean;
}

const GameContext = createContext<Game | null>(null);

const EMPTY_STORE_STATE: GameState = initialState(0);

function useStoreState(store: Store | null) {
  const subscribe = useCallback((fn: () => void) => (store ? store.subscribe(fn) : () => {}), [store]);
  const snapshot = useCallback(() => (store ? store.getState() : EMPTY_STORE_STATE), [store]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function GameProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, chainId } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [windows, setWindows] = useState<LiveWindow[]>([]);
  const [settlementQueue, setSettlementQueue] = useState<string[]>([]);
  const [entries, setEntries] = useState<Record<string, { up: number | null; down: number | null }>>({});
  /** A redemption round is in flight. Two at once would send the same claim twice. */
  const redeeming = useRef(false);
  const [now, setNow] = useState(() => Date.now());

  // One store per wallet. Switching wallets switches games.
  const store = useMemo(() => (address ? createStore(address) : null), [address]);

  // The store listens for other tabs, so the old one has to be told to stop
  // when the wallet changes or the app unmounts.
  useEffect(() => () => store?.dispose(), [store]);
  const state = useStoreState(store);
  const playerId = address ? playerIdFor(address) : "";

  // The exchange holds a websocket, so it is built once per wallet and closed
  // when the wallet goes away. Leaving it open is what kept every spike script
  // alive after its work was done.
  const walletAddress = walletClient?.account?.address ?? null;

  // Keyed on the ADDRESS, not the wallet client object. wagmi hands back a fresh
  // object for the same account across re-renders, and keying on that closed a
  // live websocket and opened another every time.
  const exchange = useMemo<Exchange | null>(() => {
    if (!walletClient?.account?.address) return null;
    try {
      return getExchange(walletClient as unknown as { account?: { address?: string } });
    } catch (e) {
      console.warn("[farm] could not reach the exchange:", e);
      setMessage("Could not reach the network. Reload the page and connect again.");
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    return () => releaseExchange(walletAddress);
  }, [walletAddress]);

  /**
   * Switching wallets switches games, so nothing from the last one may survive.
   *
   * The settlement queue held market ids, and it was not cleared. After a
   * switch the overlay would look for a call the new player never made, find
   * nothing, and render null — leaving a dead id at the head of the queue that
   * blocked every real settlement behind it. The quoted entries and the
   * in-flight redemption flag belong to the old wallet just as much.
   */
  useEffect(() => {
    setSettlementQueue([]);
    setEntries({});
    redeeming.current = false;
    // A fresh session gets fresh attempts. Anything the last one gave up on —
    // usually a network that was briefly unreachable — is asked for again.
    if (address) saveQueue(address, loadQueue(address));
  }, [address]);

  // --- the clock -----------------------------------------------------------
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (!store) return;
      const ev = tickEvent(store.getState());
      if (ev) store.dispatch(ev);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [store]);

  // --- which markets are tradeable -----------------------------------------
  useEffect(() => {
    if (!exchange) {
      setWindows([]);
      return;
    }
    let alive = true;
    let misses = 0;
    const refresh = async () => {
      try {
        const live = await listLiveWindows(exchange.client);
        if (!alive) return;
        misses = 0;
        setWindows(live);

        // What each round would cost to call, so the game can warn about one
        // that is already decided. Never shown as a price. A book that will not
        // quote is not worth a word to the player, so a failure here is silent
        // and simply leaves the round unannotated.
        const quoted: Record<string, { up: number | null; down: number | null }> = {};
        for (const w of live) {
          try {
            quoted[w.marketId] = await quoteEntries(exchange, w);
          } catch {
            // no opinion on this round
          }
        }
        if (alive) setEntries(quoted);
      } catch (e) {
        console.warn("[farm] could not read open rounds:", e);
        // One failure is a hiccup. Three in a row is the player staring at an
        // empty screen with no idea the app, not the market, is the problem.
        if (alive && ++misses === 3) setMessage("Cannot reach the network right now. Rounds will come back on their own.");
      }
    };
    void refresh();
    const id = window.setInterval(refresh, WINDOWS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [exchange]);

  // --- settlement, then redemption -----------------------------------------
  useEffect(() => {
    if (!exchange || !store) return;
    let alive = true;
    let settleMisses = 0;
    let inFlight = false;

    const check = async () => {
      // A slow poll must not overlap the next one. The engine ignores a repeated
      // settlement, but a duplicate would still show the overlay twice.
      if (inFlight) return;
      inFlight = true;
      try {
        const open = openMarketIds(store.getState(), playerId);
        if (open.length) await runCheck(open);
        // Runs whether or not anything settled this time round: the queue may
        // be holding a redemption that failed on an earlier pass, or one left
        // over from before the page was reloaded.
        await runRedemptions();
      } finally {
        inFlight = false;
      }
    };

    const runCheck = async (open: `0x${string}`[]) => {
      let settled: Settlement[] = [];
      try {
        settled = await pollSettlements(exchange.client, open);
        settleMisses = 0;
      } catch (e) {
        console.warn("[farm] could not check finished rounds:", e);
        if (alive && ++settleMisses === 3) {
          setMessage("Cannot check your open calls right now. They are safe on chain and will settle.");
        }
        return;
      }
      if (!alive || !settled.length) return;

      const pairs = redeemablePairs(store.getState(), playerId, settled);
      for (const ev of settlementEvents(settled, currentWindowId())) store.dispatch(ev);
      setSettlementQueue((q) => [...q, ...settled.map((s) => s.marketId)]);

      // Queue rather than claim. Whether the money actually came back is
      // decided by runRedemptions, which can try again if it does not.
      if (pairs.length && address) {
        saveQueue(address, enqueue(readQueue(address), pairs.map((p) => p.call.marketId)));
      }
    };

    /**
     * Ask the chain for everything still owed, and keep asking.
     *
     * Claiming back collateral is housekeeping: it must never block the game or
     * surface as an error to the player. But it must not be given up on either,
     * so only a final answer takes a market off the queue.
     */
    const runRedemptions = async () => {
      if (!address || redeeming.current) return;
      const queued = due(readQueue(address));
      if (!queued.length) return;

      const pairs = pendingPairs(store.getState(), playerId, queued);
      if (!pairs.length) {
        // Queued but no longer in the log — nothing left to rebuild from.
        saveQueue(address, remove(readQueue(address), queued));
        return;
      }

      redeeming.current = true;
      try {
        const results = await redeemSettled(exchange, pairs);
        if (!alive) return;
        let queue = readQueue(address);
        const before = exhausted(queue).length;
        for (const r of results) {
          if (isTerminal(r)) queue = remove(queue, [r.marketId]);
          else {
            console.warn(`[farm] redemption for ${r.marketId} did not go through, will retry:`, r.error);
            queue = recordFailure(queue, r.marketId, failureKind(r), r.error ?? "unknown");
          }
        }
        saveQueue(address, queue);

        // Giving up quietly is how money goes missing without anyone noticing.
        // The player cannot act on it beyond coming back later, which is
        // exactly what the sentence asks of them, and the next session picks
        // the queue up again from the top.
        if (exhausted(queue).length > before) {
          setMessage("Some winnings could not be collected just now. They are safe on chain, and the game will try again next time you open it.");
        }
      } catch (e) {
        console.warn("[farm] redemption round failed:", e);
      } finally {
        redeeming.current = false;
      }
    };

    void check();
    const id = window.setInterval(check, SETTLE_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [exchange, store, playerId, address]);

  // --- actions -------------------------------------------------------------
  const run = useCallback(async (key: string, fn: () => Promise<void>, failure: string) => {
    setPending(key);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      console.warn(`[farm] ${key} failed:`, e);
      const rejected = String((e as Error)?.message ?? "").toLowerCase();
      setMessage(
        rejected.includes("reject") || rejected.includes("denied")
          ? "You turned that down in your wallet. Nothing happened."
          : failure,
      );
    } finally {
      setPending(null);
    }
  }, []);

  const connectWallet = useCallback(async () => {
    const connector = connectors[0];
    if (!connector) throw new Error("no wallet connector");
    if (!isConnected) await connectAsync({ connector });
    // The wallet may already be on Shannon, or may refuse to move; the banner covers both.
    await switchChainAsync({ chainId: CHAIN.id }).catch(() => {});
  }, [connectors, isConnected, connectAsync, switchChainAsync]);

  const actions = useMemo<GameActions>(() => ({
    async connect() {
      await run("connect", connectWallet, "Could not reach your wallet. Is it unlocked?");
    },

    disconnect() {
      disconnect();
    },

    async getTestFunds() {
      await run("faucet", async () => {
        // The button is offered before anyone is connected, which is the whole
        // point of it: a judge lands here with an empty wallet. Connect first.
        if (!exchange) {
          await connectWallet();
          setMessage("Wallet connected. Press it once more to claim your test funds.");
          return;
        }
        if (!exchange.trader.faucet) throw new Error("no faucet on this trader");
        await exchange.trader.faucet({});
        setMessage("Test funds are on the way. Give it a moment, then make a call.");
      }, "The faucet did not answer. Try again in a moment.");
    },

    async placeCall(asset: string, direction: Direction) {
      await run(`call:${asset}:${direction}`, async () => {
        if (!exchange || !store) throw new Error("not connected");
        const window = pickWindow(windows, asset);
        if (!window) throw new Error("no open window");
        const placed = await placeCall(exchange, window, direction);
        if (!placed) {
          setMessage("That round would not take the call. Try the other one, or wait for the next.");
          return;
        }
        const violation = store.dispatch({
          type: "CALL_PLACED",
          playerId,
          callId: placed.callId,
          marketId: placed.marketId,
          asset: placed.asset,
          windowId: placed.windowId,
          direction: placed.direction,
          entryPrice: placed.entryPrice,
        });
        if (violation) setMessage("That call did not count. Your farm is unchanged.");
      }, "The call did not go through. Nothing was spent.");
    },

    async startUpgrade(farmId: string) {
      await run(`upgrade:${farmId}`, async () => {
        if (!store) throw new Error("not connected");
        const violation = store.dispatch({ type: "START_UPGRADE", playerId, farmId });
        if (violation) setMessage("You cannot start that build yet.");
      }, "Could not start the build.");
    },

    async buyEquipment(farmId: string, item: EquipmentId) {
      await run(`equip:${farmId}:${item}`, async () => {
        if (!store) throw new Error("not connected");
        const violation = store.dispatch({ type: "BUY_EQUIPMENT", playerId, farmId, item });
        if (violation) setMessage("You cannot buy that yet.");
      }, "Could not buy that.");
    },
  }), [run, connectWallet, disconnect, exchange, store, windows, playerId]);

  // --- what the screens see ------------------------------------------------
  const view = useMemo(
    () => buildView({ rules: RULES, state, playerId, address: address ?? null, windows, now, entries }),
    [state, playerId, address, windows, now, entries],
  );

  // The overlay shows one finished call at a time, oldest first.
  const settlement = useMemo(() => {
    const marketId = settlementQueue[0];
    if (!marketId) return null;
    const p = state.players[playerId];
    const call = p?.calls.find((c) => c.marketId === marketId && c.result !== null);
    if (!call) return null;
    return view.finishedCalls.find((c) => c.id === call.id) ?? null;
  }, [settlementQueue, state, playerId, view.finishedCalls]);

  const game = useMemo<Game>(() => ({
    view,
    actions,
    pending,
    message,
    dismissMessage: () => setMessage(null),
    settlement,
    dismissSettlement: () => setSettlementQueue((q) => q.slice(1)),
    wrongChain: isConnected && chainId !== undefined && chainId !== CHAIN.id,
  }), [view, actions, pending, message, settlement, isConnected, chainId]);

  return <GameContext.Provider value={game}>{children}</GameContext.Provider>;
}

export function useGame(): Game {
  const game = useContext(GameContext);
  if (!game) throw new Error("useGame must be used inside a GameProvider");
  return game;
}
