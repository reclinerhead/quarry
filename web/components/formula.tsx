import { Fragment } from "react";
import type { Segment } from "@/lib/mindat";

/** A formula's runs, with real subscripts and superscripts (#23); the stone page and the periodic table draw them. */
export function Formula({ segments }: { segments: Segment[] }) {
  return segments.map((s, i) =>
    s.pos === "sub" ? <sub key={i}>{s.text}</sub> : s.pos === "sup" ? <sup key={i}>{s.text}</sup> : <Fragment key={i}>{s.text}</Fragment>,
  );
}
