// The surfaces and controls every screen is built from. Design spec, section 3.3.
//
// A disabled control here always takes a `reason`, because a control that refuses
// without saying why is the one thing the interface may never do.

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("panel", className)}>{children}</div>;
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("pill", className)}>{children}</div>;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("label", className)}>{children}</span>;
}

type Variant = "primary" | "up" | "down" | "gold" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-terracotta text-cream",
  up: "bg-gold text-gold-ink",
  down: "bg-sage text-sage-ink",
  gold: "bg-gold text-gold-ink",
  quiet: "bg-paper text-ink",
};

interface ChunkyProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  variant?: Variant;
  /** Set to disable. The text is shown to the player, so write a sentence. */
  reason?: string | null;
  busy?: boolean;
  children: ReactNode;
}

export function Chunky({ variant = "primary", reason, busy, children, className, ...rest }: ChunkyProps) {
  const disabled = Boolean(reason) || Boolean(busy);
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      title={reason ?? undefined}
      className={cx("chunky px-5", VARIANTS[variant], busy && "opacity-70", className)}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

/** A short sentence under a control saying why it will not act, or a hint. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("m-0 text-sm font-bold text-muted", className)}>{children}</p>;
}

const ASSET_BADGES: Record<string, string> = {
  BTC: "bg-gold text-gold-ink",
  ETH: "bg-slate text-slate-ink",
};

export function AssetBadge({ asset, size = 48 }: { asset: string; size?: number }) {
  return (
    <span
      className={cx(
        "flex items-center justify-center rounded-[14px] border-[3px] border-bark font-display font-bold",
        ASSET_BADGES[asset] ?? "bg-sand-dark text-ink",
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden
    >
      {asset.slice(0, 1)}
    </span>
  );
}

/** Eight dots: how many calls are left today. Readable without counting. */
export function CallPips({ left, total }: { left: number; total: number }) {
  return (
    <span className="flex gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cx(
            "h-2.5 w-2.5 rounded-full border-[1.5px] border-bark",
            i < left ? "bg-terracotta" : "bg-line",
          )}
        />
      ))}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-4 overflow-hidden rounded-full border-2 border-bark bg-line">
      <div className="h-full bg-sage-ink transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}
