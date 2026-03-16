import type { TerminalWindowModel } from "../types";

const GAP = 8;

function overlaps(
  x: number,
  y: number,
  w: number,
  h: number,
  existing: TerminalWindowModel[]
): boolean {
  return existing.some(
    (t) =>
      x < t.x + t.width + GAP &&
      x + w + GAP > t.x &&
      y < t.y + t.height + GAP &&
      y + h + GAP > t.y
  );
}

export function findFreePosition(
  clickX: number,
  clickY: number,
  width: number,
  height: number,
  existing: TerminalWindowModel[]
): { x: number; y: number } {
  const x = clickX - width / 2;
  const y = clickY - height / 2;

  if (existing.length === 0 || !overlaps(x, y, width, height, existing)) {
    return { x, y };
  }

  // Build candidate positions: slots directly adjacent to every existing terminal
  const candidates: { x: number; y: number }[] = [];

  for (const t of existing) {
    candidates.push(
      // right edge, aligned to top / centre / bottom of neighbour
      { x: t.x + t.width + GAP, y: t.y },
      { x: t.x + t.width + GAP, y: t.y + (t.height - height) / 2 },
      { x: t.x + t.width + GAP, y: t.y + t.height - height },
      // left edge
      { x: t.x - width - GAP, y: t.y },
      { x: t.x - width - GAP, y: t.y + (t.height - height) / 2 },
      // below
      { x: t.x, y: t.y + t.height + GAP },
      { x: t.x + (t.width - width) / 2, y: t.y + t.height + GAP },
      { x: t.x + t.width - width, y: t.y + t.height + GAP },
      // above
      { x: t.x, y: t.y - height - GAP },
      { x: t.x + (t.width - width) / 2, y: t.y - height - GAP }
    );
  }

  // Sort candidates by distance from the click point (prefer closest to where user clicked)
  candidates.sort((a, b) => {
    const da = (a.x + width / 2 - clickX) ** 2 + (a.y + height / 2 - clickY) ** 2;
    const db = (b.x + width / 2 - clickX) ** 2 + (b.y + height / 2 - clickY) ** 2;
    return da - db;
  });

  for (const pos of candidates) {
    if (!overlaps(pos.x, pos.y, width, height, existing)) return pos;
  }

  // Last resort: cascade
  return { x: x + existing.length * 20, y: y + existing.length * 20 };
}

/**
 * After a terminal is resized, nudge any overlapping neighbors out of the way.
 * The resized terminal stays put; others shift by the minimum amount needed.
 * Runs iteratively until no overlaps remain (max 10 passes to prevent infinite loops).
 */
export function nudgeOverlaps(
  terminals: TerminalWindowModel[],
  resizedId: string
): TerminalWindowModel[] {
  const result = terminals.map((t) => ({ ...t }));
  const fixed = new Set([resizedId]);

  for (let pass = 0; pass < 10; pass++) {
    let moved = false;

    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result.length; j++) {
        if (i === j) continue;
        // Only push j if i is fixed (already positioned) and j is not the resized one
        if (!fixed.has(result[i].id)) continue;
        if (result[j].id === resizedId) continue;

        const a = result[i];
        const b = result[j];

        const overlapX = Math.min(a.x + a.width + GAP, b.x + b.width + GAP) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height + GAP, b.y + b.height + GAP) - Math.max(a.y, b.y);

        if (overlapX > 0 && overlapY > 0) {
          // Push along the axis with less overlap (minimum displacement)
          if (overlapX < overlapY) {
            // Push horizontally
            const centerA = a.x + a.width / 2;
            const centerB = b.x + b.width / 2;
            if (centerB >= centerA) {
              result[j] = { ...result[j], x: a.x + a.width + GAP };
            } else {
              result[j] = { ...result[j], x: a.x - b.width - GAP };
            }
          } else {
            // Push vertically
            const centerA = a.y + a.height / 2;
            const centerB = b.y + b.height / 2;
            if (centerB >= centerA) {
              result[j] = { ...result[j], y: a.y + a.height + GAP };
            } else {
              result[j] = { ...result[j], y: a.y - b.height - GAP };
            }
          }
          fixed.add(result[j].id);
          moved = true;
        }
      }
    }

    if (!moved) break;
  }

  return result;
}

/**
 * Flow-arrange all terminals into a compact grid anchored at (originX, originY).
 * Terminals are sorted into rows that don't exceed maxRowWidth.
 */
export function arrangeTerminals(
  terminals: TerminalWindowModel[],
  originX = 40,
  originY = 40,
  maxRowWidth = 1600
): TerminalWindowModel[] {
  if (terminals.length === 0) return terminals;

  const sorted = [...terminals];
  const rows: TerminalWindowModel[][] = [];
  let row: TerminalWindowModel[] = [];
  let rowWidth = 0;

  for (const t of sorted) {
    if (rowWidth + t.width > maxRowWidth && row.length > 0) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }
    row.push(t);
    rowWidth += t.width + GAP;
  }
  if (row.length > 0) rows.push(row);

  const result: TerminalWindowModel[] = [];
  let curY = originY;

  for (const r of rows) {
    let curX = originX;
    const rowHeight = Math.max(...r.map((t) => t.height));
    for (const t of r) {
      result.push({ ...t, x: curX, y: curY });
      curX += t.width + GAP;
    }
    curY += rowHeight + GAP;
  }

  return result;
}
