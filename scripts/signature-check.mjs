// Focused signature interaction regression. Uses the fictional owner fixture.
// Run after `pnpm build`; `PAPERWORK_ORIGIN` selects a deployed build instead.
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = path.resolve(
  process.env.PAPERWORK_EVIDENCE || "output/signature-check",
);
mkdirSync(output, { recursive: true });
const fixtureDirectory = path.resolve("tests/fixtures/paperwork-fixtures"),
  fixture = fixtureDirectory + "/paperwork-lab-interactive-mixed.pdf",
  firstSignature = fixtureDirectory + "/demo-signature-transparent.png",
  secondSignature = path.resolve("public/examples/fictional-signature.png");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".bcmap": "application/octet-stream",
  ".json": "application/json",
};
const server = createServer((request, response) => {
  let name = decodeURIComponent(
    new URL(request.url, "http://localhost").pathname,
  );
  if (name === "/") name = "/index.html";
  const file = path.resolve("dist", "." + name);
  if (
    !file.startsWith(path.resolve("dist") + path.sep) ||
    !existsSync(file)
  ) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader(
    "Content-Type",
    types[path.extname(file)] || "application/octet-stream",
  );
  const csp = readFileSync("public/_headers", "utf8")
    .split("\n")
    .find((line) => line.includes("Content-Security-Policy"));
  if (csp)
    response.setHeader(
      "Content-Security-Policy",
      csp.split("Content-Security-Policy: ")[1],
    );
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const localOrigin = `http://127.0.0.1:${server.address().port}`,
  origin = process.env.PAPERWORK_ORIGIN || localOrigin;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
    : { channel: "chrome" }),
});
const receipt = {
  source_sha: (() => {
    try {
      return require("node:child_process")
        .execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
        .trim();
    } catch {
      return "";
    }
  })(),
  origin,
  browser: browser.version(),
  checks: {},
  layout_deltas: {},
  known_limitations: [
    "Touch-browser emulation, not a physical iPhone or stylus.",
    "The export was reopened through the public app; independent reader and print evidence are recorded separately.",
  ],
};
const boxes = async (page) =>
  page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return {
        x: +box.x.toFixed(2),
        y: +box.y.toFixed(2),
        w: +box.width.toFixed(2),
        h: +box.height.toFixed(2),
      };
    };
    return {
      toolbar: rect(".toolbar"),
      page: rect("#page"),
      pageBar: rect(".page-bar"),
      workspace: rect("#workspace"),
      scrollTop: document.querySelector("#workspace").scrollTop,
      scrollLeft: document.querySelector("#workspace").scrollLeft,
    };
  });
const assertStationary = async (page, before, label) => {
  const after = await boxes(page);
  const delta = {
    toolbar: after.toolbar,
    page: after.page,
    pageBar: after.pageBar,
    scrollTop: after.scrollTop,
    scrollLeft: after.scrollLeft,
  };
  const baseline = {
    toolbar: before.toolbar,
    page: before.page,
    pageBar: before.pageBar,
    scrollTop: before.scrollTop,
    scrollLeft: before.scrollLeft,
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(delta)),
    JSON.parse(JSON.stringify(baseline)),
    label + " moved the document or its controls",
  );
  receipt.layout_deltas[label] = "stationary";
};
const pickerOpen = (page) =>
  page
    .locator("#signature-tray")
    .evaluate((node) => node.matches(":popover-open"));
const assertPickerOpen = async (page) => {
  assert.equal(await pickerOpen(page), true, "The signature picker opens");
  const picker = await page.locator("#signature-tray").boundingBox(),
    viewport = page.viewportSize();
  assert(picker, "The signature picker has visible bounds");
  assert(picker.x >= 0 && picker.y >= 0, "The picker stays inside the viewport");
  assert(
    picker.x + picker.width <= viewport.width + 0.5 &&
      picker.y + picker.height <= viewport.height + 0.5,
    "The picker does not run off the viewport",
  );
  assert.equal(
    await page.evaluate(() => {
      const picker = document.querySelector("#signature-tray");
      const box = picker.getBoundingClientRect();
      const target = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + Math.min(24, box.height / 2),
      );
      return picker.contains(target);
    }),
    true,
    "The picker is above the PDF canvas",
  );
};
const openPicker = async (page) => {
  await page.locator("#signature").click();
  await assertPickerOpen(page);
  await page.waitForTimeout(60);
};
const importSignature = async (page, file, expectedCount) => {
  if (!(await pickerOpen(page))) await openPicker(page);
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#add-signature").click();
  await (await chooser).setFiles(file);
  await page.waitForFunction(
    (expectedCount) =>
      document.querySelectorAll("#signature-list li").length === expectedCount &&
      document.querySelector("#page").dataset.tool === "image" &&
      !document.querySelector("#signature-tray").matches(":popover-open"),
    expectedCount,
  );
  assert.equal(await pickerOpen(page), false, "Import closes the picker");
};
const chooseStamp = async (page, index = 0) => {
  await openPicker(page);
  await page.locator(".stamp-option").nth(index).click();
  assert.equal(
    await pickerOpen(page),
    false,
    "Choosing a stamp closes the picker",
  );
  assert.equal(
    await page.locator("#page").getAttribute("data-tool"),
    "image",
    "The chosen stamp stays active",
  );
};
const pagePoint = async (page, xRatio, yRatio) => {
  const pageBox = await page.locator("#page").boundingBox(),
    workspace = await page.locator("#workspace").boundingBox();
  const left = Math.max(pageBox.x, workspace.x + 6),
    right = Math.min(pageBox.x + pageBox.width, workspace.x + workspace.width - 6),
    top = Math.max(pageBox.y, workspace.y + 6),
    bottom = Math.min(
      pageBox.y + pageBox.height,
      workspace.y + workspace.height - 6,
    );
  return {
    x: left + (right - left) * xRatio,
    y: top + (bottom - top) * yRatio,
    pageBox,
  };
};
const ghostBounds = async (page) =>
  page.evaluate(() => {
    const image = document.querySelector("#tool-preview image");
    if (!image) return null;
    return {
      x: +image.getAttribute("x"),
      y: +image.getAttribute("y"),
      w: +image.getAttribute("width"),
      h: +image.getAttribute("height"),
      href: image.getAttribute("href"),
    };
  });
const imageBounds = async (page, index = -1) =>
  page.evaluate((index) => {
    const groups = [
      ...document.querySelectorAll('#additions [data-kind="image"]'),
    ];
    const group = groups.at(index);
    if (!group) return null;
    const image = group.querySelector("image");
    return {
      x: +image.getAttribute("x"),
      y: +image.getAttribute("y"),
      w: +image.getAttribute("width"),
      h: +image.getAttribute("height"),
      href: image.getAttribute("href"),
    };
  }, index);
const clickAt = async (page, point, button = "left") => {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(40);
  const ghost = await ghostBounds(page);
  await page.mouse.down({ button });
  await page.mouse.up({ button });
  await page.waitForTimeout(80);
  return ghost;
};
const ready = async (page, index) =>
  page.waitForFunction(
    (index) =>
      document.querySelector("#page").dataset.rendered === String(index) &&
      document.querySelector("#page").getAttribute("aria-busy") === "false",
    index,
  );
const go = async (page, index) => {
  await page.locator("#page-number").selectOption({ value: String(index) });
  await ready(page, index);
};
const assertSameBounds = (actual, expected, label) => {
  assert(actual, label + ": the committed stamp is missing");
  assert(expected, label + ": the placement ghost is missing");
  for (const key of ["x", "y", "w", "h"])
    assert(
      Math.abs(actual[key] - expected[key]) < 0.01,
      `${label}: the ghost and committed ${key} differ`,
    );
};
async function desktopJourney() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    requests = [],
    errors = [];
  page.on("request", (request) =>
    requests.push({ url: request.url(), method: request.method() }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator("#pdf-file").setInputFiles(fixture);
  await ready(page, 0);
  let baseline = await boxes(page);

  // 1. Click Signature: a floating picker, not an expanding toolbar or a
  // surprise file chooser. Nothing under it may move.
  let fileChooserOpened = false;
  page.once("filechooser", () => (fileChooserOpened = true));
  await openPicker(page);
  await page.waitForTimeout(250);
  assert.equal(fileChooserOpened, false, "Opening the picker is not a file chooser");
  await assertStationary(page, baseline, "desktop: open empty picker");
  await page.screenshot({ path: output + "/desktop-1-empty-picker.png" });

  // 2. Import the first fictional transparent signature.
  await importSignature(page, firstSignature, 1);
  await assertStationary(page, baseline, "desktop: import first signature");
  assert.equal(
    await page.locator("#signature-button-thumb").isVisible(),
    true,
    "The compact toolbar control keeps the chosen stamp visible",
  );
  assert.match(
    await page.locator("#signature").getAttribute("aria-label"),
    /Signature 1/,
  );
  assert.equal(
    await page.locator('#additions [data-kind="image"]').count(),
    0,
    "Import selects a stamp without placing one",
  );

  // 3. The same control closes the floating picker without changing tools.
  await openPicker(page);
  await page.locator("#signature").click();
  await page.waitForTimeout(100);
  assert.equal(
    await pickerOpen(page),
    false,
    "Clicking Signature again closes the picker",
  );
  await assertStationary(page, baseline, "desktop: close picker with Signature");

  // 4. The picker shows the real transparent image, not a token thumbnail.
  await openPicker(page);
  await assertStationary(page, baseline, "desktop: reopen picker");
  const preview = await page.evaluate(async () => {
    const image = document.querySelector("#signature-preview-image");
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let clear = 0,
      painted = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] === 0) clear++;
      else painted++;
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      clear,
      painted,
      total: data.length / 4,
      renderedHeight: image.getBoundingClientRect().height,
      alt: image.alt,
    };
  });
  assert(preview.width > 200 && preview.height > 50, "The preview is usefully large");
  assert(preview.renderedHeight >= 50, "The preview is visibly sized");
  assert(preview.clear > 0, "The preview preserves transparent pixels");
  assert(preview.painted > 0, "The preview is not blank");
  assert.match(preview.alt, /signature/i);
  assert(Math.abs(preview.width / preview.height - 3.3693) < 0.03);
  await page.screenshot({ path: output + "/desktop-2-preview.png" });

  // 4. Small stamp: preview and placement use the same bounds.
  await page.locator('[data-stamp-scale="0.7"]').click();
  await page.locator(".stamp-option").first().click();
  assert.equal(await pickerOpen(page), false);
  await assertStationary(page, baseline, "desktop: choose small stamp");
  let point = await pagePoint(page, 0.24, 0.22);
  let ghost = await clickAt(page, point);
  let last = await imageBounds(page);
  assertSameBounds(last, ghost, "desktop small stamp");
  assert(last.w < 180, "Small stamps start below the default width");
  await page.mouse.move(point.x + 2, point.y + 2);
  await page.waitForTimeout(80);
  await page.screenshot({ path: output + "/desktop-3-placement-ghost.png" });
  await page.waitForTimeout(300);
  assertSameBounds(await imageBounds(page), last, "desktop small stamp after settle");

  // 5. Repeat at a second location without reopening the picker.
  point = await pagePoint(page, 0.62, 0.3);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(50);
  const repeatGhost = await ghostBounds(page);
  assert(repeatGhost, "Hovering shows the actual signature ghost");
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#additions [data-kind="image"]').count(), 2);
  assertSameBounds(await imageBounds(page), repeatGhost, "desktop repeated stamp");

  // 6. Add a second signature and switch to it.
  await importSignature(page, secondSignature, 2);
  await assertStationary(page, baseline, "desktop: import second signature");
  assert.equal(await page.locator("#signature-list li").count(), 2);
  const signatureThumbnails = await page.evaluate(() =>
    [...document.querySelectorAll("#signature-list img")].map((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
  );
  assert.equal(signatureThumbnails.length, 2);
  assert(
    signatureThumbnails.every((image) => image.width > 20 && image.height > 10),
    "Both fictional signatures decode",
  );
  await openPicker(page);
  await page.locator('[data-stamp-scale="1"]').click();
  await page.locator(".stamp-option").nth(1).click();
  assert.equal(await pickerOpen(page), false);
  assert.equal(await page.locator("#page").getAttribute("data-tool"), "image");
  const secondFingerprint = await page
    .locator("#signature-button-thumb")
    .getAttribute("src");
  point = await pagePoint(page, 0.48, 0.38);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(60);
  ghost = await ghostBounds(page);
  assert.equal(ghost.href, secondFingerprint, "The ghost uses the selected PNG");
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
  assertSameBounds(await imageBounds(page), ghost, "desktop second signature");
  assert.equal(await page.locator('#additions [data-kind="image"]').count(), 3);

  // 7. Large is a real, bounded new-stamp preference; existing copies keep
  // their committed geometry.
  const widthsBeforeSizeChange = await page.evaluate(() =>
    [...document.querySelectorAll('#additions [data-kind="image"] image')].map(
      (image) => +image.getAttribute("width"),
    ),
  );
  await openPicker(page);
  await page.locator('[data-stamp-scale="1.45"]').click();
  assert.equal(
    await page.locator('[data-stamp-scale="1.45"]').getAttribute("aria-pressed"),
    "true",
  );
  await page.locator(".stamp-option").first().click();
  point = await pagePoint(page, 0.67, 0.53);
  ghost = await clickAt(page, point);
  last = await imageBounds(page);
  assertSameBounds(last, ghost, "desktop large stamp");
  assert(
    last.w > Math.max(...widthsBeforeSizeChange) * 1.3,
    "Large makes new stamps meaningfully larger",
  );
  const widthsAfter = await page.evaluate(() =>
    [...document.querySelectorAll('#additions [data-kind="image"] image')].map(
      (image) => +image.getAttribute("width"),
    ),
  );
  assert.deepEqual(
    widthsAfter.slice(0, widthsBeforeSizeChange.length),
    widthsBeforeSizeChange,
    "Changing new-stamp size never moves committed stamps",
  );

  // 8. Different pages and zoom levels, including the rotated page and the
  // image-only scan.
  await go(page, 1);
  await page.locator("#zoom-in").click();
  await ready(page, 1);
  await chooseStamp(page, 1);
  point = await pagePoint(page, 0.35, 0.3);
  ghost = await clickAt(page, point);
  assertSameBounds(await imageBounds(page), ghost, "desktop page 2 zoomed stamp");
  await go(page, 2);
  await chooseStamp(page, 1);
  point = await pagePoint(page, 0.45, 0.35);
  ghost = await clickAt(page, point);
  assertSameBounds(await imageBounds(page), ghost, "desktop rotated page stamp");
  await go(page, 3);
  await chooseStamp(page, 0);
  point = await pagePoint(page, 0.45, 0.35);
  ghost = await clickAt(page, point);
  assertSameBounds(await imageBounds(page), ghost, "desktop scan page stamp");
  assert.equal(
    await page.locator('#additions [data-kind="image"]').count(),
    1,
    "The scan page holds its own stamp only",
  );
  await go(page, 0);
  assert.equal(await page.locator('#additions [data-kind="image"]').count(), 4);

  // 9. Page boundaries clamp the visible ghost and do not move after commit.
  await page.locator("#workspace").evaluate((element) => (element.scrollTop = 0));
  await page.locator("#workspace").evaluate((element) => (element.scrollLeft = 0));
  let box = await page.locator("#page").boundingBox();
  point = { x: box.x + 2, y: box.y + 2 };
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(50);
  ghost = await ghostBounds(page);
  assert(ghost.x >= 0 && ghost.y >= 0, "The ghost clamps at the top-left page edge");
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
  last = await imageBounds(page);
  assertSameBounds(last, ghost, "desktop top-left boundary stamp");
  assert(last.x >= 0 && last.y >= 0);
  await page.locator("#workspace").evaluate(
    (element) => (element.scrollTop = element.scrollHeight),
  );
  box = await page.locator("#page").boundingBox();
  point = {
    x: box.x + box.width - 2,
    y: box.y + box.height - 2,
  };
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(50);
  ghost = await ghostBounds(page);
  assert(ghost, "The bottom-right ghost exists");
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
  last = await imageBounds(page);
  assertSameBounds(last, ghost, "desktop bottom-right boundary stamp");
  const pageSize = await page.evaluate(() => {
    const viewBox = document.querySelector("#additions").getAttribute("viewBox").split(" ");
    return { width: +viewBox[2], height: +viewBox[3] };
  });
  assert(last.x >= 0 && last.y >= 0);
  assert(
    last.x + last.w <= pageSize.width + 0.01 &&
      last.y + last.h <= pageSize.height + 0.01,
    "A boundary stamp stays inside the page",
  );

  // 10. Select, move, proportionally resize and remove a placed stamp.
  await page.locator('button[data-tool="select"]').click();
  const stamp = page.locator('#additions [data-kind="image"]').first();
  await stamp.click();
  const selection = JSON.parse(
    await page.locator("#additions .selection-outline").getAttribute("data-page-space"),
  );
  assert(selection.w >= 24 && selection.h >= 8);
  box = await stamp.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2 + 18, {
    steps: 8,
  });
  await page.mouse.up();
  const moved = JSON.parse(
    await page.locator("#additions .selection-outline").getAttribute("data-page-space"),
  );
  assert(moved.x > selection.x || moved.y > selection.y, "A stamp can be moved");
  const handle = page.locator("#additions .handle");
  await handle.scrollIntoViewIfNeeded();
  box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 26, box.y + box.height / 2 + 8, {
    steps: 8,
  });
  await page.mouse.up();
  const resized = JSON.parse(
    await page.locator("#additions .selection-outline").getAttribute("data-page-space"),
  );
  assert(resized.w > moved.w, "A stamp can be resized");
  assert(
    Math.abs(resized.w / resized.h - moved.w / moved.h) < 0.03,
    "A stamp resizes proportionally",
  );
  const countBeforeDelete = await page.locator('#additions [data-kind="image"]').count();
  await page.keyboard.press("Delete");
  assert.equal(
    await page.locator('#additions [data-kind="image"]').count(),
    countBeforeDelete - 1,
    "Delete removes the selected stamp",
  );
  await page.screenshot({ path: output + "/desktop-4-selected-stamp.png" });

  // 11. Removing from the picker never removes placed copies.
  const placedBeforeRemove = await page.locator('#additions [data-kind="image"]').count();
  await openPicker(page);
  await page.locator(".stamp-remove").first().click();
  assert.equal(await page.locator("#signature-list li").count(), 1);
  assert.equal(
    await page.locator('#additions [data-kind="image"]').count(),
    placedBeforeRemove,
    "Removing a picker signature keeps placed copies",
  );
  await page.keyboard.press("Escape");
  assert.equal(await pickerOpen(page), false);

  // 12. Keyboard and Escape. The picker must close without changing tools or
  // shifting the workspace, and Enter can still place the active stamp.
  await page.locator('button[data-tool="select"]').click();
  baseline = await boxes(page);
  await page.keyboard.press("s");
  await assertPickerOpen(page);
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains("stamp-option"),
  );
  await assertStationary(page, baseline, "desktop: keyboard opens picker");
  await page.keyboard.press("Escape");
  assert.equal(await pickerOpen(page), false);
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "signature",
    "Escape returns focus to Signature",
  );
  await assertStationary(page, baseline, "desktop: keyboard closes picker");
  const beforeKeyboardStamp = await page.locator('#additions [data-kind="image"]').count();
  await page.keyboard.press("s");
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains("stamp-option"),
  );
  await page.keyboard.press("Enter");
  assert.equal(await pickerOpen(page), false);
  assert.equal(await page.locator("#page").getAttribute("data-tool"), "image");
  await page.waitForFunction(
    () => document.activeElement?.id === "page",
    null,
    { timeout: 2000 },
  );
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator('#additions [data-kind="image"]').count(),
    beforeKeyboardStamp + 1,
    "Keyboard Enter places the active stamp",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#page").getAttribute("data-tool"), "select");

  // 13. No PDF or signature bytes leave the browser and nothing is persisted.
  const external = requests.filter((request) => !request.url.startsWith(origin));
  assert.deepEqual(external, [], "The focused journey only requests the app origin");
  assert.equal(
    requests.some((request) => request.method === "POST"),
    false,
    "No document or signature is uploaded",
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookies: document.cookie,
    })),
    { local: 0, session: 0, cookies: "" },
    "Signatures are not written to browser storage",
  );
  assert.deepEqual(errors, [], "No page errors during the journey");
  receipt.checks.desktop_signature_journey = "pass";
  receipt.checks.desktop_layout_stationary = "pass";
  receipt.checks.keyboard_and_escape = "pass";

  // 14. Export, print the same bytes, and reopen through the public UI.
  await page.locator('button[data-tool="select"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save").click();
  const download = await downloadPromise,
    completed = output + "/signature-completed.pdf";
  await download.saveAs(completed);
  const completedBytes = readFileSync(completed);
  receipt.downloaded_pdf_sha256 = createHash("sha256")
    .update(completedBytes)
    .digest("hex");
  await page.locator("#print").click();
  await page.locator("#print-frame").waitFor({ state: "attached" });
  const printBytes = await page.evaluate(async () =>
    Array.from(
      new Uint8Array(
        await (
          await fetch(document.querySelector("#print-frame").src)
        ).arrayBuffer(),
      ),
    ),
  );
  writeFileSync(output + "/signature-print.pdf", Buffer.from(printBytes));
  assert.equal(
    createHash("sha256").update(Buffer.from(printBytes)).digest("hex"),
    receipt.downloaded_pdf_sha256,
    "Print receives the completed exported bytes",
  );
  receipt.checks.print_uses_completed_pdf = "pass";
  const reopened = await context.newPage();
  await reopened.goto(origin);
  await reopened.locator("#pdf-file").setInputFiles(completed);
  await ready(reopened, 0);
  assert.equal(
    await reopened.locator("#page-number option").count(),
    4,
    "The completed PDF reopens with all four pages",
  );
  await reopened.locator("#page-number").selectOption({ value: "1" });
  await ready(reopened, 1);
  await reopened.screenshot({ path: output + "/desktop-5-reopened-export.png" });
  assert.equal(
    await reopened.locator('#additions [data-kind="image"]').count(),
    0,
    "Reopening flattens stamps into ordinary page content",
  );
  receipt.checks.reopened_completed_pdf = "pass";
  await reopened.close();
  await context.close();
}

async function phoneJourney() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    client = await context.newCDPSession(page);
  await page.goto(origin);
  await page.locator("#pdf-file").setInputFiles(fixture);
  await ready(page, 0);
  let baseline = await boxes(page);
  await page.locator("#signature").tap();
  await assertPickerOpen(page);
  await assertStationary(page, baseline, "phone: open picker");
  const picker = await page.locator("#signature-tray").boundingBox(),
    pageBar = await page.locator(".page-bar").boundingBox();
  assert(
    picker.y + picker.height <= pageBar.y + 0.5,
    "The phone picker sits above the page controls",
  );
  await page.screenshot({ path: output + "/phone-1-picker.png" });
  await page.locator("#signature-file").setInputFiles(firstSignature);
  await page.waitForFunction(
    () => document.querySelector("#page").dataset.tool === "image",
  );
  assert.equal(await pickerOpen(page), false);
  await assertStationary(page, baseline, "phone: import signature");
  await page.locator("#signature").tap();
  await page.locator('[data-stamp-scale="1"]').click();
  await page.locator(".stamp-option").first().click();
  assert.equal(await pickerOpen(page), false);
  await assertStationary(page, baseline, "phone: choose stamp");

  const touch = (type, points) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })),
    });
  const point = await pagePoint(page, 0.38, 0.34);
  await touch("touchStart", [[point.x, point.y]]);
  for (let step = 1; step <= 8; step++)
    await touch("touchMove", [
      [point.x + step * 2, point.y + step],
    ]);
  await page.waitForTimeout(80);
  const callout = await page.locator("#stamp-callout").boundingBox();
  assert(callout, "Touch drag shows a lifted signature preview");
  assert(
    callout.y + callout.height <= point.y + 9,
    "The touch preview is not hidden under the finger",
  );
  const touchGhost = await ghostBounds(page);
  assert(touchGhost, "Touch drag shows the exact placement footprint");
  await page.screenshot({ path: output + "/phone-2-touch-drag.png" });
  await touch("touchEnd", []);
  await page.waitForFunction(
    () => document.querySelectorAll('#additions [data-kind="image"]').length === 1,
  );
  assertSameBounds(await imageBounds(page), touchGhost, "phone touch stamp");
  assert.equal(
    await page.locator("#stamp-callout").isVisible(),
    false,
    "The touch preview disappears after release",
  );
  await page.screenshot({ path: output + "/phone-3-touch-stamped.png" });

  // Repeating never reopens the picker.
  const repeat = await pagePoint(page, 0.55, 0.42);
  await page.touchscreen.tap(repeat.x, repeat.y);
  await page.waitForFunction(
    () => document.querySelectorAll('#additions [data-kind="image"]').length === 2,
  );

  // Tapping the page while the picker is open only dismisses it.
  await page.locator("#signature").tap();
  await assertPickerOpen(page);
  const pickerBox = await page.locator("#signature-tray").boundingBox();
  const dismiss = await pagePoint(page, 0.6, 0.08);
  assert(
    dismiss.y < pickerBox.y,
    "The dismiss tap lands on visible page outside the picker",
  );
  await page.touchscreen.tap(dismiss.x, dismiss.y);
  await page.waitForTimeout(120);
  assert.equal(await pickerOpen(page), false);
  assert.equal(
    await page.locator('#additions [data-kind="image"]').count(),
    2,
    "Dismissing the picker never stamps accidentally",
  );

  // Page boundary and a different page/zoom.
  await page.locator("#workspace").evaluate((element) => (element.scrollTop = 0));
  let box = await page.locator("#page").boundingBox();
  await page.touchscreen.tap(box.x + 1, box.y + 1);
  await page.waitForFunction(
    () => document.querySelectorAll('#additions [data-kind="image"]').length === 3,
  );
  let last = await imageBounds(page);
  assert(last.x >= 0 && last.y >= 0, "Phone boundary stamp stays on the page");
  await go(page, 1);
  await page.locator("#zoom-in").tap();
  await ready(page, 1);
  const zoomed = await pagePoint(page, 0.45, 0.4);
  await page.touchscreen.tap(zoomed.x, zoomed.y);
  await page.waitForFunction(
    () => document.querySelectorAll('#additions [data-kind="image"]').length === 1,
  );
  await page.screenshot({ path: output + "/phone-4-second-page-zoom.png" });
  await go(page, 0);
  baseline = await boxes(page);
  await page.locator("#signature").tap();
  await assertPickerOpen(page);
  await assertStationary(page, baseline, "phone: open picker after zoom");
  await page.locator("#signature").tap();
  await page.waitForTimeout(120);
  assert.equal(
    await pickerOpen(page),
    false,
    "The Signature control toggles the picker closed",
  );
  await assertStationary(page, baseline, "phone: close picker after zoom");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    "The phone layout has no horizontal overflow",
  );
  receipt.checks.phone_signature_journey = "pass";
  receipt.checks.phone_layout_stationary = "pass";
  receipt.checks.touch_press_drag_release = "pass";
  await context.close();
}

try {
  await desktopJourney();
  await phoneJourney();
  writeFileSync(
    output + "/signature-receipt.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await browser.close();
  server.close();
}
