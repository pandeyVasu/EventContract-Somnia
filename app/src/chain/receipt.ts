// A receipt is not a result.
//
// A reverted transaction comes back with a receipt shaped exactly like a
// successful one. Awaiting it and going no further is how a failed write reports
// success to a player. On Somnia this is an ordinary failure rather than a rare
// one: several storage writes require a million gas to remain available even
// though they are charged far less, so a wallet that sizes the limit from an
// Ethereum-shaped estimate can mine a transaction that did nothing, with status
// zero and no logs.
//
// The `status` field arrives as "success", 1n, or 1 depending on what produced
// it, and the string "reverted" passes any truthiness check.

export interface ReceiptLike {
  status?: unknown;
  transactionHash?: string;
  hash?: string;
}

export function receiptSucceeded(receipt: ReceiptLike | null | undefined): boolean {
  const status = (receipt as any)?.status ?? (receipt as any)?.receipt?.status;
  if (status === undefined || status === null) return false;
  if (typeof status === "string") return status.toLowerCase() === "success";
  if (typeof status === "bigint") return status === 1n;
  if (typeof status === "number") return status === 1;
  if (typeof status === "boolean") return status;
  return false;
}

/** The hash of whatever a write returned, wherever the SDK put it. */
export function hashOf(res: any): string | null {
  return String(res?.transactionHash ?? res?.hash ?? res?.receipt?.transactionHash ?? "") || null;
}
