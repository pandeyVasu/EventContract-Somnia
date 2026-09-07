// Every icon is drawn, never a glyph. One grid (24), one stroke weight family,
// rounded caps, so they sit together and recolour with the surface they are on.

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
  focusable: false as const,
});

export function CoinIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2.2}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
    </svg>
  );
}

export function ClockIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2.2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function UpIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2.6}>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

export function DownIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2.6}>
      <path d="M12 5v14" />
      <path d="M19 12l-7 7-7-7" />
    </svg>
  );
}

export function CheckIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2.8}>
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function CrossIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2.6}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export function ExternalIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2.2}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function WheatIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={1.9}>
      <path d="M12 22V9" />
      <path d="M12 9c-3 0-5-2-5-5 3 0 5 2 5 5z" />
      <path d="M12 9c3 0 5-2 5-5-3 0-5 2-5 5z" />
      <path d="M12 14c-3 0-5-2-5-5 3 0 5 2 5 5z" />
      <path d="M12 14c3 0 5-2 5-5-3 0-5 2-5 5z" />
    </svg>
  );
}

export function WalletIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2.2}>
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.2" />
    </svg>
  );
}

export function DropIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2}>
      <path d="M12 3s-5 6-5 10a5 5 0 0 0 10 0c0-4-5-10-5-10z" />
    </svg>
  );
}

export function TractorIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2}>
      <circle cx="7" cy="17" r="3" />
      <circle cx="17" cy="17" r="3" />
      <path d="M10 17h4" />
      <path d="M5 14V8h7l2 6" />
      <path d="M12 8V5h3" />
    </svg>
  );
}

export function ShedIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export const EQUIPMENT_ICONS = {
  irrigation: DropIcon,
  harvester: TractorIcon,
  shed: ShedIcon,
} as const;
