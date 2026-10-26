import { test } from "node:test";
import assert from "node:assert/strict";
import {
  centeredBox,
  circleDragBox,
  circleRadius,
  clampBox,
  defaultCirclePlacement,
  hitBounds,
  imagePlacement,
  resizeBox,
  textPlacement,
  textVisualBounds,
  tickPlacement,
  tickPoints,
  tickVisualBounds,
} from "../src/geometry.ts";

test("tick preview, selection and export share one geometry", () => {
  const item = { x: 40, y: 60, w: 28, h: 28, size: 2.5 },
    points = tickPoints(item),
    bounds = tickVisualBounds(item);
  assert.deepEqual(points, [
    { x: 40 + 28 * 0.12, y: 60 + 28 * 0.54 },
    { x: 40 + 28 * 0.4, y: 60 + 28 * 0.82 },
    { x: 40 + 28 * 0.9, y: 60 + 28 * 0.16 },
  ]);
  assert.equal(bounds.x, Math.min(...points.map((p) => p.x)) - 1.25);
  assert.equal(bounds.y, Math.min(...points.map((p) => p.y)) - 1.25);
  assert(
    Math.abs(
      bounds.w -
        (Math.max(...points.map((p) => p.x)) -
          Math.min(...points.map((p) => p.x)) +
          2.5),
    ) < 1e-9,
  );
});

test("tick placement is centred on the hotspot and clamped at page edges", () => {
  const centre = tickPlacement({ x: 100, y: 100 }, 595, 842);
  assert.equal(centre.x, 100 - 14);
  assert.equal(centre.y, 100 - 14);
  const edge = tickPlacement({ x: 2, y: 2 }, 595, 842);
  assert.equal(edge.x, 0);
  assert.equal(edge.y, 0);
  const far = tickPlacement({ x: 594, y: 841 }, 595, 842);
  assert.equal(far.x, 595 - 28);
  assert.equal(far.y, 842 - 28);
});

test("a circle drag stays a true circle in every drag direction", () => {
  for (const current of [
    { x: 120, y: 150 },
    { x: 60, y: 150 },
    { x: 120, y: 70 },
    { x: 60, y: 70 },
  ]) {
    const box = circleDragBox({ x: 100, y: 100 }, current, 595, 842);
    assert(box);
    assert.equal(box.w, box.h);
    assert.equal(
      box.w,
      Math.max(Math.abs(current.x - 100), Math.abs(current.y - 100)),
    );
  }
  assert.equal(circleDragBox({ x: 100, y: 100 }, { x: 101, y: 101 }, 595, 842), null);
});

test("circle drag clamps at page edges without becoming an ellipse", () => {
  const box = circleDragBox({ x: 10, y: 10 }, { x: -80, y: -80 }, 595, 842);
  assert(box);
  assert.equal(box.x, 0);
  assert.equal(box.y, 0);
  assert.equal(box.w, box.h);
  assert.equal(box.w, 90);
});

test("default circle and image placement stay inside the page and preserve ratio", () => {
  const circle = defaultCirclePlacement({ x: 1, y: 1 }, 200, 300);
  assert.equal(circle.x, 0);
  assert.equal(circle.y, 0);
  assert.equal(circle.w, circle.h);
  const image = imagePlacement({ x: 30, y: 280 }, 3.5, 200, 300);
  assert(Math.abs(image.w / image.h - 3.5) < 1e-9);
  assert(image.x >= 0 && image.y >= 0);
  assert(image.x + image.w <= 200.0001);
  assert(image.y + image.h <= 300.0001);
});

test("text selection hugs rendered rows, not the 190pt layout width", () => {
  const item = { x: 30, y: 40, w: 190, h: 50, size: 14, text: "Yes" },
    bounds = textVisualBounds(item, ["Yes"], (text, size) => text.length * size * 0.55);
  assert.equal(bounds.x, 30);
  assert.equal(bounds.y, 40);
  assert(bounds.w < 40);
  assert.equal(bounds.h, 17.5);
  const wrapped = textVisualBounds(
    item,
    ["A long first row", "and a second"],
    (text, size) => text.length * size * 0.55,
  );
  assert.equal(wrapped.h, 35);
});

test("hit targets stay finger-sized while the visible bounds stay tight", () => {
  const visible = { x: 10, y: 10, w: 8, h: 6 },
    hit = hitBounds(visible, 44, 5);
  assert.equal(hit.w, 44);
  assert.equal(hit.h, 44);
  assert.equal(hit.x, 10 + 4 - 22);
  assert.equal(hit.y, 10 + 3 - 22);
});

test("proportional resize keeps ticks, images and circles proportional", () => {
  for (const kind of ["tick", "image", "circle"]) {
    const box = resizeBox(
      kind,
      { x: 20, y: 20, w: 100, h: 100 },
      30,
      5,
      500,
      500,
    );
    assert.equal(box.w, box.h);
    assert.equal(box.w, 130);
  }
  const text = resizeBox(
    "text",
    { x: 20, y: 20, w: 100, h: 30 },
    40,
    0,
    500,
    500,
  );
  assert.equal(text.w, 140);
  assert.equal(text.h, 30);
});

test("clamping a too-large box shrinks it to the page instead of hiding content", () => {
  const box = clampBox({ x: 10, y: 10, w: 700, h: 900 }, 595, 842);
  assert.deepEqual(box, { x: 0, y: 0, w: 595, h: 842 });
  assert.equal(circleRadius({ x: 0, y: 0, w: 60, h: 60, size: 4 }), 28);
});
