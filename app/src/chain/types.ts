// The narrow slice of the SDK the adapter touches. Everything here is an
// interface rather than an import of the concrete client, so the unit tests can
// hand the adapter a fake exchange and never open a socket.

export type Direction = "up" | "down";
export type MarketResult = "up" | "down" | "void";

/** One price level, raw units. A YES price of 585000 is a probability of 0.585. */
export interface BookLevel {
  price: bigint;
  quantity: bigint;
}

/**
 * The book is split by outcome. There are no plain `bids` and `asks` arrays, and
 * reading those returns undefined, which is indistinguishable from an empty book.
 */
export interface OrderBook {
  yesBids: BookLevel[];
  yesAsks: BookLevel[];
  noBids: BookLevel[];
  noAsks: BookLevel[];
}

/** Tick and lot grid from getBinaryBookParams, needed by the stake quote. */
export interface BookGrid {
  tickSize: bigint;
  lotSize: bigint;
  minQuantity: bigint;
}

/** A tradeable Up/Down market, already filtered and checked against the chain. */
export interface LiveWindow {
  marketId: `0x${string}`;
  pool: `0x${string}`;
  asset: string;
  /** Market window length in seconds. One hour on testnet today. */
  intervalSec: number;
  /** Unix seconds when the market settles. */
  expiry: number;
  secondsLeft: number;
}

/** What the adapter hands the game after a fill. Shaped for the engine's CALL_PLACED. */
export interface PlacedCall {
  callId: string;
  marketId: `0x${string}`;
  asset: string;
  direction: Direction;
  /** Probability of the chosen side at entry, in (0,1). Inverted for Down. */
  entryPrice: number;
  /** Game window the call was placed in, not the market's own window. */
  windowId: number;
  shares: bigint;
  txHash: string;
  marketExpiry: number;
}

/** What the adapter hands the game when a market finishes. */
export interface Settlement {
  marketId: `0x${string}`;
  result: MarketResult;
  /** Outcome index that won, or null on a void. 0 is Up, 1 is Down. */
  winningOutcome: 0 | 1 | null;
}

export interface ChainMarket {
  status: number;
  isResolved: boolean;
  isVoided: boolean;
  winningOutcome: number;
  outcomeToken: `0x${string}`;
  yesId: bigint;
  noId: bigint;
  pool: `0x${string}`;
}

export interface OrderFill {
  /** The filled size. There is no plain `quantity` field on a fill. */
  quantityFilled: bigint;
  /** Always the YES price, even on a BUY_NO. */
  fillPrice: bigint;
}

export interface PlaceOrderResult {
  fills?: OrderFill[];
  transactionHash?: string;
  hash?: string;
}

export interface ChainClient {
  listLiveBinaryMarkets(args: { limit: number }): Promise<any[]>;
  getMarketOnchain(marketId: `0x${string}`): Promise<ChainMarket>;
  getBinaryOrderBook(pool: `0x${string}`): Promise<OrderBook>;
  getBinaryBookParams(pool: `0x${string}`): Promise<BookGrid>;
  getOutcomeBalance(args: { outcomeToken: `0x${string}`; account: `0x${string}`; id: bigint }): Promise<bigint>;
  /** Positional, not an options object. The rest of the client takes objects; this one does not. */
  getErc20Balance?(token: `0x${string}`, account: `0x${string}`): Promise<bigint>;
}

export interface ChainTrader {
  placeOrder(params: {
    pool: `0x${string}`;
    side: string;
    price: bigint;
    quantity: bigint;
    orderType: number;
  }): Promise<PlaceOrderResult>;
  redeem(params: { marketId: `0x${string}`; amount: bigint; outcomeIdx: 0 | 1 }): Promise<any>;
  /** Testnet only: claim tUSDC. Present on the real trader, absent from some fakes. */
  faucet?(args: Record<string, never>): Promise<any>;
}

/** Just enough of SomniaMarkets for the adapter and for a fake in tests. */
export interface Exchange {
  client: ChainClient;
  trader: ChainTrader;
  walletAddress: `0x${string}`;
}
