import { Term } from "@/components/term";
import { isMatrix, MATRIX, pieceName, type PartRole } from "@/lib/pills";

type Piece = { name: string; variety?: string | null; parts?: ReadonlyArray<{ role: PartRole; name: string }> };

/**
 * A piece's name as a show label gives it (pieceName, #29), with "matrix"
 * carrying its info mark when the piece sits on rock nobody named. Never inside
 * a link or a button, which can't hold the mark's own button.
 */
export function PieceTitle({ piece }: { piece: Piece }) {
  const name = pieceName(piece);
  const base = piece.parts?.find((p) => p.role === "on");
  if (!base || !isMatrix(base.name)) return name;
  return (
    <>
      {name.slice(0, -MATRIX.length)}
      <Term k="matrix">{MATRIX}</Term>
    </>
  );
}
