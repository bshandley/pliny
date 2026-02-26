interface PlinyLogoProps {
  size?: number;
  className?: string;
}

export default function PlinyLogo({ size = 32, className }: PlinyLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-label="Plank logo"
    >
      {/* Plank 1 — short, left-leaning */}
      <g transform="rotate(-6 8 32)">
        <rect x="2" y="14" width="10" height="22" rx="3" fill="var(--primary)" />
        <line x1="5.5" y1="14" x2="5.5" y2="36" stroke="rgba(255,255,255,0.12)" strokeWidth="0.7" />
        <line x1="9" y1="14" x2="9" y2="36" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      </g>
      {/* Plank 2 — medium, near-vertical */}
      <g transform="rotate(-1 20 32)">
        <rect x="14.5" y="7" width="10" height="29" rx="3" fill="var(--primary)" opacity="0.72" />
        <line x1="18" y1="7" x2="18" y2="36" stroke="rgba(255,255,255,0.12)" strokeWidth="0.7" />
        <line x1="21.5" y1="7" x2="21.5" y2="36" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      </g>
      {/* Plank 3 — tall, right-leaning */}
      <g transform="rotate(4 32 32)">
        <rect x="27" y="2" width="10" height="34" rx="3" fill="var(--primary)" opacity="0.48" />
        <line x1="30.5" y1="2" x2="30.5" y2="36" stroke="rgba(255,255,255,0.12)" strokeWidth="0.7" />
        <line x1="34" y1="2" x2="34" y2="36" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      </g>
    </svg>
  );
}
