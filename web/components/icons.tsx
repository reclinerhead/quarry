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
