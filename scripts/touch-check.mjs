import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("output/touch", { recursive: true });
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      acceptDownloads: true,
    }),
    p = await context.newPage(),
    cdp = await context.newCDPSession(p);
  await p.goto(process.env.PAPERWORK_ORIGIN || "http://127.0.0.1:4264");
  await p
    .locator("#pdf-file")
    .setInputFiles(
      "tests/fixtures/paperwork-fixtures/paperwork-lab-interactive-mixed.pdf",
    );
  await p.waitForFunction(
    () => document.querySelector("#page").dataset.rendered === "0",
  );
  await p.locator("#page-number").selectOption({ value: "1" });
  await p.waitForFunction(
    () => document.querySelector("#page").dataset.rendered === "1",
  );
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })),
    });
  async function drag(x, y, dx, dy) {
    await touch("touchStart", [[x, y]]);
    for (let i = 1; i <= 12; i++)
      await touch("touchMove", [[x + (dx * i) / 12, y + (dy * i) / 12]]);
    await touch("touchEnd", []);
  }
  await p.locator('button[data-tool="pen"]').tap();
  let b = await p.locator("#page").boundingBox();
  await drag(b.x + 45, b.y + 75, 60, 20);
  assert.equal(await p.locator("#additions [data-object]").count(), 1);
  await p.locator('button[data-tool="select"]').tap();
  // The compact viewport fits the whole page at initial zoom. Make scrolling
  // meaningful before asserting the native Select-pan behavior.
  for (let step = 0; step < 2; step++) {
    await p.locator("#zoom-in").tap();
    await p.waitForFunction(
      () =>
        document.querySelector("#page").getAttribute("aria-busy") === "false",
    );
  }
  assert(
    await p
      .locator("#workspace")
      .evaluate((el) => el.scrollHeight > el.clientHeight + 40),
  );
  await drag(200, 550, 0, -140);
  await p.waitForFunction(
    () => document.querySelector("#workspace").scrollTop > 0,
  );
  assert.equal(await p.locator("#additions [data-object]").count(), 1);
  await p.locator('button[data-tool="pen"]').tap();
  const beforeZoom = Number(
    (await p.locator("#zoom-label").textContent()).replace("%", ""),
  );
  await touch("touchStart", [[120, 380, 0]]);
  await touch("touchStart", [
    [120, 380, 0],
    [240, 380, 1],
  ]);
  await touch("touchMove", [
    [90, 380, 0],
    [270, 380, 1],
  ]);
  await touch("touchEnd", []);
  await p.waitForFunction(
    () => document.querySelector("#page").getAttribute("aria-busy") === "false",
  );
  const afterZoom = Number(
    (await p.locator("#zoom-label").textContent()).replace("%", ""),
  );
  assert(afterZoom > beforeZoom);
  assert.equal(await p.locator("#additions [data-object]").count(), 1);
  await p
    .locator("#signature-file")
    .setInputFiles(
      "tests/fixtures/paperwork-fixtures/demo-signature-transparent.png",
    );
  await p.waitForFunction(
    () => document.querySelector("#page").dataset.tool === "image",
  );
  await p.locator("#workspace").evaluate((el) => (el.scrollTop = 420));
  b = await p.locator("#page").boundingBox();
  const scale = b.width / 595.2756;
  await p.touchscreen.tap(b.x + 110 * scale, b.y + 620 * scale);
  const img = p.locator("#additions image");
  await img.scrollIntoViewIfNeeded();
  let imageBox = await img.boundingBox(),
    x = Number(await img.getAttribute("x"));
  await drag(
    imageBox.x + imageBox.width / 2,
    imageBox.y + imageBox.height / 2,
    15,
    -12,
  );
  assert(Number(await img.getAttribute("x")) > x);
  // Moving a zoomed image can put its corner beyond the viewport. A real
  // resize must start on a visible grip, not at an off-screen CDP coordinate.
  await p.locator("#additions .handle").scrollIntoViewIfNeeded();
  let handle = await p.locator("#additions .handle").boundingBox();
  await p.locator("#workspace").evaluate((el, rect) => {
    el.scrollLeft += Math.max(0, rect.x + rect.width - innerWidth + 24);
  }, handle);
  handle = await p.locator("#additions .handle").boundingBox();
  assert(handle.x >= 0 && handle.x + handle.width <= 390);
  assert(handle.y >= 0 && handle.y + handle.height <= 844);
  const width = Number(await img.getAttribute("width"));
  await drag(handle.x + handle.width / 2, handle.y + handle.height / 2, 20, 5);
  assert(Number(await img.getAttribute("width")) > width);
  const dl = p.waitForEvent("download");
  await p.locator("#save").tap();
  await (await dl).saveAs("output/touch/continuous-touch-completed.pdf");
  const result = {
    origin: process.env.PAPERWORK_ORIGIN || "http://127.0.0.1:4264",
    continuous_touch_ink: true,
    select_scroll_without_ink: true,
    two_finger_zoom_without_ink: true,
    signature_touch_move_resize: true,
    download: true,
    beforeZoom,
    afterZoom,
  };
  writeFileSync(
    "output/touch/touch-receipt.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
  if (process.env.LOFTWAH_VALIDATION_COMPLETION)
    writeFileSync(
      process.env.LOFTWAH_VALIDATION_COMPLETION,
      JSON.stringify({
        version: 1,
        generation: process.env.LOFTWAH_VALIDATION_GENERATION,
        cleanup: "complete",
      }),
    );
}
