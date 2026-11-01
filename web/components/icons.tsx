// Line icons from the design canvas: 1.8–2 px strokes, inline SVG, always
// decorative (the label beside them carries the meaning).

type IconProps = { className?: string };

/** The faceted gem beside the wordmark. */
export function GemMark({ className = "" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className={className}>
      <path d="M6 3h12l4 6-10 12L2 9z" />
      <path d="M2 9h20M8 9l4 12 4-12M8 9l4-6 4 6" />
    </svg>
  );
}

/** A crystal point, drawn on tiles for stones with no photo yet. */
export function CrystalIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" className={className}>
      <path d="M12 2 7 7v10l5 5 5-5V7z" />
      <path d="M7 7l5 3 5-3M12 10v12" />
    </svg>
  );
}

export function CameraIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className={className}>
      <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

/** A photo from the camera roll. */
export function PhotosIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </svg>
  );
}

// The three photo tips on the add page: daylight, a coin for scale, a label.

export function SunIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </svg>
  );
}

export function CoinIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5.5" />
    </svg>
  );
}

export function TagIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className={className}>
      <path d="M3 4v7.5L12.5 21l8-8L11 3.5H3.5z" />
      <circle cx="7.5" cy="8" r="1.5" />
    </svg>
  );
}
