export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const TICK_STROKE_POINTS = [
  [0.12, 0.54],
  [0.4, 0.82],
  [0.9, 0.16],
] as const;

/** The tick path in SVG (top-left origin) coordinates. */
export function tickPoints(item: Rect): Point[] {
  return TICK_STROKE_POINTS.map(([x, y]) => ({
    x: item.x + item.w * x,
    y: item.y + item.h * y,
  }));
}

/** Ink points are the painted centreline; stroke width extends visually. */
export function inkVisualBounds(item: Rect & { size: number; points?: Point[] }): Rect {
  const points = item.points || [];
  if (!points.length) return { x: item.x, y: item.y, w: item.w, h: item.h };
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    pad = Math.max(1, item.size) / 2;
  return {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    w: Math.max(1, Math.max(...xs) - Math.min(...xs)) + pad * 2,
    h: Math.max(1, Math.max(...ys) - Math.min(...ys)) + pad * 2,
  };
}

export function tickVisualBounds(item: Rect & { size: number }): Rect {
  const points = tickPoints(item),
    xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    pad = Math.max(1, item.size) / 2;
  return {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    w: Math.max(...xs) - Math.min(...xs) + pad * 2,
    h: Math.max(...ys) - Math.min(...ys) + pad * 2,
  };
}

/** The item box is the outside of the ring, including its stroke. */
export function circleRadius(item: Rect & { size: number }): number {
  return Math.max(0, (Math.min(item.w, item.h) - Math.max(0, item.size)) / 2);
}

export function circleVisualBounds(item: Rect): Rect {
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

export function imageVisualBounds(item: Rect): Rect {
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

/**
 * Tight visible bounds for rendered text. `rows` are the actual wrapped lines
 * from the same PDF font metrics used by export; `measure` returns their width.
 * The layout width (item.w) is deliberately not used here: a short word must
 * not receive a 190 pt selection box.
 */
export function textVisualBounds(
  item: Rect & { text?: string; size: number },
  rows: string[],
  measure: (text: string, size: number) => number,
): Rect {
  const actual = rows.length ? rows : [""],
    width = Math.max(2, ...actual.map((row) => measure(row, item.size))),
    height = Math.max(item.size * 1.1, actual.length * item.size * 1.25);
  return { x: item.x, y: item.y, w: width, h: height };
}

export function visualBounds(
  item: Rect & {
    kind: "ink" | "text" | "tick" | "image" | "circle";
    size: number;
    points?: Point[];
    text?: string;
  },
  textRows?: string[],
  measure?: (text: string, size: number) => number,
): Rect {
  if (item.kind === "ink") return inkVisualBounds(item);
  if (item.kind === "tick") return tickVisualBounds(item);
  if (item.kind === "circle") return circleVisualBounds(item);
  if (item.kind === "image") return imageVisualBounds(item);
  if (textRows && measure) return textVisualBounds(item, textRows, measure);
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

/** Keep the visible content in place; only the invisible hit target grows. */
export function hitBounds(bounds: Rect, minSize: number, pad: number): Rect {
  const w = Math.max(bounds.w + pad * 2, minSize),
    h = Math.max(bounds.h + pad * 2, minSize);
  return {
    x: bounds.x - (w - bounds.w) / 2,
    y: bounds.y - (h - bounds.h) / 2,
    w,
    h,
  };
}

/** Shift a placement into the page instead of silently shrinking it. */
export function clampBox(box: Rect, pageWidth: number, pageHeight: number): Rect {
  const w = Math.min(box.w, pageWidth),
    h = Math.min(box.h, pageHeight);
  return {
    x: Math.max(0, Math.min(box.x, pageWidth - w)),
    y: Math.max(0, Math.min(box.y, pageHeight - h)),
    w,
    h,
  };
}

export function centeredBox(
  width: number,
  height: number,
  point: Point,
  pageWidth: number,
  pageHeight: number,
): Rect {
  return clampBox(
    { x: point.x - width / 2, y: point.y - height / 2, w: width, h: height },
    pageWidth,
    pageHeight,
  );
}

export function tickPlacement(
  point: Point,
  pageWidth: number,
  pageHeight: number,
  size = 28,
): Rect {
  return centeredBox(size, size, point, pageWidth, pageHeight);
}

export function defaultCirclePlacement(
  point: Point,
  pageWidth: number,
  pageHeight: number,
  diameter = 64,
): Rect {
  const size = Math.min(diameter, pageWidth, pageHeight);
  return centeredBox(size, size, point, pageWidth, pageHeight);
}

/**
 * Drag sets a square bounding box. A tap (below the threshold) returns null so
 * the caller can use a sensible default ring centred on the tap.
 */
export function circleDragBox(
  start: Point,
  current: Point,
  pageWidth: number,
  pageHeight: number,
  threshold = 4,
): Rect | null {
  const dx = current.x - start.x,
    dy = current.y - start.y,
    size = Math.max(Math.abs(dx), Math.abs(dy));
  if (size < threshold) return null;
  return clampBox(
    {
      x: dx < 0 ? start.x - size : start.x,
      y: dy < 0 ? start.y - size : start.y,
      w: size,
      h: size,
    },
    pageWidth,
    pageHeight,
  );
}

export function imagePlacement(
  point: Point,
  ratio: number,
  pageWidth: number,
  pageHeight: number,
): Rect {
  let width = Math.min(180, pageWidth * 0.45, pageHeight * 0.3 * ratio);
  let height = width / ratio;
  if (height > pageHeight * 0.8) {
    height = pageHeight * 0.8;
    width = height * ratio;
  }
  if (width > pageWidth * 0.8) {
    width = pageWidth * 0.8;
    height = width / ratio;
  }
  return centeredBox(width, height, point, pageWidth, pageHeight);
}

export function textPlacement(
  point: Point,
  pageWidth: number,
  pageHeight: number,
  size = 14,
): Rect {
  const width = Math.min(190, Math.max(48, pageWidth - point.x));
  return clampBox(
    { x: point.x, y: point.y, w: width, h: Math.max(18, size * 1.25) },
    pageWidth,
    pageHeight,
  );
}

export function resizeBox(
  kind: "ink" | "text" | "tick" | "image" | "circle",
  original: Rect,
  dx: number,
  dy: number,
  pageWidth: number,
  pageHeight: number,
  minSize = 12,
): Rect {
  const proportional = kind === "image" || kind === "tick" || kind === "circle";
  if (proportional) {
    const ratio = original.w / original.h,
      maxWidth = Math.min(
        pageWidth - original.x,
        (pageHeight - original.y) * ratio,
      ),
      width = Math.max(
        Math.min(minSize, maxWidth),
        Math.min(maxWidth, original.w + dx),
      );
    return { x: original.x, y: original.y, w: width, h: width / ratio };
  }
  return {
    x: original.x,
    y: original.y,
    w: Math.max(minSize, Math.min(pageWidth - original.x, original.w + dx)),
    h: Math.max(minSize, Math.min(pageHeight - original.y, original.h + dy)),
  };
}
