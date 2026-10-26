import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const output = path.resolve(
  process.env.PAPERWORK_EVIDENCE || "output/acceptance",
);
mkdirSync(output, { recursive: true });
const fixture = path.resolve("tests/fixtures/paperwork-fixtures"),
  file = fixture + "/paperwork-lab-interactive-mixed.pdf";
const expected = JSON.parse(
  readFileSync(fixture + "/expected-fields-example.json", "utf8"),
);
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
const server = createServer((req, res) => {
  let name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (name === "/") name = "/index.html";
  const file = path.resolve("dist", "." + name);
  if (!file.startsWith(path.resolve("dist") + path.sep) || !existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    types[path.extname(file)] || "application/octet-stream",
  );
  res.setHeader(
    "Content-Security-Policy",
    readFileSync("public/_headers", "utf8")
      .split("\n")
      .find((x) => x.includes("Content-Security-Policy"))
      .split("Content-Security-Policy: ")[1],
  );
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base =
  process.env.PAPERWORK_ORIGIN || `http://127.0.0.1:${server.address().port}`;
const browsers = [];
let activePage;
// The local launcher is app-owned markup plus a reviewed shared controller. Check
// the actual Apps menu on the real page: one searched LDraw result, its local
// tile, its destination and the documented keyboard paths, without navigating.
async function checkLdrawAppsMenu(page, label, open) {
  const dialog = page.locator("#app-navigation");
  const search = dialog.locator('input[type="search"]');
  await open();
  assert.equal(
    await dialog.evaluate((el) => el.open),
    true,
    label + ": the Apps menu opens",
  );
  await search.fill("LDraw");
  const rows = dialog.locator(
    '[data-destination][data-launcher-group="apps"]:not([hidden])',
  );
  assert.equal(
    await rows.count(),
    1,
    label + ": searching LDraw returns exactly one app row",
  );
  const row = rows.first();
  const link = row.locator("a");
  assert.equal(
    await link.getAttribute("href"),
    "https://ldraw.loftwah.com/",
    label + ": LDraw links to its own application",
  );
  const tile = row.locator("img");
  assert.equal(
    await tile.getAttribute("src"),
    "/brand/apps/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96.webp",
    label + ": the local tile is used",
  );
  assert.equal(await tile.getAttribute("alt"), "");
  await page.waitForFunction(
    () =>
      [
        ...document.querySelectorAll(
          '#app-navigation [data-destination] img[src$="ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96.webp"]',
        ),
      ].some((img) => img.complete && img.naturalWidth > 0),
    null,
    { timeout: 10000 },
  );
  const decoded = await tile.evaluate((img) => ({
    width: img.naturalWidth,
    height: img.naturalHeight,
  }));
  assert.ok(
    decoded.width > 0 && decoded.height > 0,
    label + ": the tile decodes",
  );
  assert.equal(
    (await dialog.locator('[role="status"]').textContent()).trim(),
    "1 destination",
  );
  // Arrow keys select the visible result; ordinary typing returns to search.
  await dialog.locator("[data-close-apps]").focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await row.evaluate((el) => el.dataset.active),
    "true",
    label + ": ArrowDown selects the LDraw row",
  );
  await page.keyboard.press("l");
  assert.equal(
    await search.evaluate((el) => el === document.activeElement),
    true,
    label + ": typing after arrow selection returns to search",
  );
  await search.fill("LDraw");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    label + ": the open menu does not overflow horizontally",
  );
  const screenshot = output + "/apps-menu-" + label + ".png";
  await page.screenshot({ path: screenshot });
  await page.keyboard.press("Escape");
  assert.equal(
    await dialog.evaluate((el) => el.open),
    false,
    label + ": Escape closes a nonempty search",
  );
  return {
    search: "LDraw",
    visible_app_rows: 1,
    status: "1 destination",
    href: "https://ldraw.loftwah.com/",
    tile: decoded,
    keyboard: "ArrowDown selects, typing returns to search, Escape closes",
    screenshot: path.basename(screenshot),
  };
}
const receipt = {
  source_sha: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  url: base,
  checks: {},
  known_limitations: [
    "Physical iPhone, real printer dialog and unfamiliar human acceptance not exercised.",
    "The supplied corpus has no genuine XFA or certificate-signed fixture.",
  ],
};
try {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
      : { channel: "chrome" }),
  });
  browsers.push(browser);
  receipt.browser = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = (activePage = await context.newPage()),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method(), body: r.postData() }),
  );
  await page.goto(base);
  await page.locator(".press-illustration img").evaluate((img) => img.decode());
  const publicTitle =
    JSON.parse(readFileSync("public/paperwork.json", "utf8")).title +
    " — Fill, sign and edit PDFs in your browser";
  assert.equal(await page.title(), publicTitle);
  if (existsSync("site.json")) {
    const publicOrigin = JSON.parse(readFileSync("site.json", "utf8")).origin;
    const metadata = await page.evaluate(() => ({
      canonical: document.querySelector('link[rel="canonical"]').href,
      schema: JSON.parse(
        document.querySelector('script[type="application/ld+json"]')
          .textContent,
      ),
      image: document.querySelector('meta[property="og:image"]').content,
    }));
    assert.equal(metadata.canonical, publicOrigin + "/");
    assert.equal(metadata.schema.url, publicOrigin + "/");
    assert.equal(
      metadata.image,
      publicOrigin + "/social/paperwork-20261024.png",
    );
    receipt.checks.static_and_rendered_search_sharing_metadata = "pass";
  }

  assert.equal(await page.locator("#save").isVisible(), false);
  await page.screenshot({ path: output + "/welcome-desktop-dark.png" });
  await page.locator("#theme").click();
  await page.screenshot({ path: output + "/welcome-desktop-light.png" });
  await page.locator("#theme").click();
  await page.locator(".shortcuts-trigger").click();
  assert(
    await page
      .locator("#shortcuts")
      .evaluate((node) => node.matches(":popover-open")),
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .locator("#shortcuts")
      .evaluate((node) => node.matches(":popover-open")),
    false,
  );
  await page.locator("#pdf-file").setInputFiles(file);
  const ready = async (n) =>
    page.waitForFunction(
      (n) =>
        document.querySelector("#page").dataset.rendered === String(n) &&
        document.querySelector("#page").getAttribute("aria-busy") === "false",
      n,
    );
  await ready(0);
  const desktopSpace = await page
    .locator("#workspace")
    .evaluate((el) => ({ height: el.clientHeight, viewport: innerHeight }));
  assert(
    desktopSpace.height / desktopSpace.viewport >= 0.8,
    "Desktop document should own at least 80% of the viewport",
  );
  assert.equal(await page.locator(".context-bar").isVisible(), true);
  assert.equal(await page.locator("#active-tool").textContent(), "Select");
  assert.equal(await page.locator("footer").isVisible(), false);
  await page.locator('button[data-tool="pen"]').click();
  assert.equal(await page.locator(".context-bar").isVisible(), true);
  assert.equal(await page.locator("#active-tool").textContent(), "Pen");
  await page.locator("#more-actions").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#page").getAttribute("data-tool"), "pen");
  await page.locator('button[data-tool="select"]').click();
  receipt.checks.compact_desktop_document_space = desktopSpace;
  receipt.checks.apps_menu_ldraw_desktop = await checkLdrawAppsMenu(
    page,
    "desktop",
    () => page.locator("[data-open-apps]").click(),
  );

  await page.waitForFunction(
    () => document.querySelector("#document-state").dataset.state === "ready",
  );
  await page.locator('[data-field="full_name"]').fill("Temporary polish check");
  assert.equal(
    await page.locator("#document-state").getAttribute("data-state"),
    "changed",
  );
  assert(await page.locator("#undo").isEnabled());
  await page.locator("#undo").click();
  assert.equal(
    await page.locator("#document-state").getAttribute("data-state"),
    "ready",
  );
  await page.locator("#redo").click();
  assert.equal(
    await page.locator("#document-state").getAttribute("data-state"),
    "changed",
  );
  await page.locator("#undo").click();
  const originalName = await page
    .locator('[data-field="full_name"]')
    .inputValue();
  await page.locator('[data-field="full_name"]').fill("Clear-menu regression");
  await page.locator("#more-actions").click();
  await page.locator("#clear-field").click();
  assert.equal(await page.locator('[data-field="full_name"]').inputValue(), "");
  await page.locator("#undo").click();
  assert.equal(
    await page.locator('[data-field="full_name"]').inputValue(),
    "Clear-menu regression",
  );
  await page.locator("#undo").click();
  assert.equal(
    await page.locator('[data-field="full_name"]').inputValue(),
    originalName,
  );
  // Inline clear is discoverable without opening More, and stays undoable.
  await page.locator('[data-field="contact_email"]').focus();
  assert(await page.locator("#clear-field-inline").isVisible());
  await page.locator("[data-field=contact_email]").fill("Not the final answer");
  await page.locator("#clear-field-inline").click();
  assert.equal(
    await page.locator('[data-field="contact_email"]').inputValue(),
    "",
  );
  await page.locator("#undo").click();
  await page.screenshot({ path: output + "/desktop-fields.png" });

  // Text stays active across several entries; Done does not switch tools.
  await page.locator('button[data-tool="text"]').click();
  const textPoint = await coords(245, 400);
  await page.mouse.move(textPoint.x, textPoint.y);
  assert((await page.locator("#tool-preview *").count()) > 0);
  await tap(245, 400);
  await page.locator("#text-content").fill("First sticky note");
  await page.locator("#finish-text").click();
  assert.equal(await page.locator("#page").getAttribute("data-tool"), "text");
  assert.equal(await page.locator("#active-tool").textContent(), "Text");
  await tap(245, 430);
  await page.locator("#text-content").fill("Second sticky note");
  await page.locator("#finish-text").click();
  assert.equal(
    await page.locator('#additions [data-kind="text"]').count(),
    2,
  );
  await page.locator("#undo").click();
  await page.locator("#undo").click();
  assert.equal(
    await page.locator('#additions [data-kind="text"]').count(),
    0,
  );
  await page.locator('button[data-tool="select"]').click();

  // Tick preview uses the exact committed geometry.
  await page.locator('button[data-tool="tick"]').click();
  const tickPoint = await coords(430, 390);
  await page.mouse.move(tickPoint.x, tickPoint.y);
  const previewTick = await page
    .locator("#tool-preview polyline")
    .getAttribute("points");
  await page.mouse.down();
  await page.mouse.up();
  const committedTick = await page
    .locator('#additions [data-kind="tick"] polyline')
    .last()
    .getAttribute("points");
  assert.equal(previewTick, committedTick);
  await page.locator("#undo").click();
  await page.locator('button[data-tool="select"]').click();

  // A drag creates a true circle and leaves Circle active for the next one.
  await page.locator('button[data-tool="circle"]').click();
  const circleStart = await coords(320, 460),
    circleEnd = await coords(420, 545);
  await page.mouse.move(circleStart.x, circleStart.y);
  await page.mouse.down();
  await page.mouse.move(circleEnd.x, circleEnd.y, { steps: 8 });
  await page.mouse.up();
  assert.equal(
    await page.locator('#additions [data-kind="circle"]').count(),
    1,
  );
  assert.equal(
    await page.locator("#page").getAttribute("data-tool"),
    "circle",
  );
  assert.equal(
    await page.locator("#active-tool").textContent(),
    "Circle",
  );
  await page.locator('button[data-tool="select"]').click();
  receipt.checks.sticky_tools_preview_circle_and_clear_field = "pass";
  assert(await page.locator('[data-field="immutable_id"]').isDisabled());
  assert.equal(
    await page
      .locator('[data-field="reference_code"]')
      .getAttribute("maxlength"),
    "12",
  );
  for (const key of [
    "full_name",
    "reference_code",
    "contact_email",
    "comments",
  ]) {
    await page
      .locator(`[data-field="${key}"]`)
      .fill(
        "Temporary fictional answer".slice(
          0,
          key === "reference_code" ? 12 : 100,
        ),
      );
    await page.locator(`[data-field="${key}"]`).fill(expected[key]);
  }
  await page.locator('[data-field="subscribe"]').check();
  await page.locator('[data-field="subscribe"]').uncheck();
  await page.locator('[data-field="subscribe"]').check();
  await page.locator('[data-field="terms_seen"]').uncheck();
  await page.locator('[data-field="terms_seen"]').check();
  await page.locator('[data-field="terms_seen"]').uncheck();
  await page.locator('[data-field="contact_method"][value="Post"]').check();
  await page.locator('[data-field="contact_method"][value="InPerson"]').check();
  await page.locator('[data-field="delivery_window"]').selectOption("Morning");
  await page.locator('[data-field="delivery_window"]').selectOption("Evening");
  await page.locator('[data-field="document_type"]').selectOption("Amendment");
  await page.locator('[data-field="document_type"]').selectOption("Follow-up");
  const go = async (n) => {
    await page.locator("#page-number").focus();
    await page.locator("#page-number").selectOption({ value: String(n) });
    console.log(
      "Page navigation",
      n,
      await page.locator("#page-number").inputValue(),
    );
    await ready(n);
  };
  await go(1);
  await page.locator("#zoom-in").click();
  await ready(1);
  const manualZoom = await page.locator("#zoom-label").textContent();
  await go(2);
  assert.equal(
    await page.locator("#zoom-label").textContent(),
    manualZoom,
    "Manual zoom should survive a page change",
  );
  await page.locator("#fit").click();
  await ready(2);
  await go(1);
  receipt.checks.zoom_persists_between_pages = "pass";
  await page.locator('[data-field="case_note"]').fill("Before the pen");
  async function coords(x, y) {
    await page.locator("#workspace").evaluate((el, y) => {
      el.scrollTop = Math.max(
        0,
        (y * parseFloat(document.querySelector("#page").style.width)) / 595 -
          220,
      );
    }, y);
    const box = await page.locator("#page").boundingBox();
    const scale =
      box.width /
      (await page.locator("#additions").getAttribute("viewBox")).split(" ")[2];
    return { x: box.x + x * scale, y: box.y + y * scale };
  }
  async function tap(x, y) {
    const p = await coords(x, y);
    await page.mouse.click(p.x, p.y);
  }
  async function stroke(points, tool = "pen") {
    await page.locator(`button[data-tool="${tool}"]`).click();
    await coords(points[0][0], points[0][1]);
    const box = await page.locator("#page").boundingBox(),
      v = (await page.locator("#additions").getAttribute("viewBox")).split(" "),
      s = box.width / Number(v[2]);
    await page.mouse.move(box.x + points[0][0] * s, box.y + points[0][1] * s);
    await page.mouse.down();
    for (const [x, y] of points.slice(1))
      await page.mouse.move(box.x + x * s, box.y + y * s, { steps: 8 });
    await page.mouse.up();
  }
  async function text(x, y, value) {
    await page.locator('button[data-tool="text"]').click();
    await tap(x, y);
    await page.locator("#text-content").fill(value);
    await page.locator("#finish-text").click();
  }
  await stroke([
    [60, 500],
    [110, 486],
    [155, 500],
    [210, 483],
  ]);
  await stroke([
    [60, 530],
    [100, 520],
    [150, 530],
  ]);
  assert.equal(await page.locator("#additions [data-object]").count(), 2);
  await page.locator('button[data-tool="eraser"]').click();
  await tap(100, 520);
  assert.equal(await page.locator("#additions [data-object]").count(), 1);
  await page.locator("#undo").click();
  assert.equal(await page.locator("#additions [data-object]").count(), 2);
  await page.locator("#redo").click();
  assert.equal(await page.locator("#additions [data-object]").count(), 1);
  await stroke(
    [
      [330, 518],
      [400, 518],
      [520, 518],
    ],
    "highlight",
  );
  await text(60, 380, "Fictional note, corrected.");
  await page.locator('button[data-tool="tick"]').click();
  await tap(335, 385);
  await page.locator('button[data-tool="select"]').click();
  await page.locator('#additions [data-kind="text"]').last().click();
  const textSelection = JSON.parse(
    await page
      .locator("#additions .selection-outline")
      .getAttribute("data-page-space"),
  );
  assert(
    textSelection.w < 188,
    "Text selection should hug the rendered words, not the 190pt layout box",
  );
  await page.locator('#additions [data-kind="tick"]').click();
  const tickSelection = JSON.parse(
    await page
      .locator("#additions .selection-outline")
      .getAttribute("data-page-space"),
  );
  assert(
    tickSelection.w < 40,
    "Tick selection should hug the painted mark",
  );
  receipt.checks.tight_selection_bounds = "pass";
  const layoutNow = () =>
    page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return {
          x: +rect.x.toFixed(1),
          y: +rect.y.toFixed(1),
          w: +rect.width.toFixed(1),
          h: +rect.height.toFixed(1),
        };
      };
      return {
        toolbar: box(".toolbar"),
        page: box("#page"),
        pageBar: box(".page-bar"),
        scrollTop: document.querySelector("#workspace").scrollTop,
      };
    });
  const assertStationary = async (before, label) => {
    const after = await layoutNow();
    assert.deepEqual(after, before, `${label} must not move the workspace`);
  };
  const addSignatureFile = async (file) => {
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#add-signature").click();
    await (await chooser).setFiles(file);
  };
  const signatureLayout = await layoutNow();
  await page.locator("#signature").click();
  assert.equal(
    await page.locator("#signature-tray").evaluate((node) => node.matches(":popover-open")),
    true,
    "Signature opens a floating picker",
  );
  await page.screenshot({ path: output + "/signature-picker-empty.png" });
  await assertStationary(signatureLayout, "Opening the signature picker");
  await addSignatureFile(fixture + "/demo-signature-transparent.png");
  await page.waitForFunction(
    () => document.querySelector("#page").dataset.tool === "image",
  );
  assert.equal(await page.locator("#signature-list li").count(), 1);
  assert.equal(
    await page.locator("#signature-tray").evaluate((node) => node.matches(":popover-open")),
    false,
    "Importing a signature closes the picker",
  );
  await assertStationary(signatureLayout, "Importing a signature");
  await tap(150, 640);
  const secondSignatureLayout = await layoutNow();
  await page.locator("#signature").click();
  assert.equal(
    await page.locator("#signature-preview-image").evaluate((img) => img.naturalWidth > 20),
    true,
    "The picker shows a real preview of the selected signature",
  );
  await page.screenshot({ path: output + "/signature-picker-preview.png" });
  await addSignatureFile("public/examples/fictional-signature.png");
  await page.waitForFunction(
    () => document.querySelectorAll("#signature-list li").length === 2,
  );
  assert.equal(await page.locator("#signature-list li").count(), 2);
  await assertStationary(secondSignatureLayout, "Adding a second signature");
  await page.locator("#signature").click();
  await page.locator(".stamp-option").first().click();
  assert.equal(
    await page.locator("#signature-tray").evaluate((node) => node.matches(":popover-open")),
    false,
    "Choosing a signature closes the picker while keeping the stamp active",
  );
  assert.equal(await page.locator("#page").getAttribute("data-tool"), "image");
  await assertStationary(secondSignatureLayout, "Choosing a signature");
  await tap(420, 650);
  await page.locator("#signature").click();
  await page.locator(".stamp-remove").first().click();
  assert.equal(await page.locator("#signature-list li").count(), 1);
  assert.equal(
    await page.locator('#additions [data-kind="image"]').count(),
    2,
    "Removing a picker stamp must not remove placed copies",
  );
  receipt.checks.multi_signature_picker_and_remove = "pass";
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator("#signature-tray").evaluate((node) => node.matches(":popover-open")),
    false,
    "Escape closes the signature picker",
  );
  await page.locator('button[data-tool="select"]').click();
  let signature = page
    .locator("#additions [data-object]")
    .filter({ has: page.locator("image") })
    .first();
  await signature.scrollIntoViewIfNeeded();
  let box = await signature.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 55,
    box.y + box.height / 2 - 15,
    { steps: 10 },
  );
  await page.mouse.up();
  let handle = page.locator("#additions .handle");
  await handle.scrollIntoViewIfNeeded();
  box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 65,
    box.y + box.height / 2 + 20,
    { steps: 10 },
  );
  await page.mouse.up();
  const imageSelection = JSON.parse(
    await page
      .locator("#additions .selection-outline")
      .getAttribute("data-page-space"),
  );
  assert(
    Math.abs(imageSelection.w / imageSelection.h - 3.3693) < 0.03,
    "Signature selection and resizing should follow the visible alpha bounds",
  );
  receipt.checks.signature_alpha_bounds_and_proportional_resize = "pass";
  await page.locator('[data-field="case_note"]').fill(expected.case_note);
  await page.locator('[data-field="case_note"]').press("Tab");
  await page.screenshot({ path: output + "/desktop-mixed.png" });
  const mixedObjects = await page.locator("#additions [data-object]").count();
  assert.equal(mixedObjects, 6);
  await go(2);
  // Authored page-space target centres transformed to its displayed 90-degree coordinates.
  for (const [x, y] of [
    [337, 143],
    [337, 428],
    [337, 695],
  ]) {
    await stroke([
      [x - 14, y - 14],
      [x + 14, y + 14],
    ]);
    await stroke([
      [x + 14, y - 14],
      [x - 14, y + 14],
    ]);
    await text(x - 50, y + 25, "Rotation target");
  }
  await page.locator("#zoom-in").click();
  await ready(2);
  await page.locator("#zoom-out").click();
  await ready(2);
  await page.screenshot({ path: output + "/desktop-rotated.png" });
  await go(3);
  await text(85, 164, "Alex Example");
  await page.locator('button[data-tool="tick"]').click();
  await tap(346, 334);
  await stroke([
    [310, 295],
    [350, 278],
    [380, 295],
    [350, 312],
    [310, 295],
  ]);
  // The chosen stamp stays active after one copy; Select had resized the
  // previous copy, so reopen the picker and choose a stamp for this page.
  await page.locator("#signature").click();
  await page.locator(".stamp-option").first().click();
  await tap(175, 560);
  await page.screenshot({ path: output + "/desktop-scan.png" });
  await go(0);
  assert.equal(
    await page.locator('[data-field="full_name"]').inputValue(),
    expected.full_name,
  );
  assert.equal(
    await page
      .locator('[data-field="contact_method"][value="InPerson"]')
      .isChecked(),
    true,
  );
  await go(1);
  assert.equal(
    await page.locator('[data-field="case_note"]').inputValue(),
    expected.case_note,
  );
  assert.equal(
    await page.locator("#additions [data-object]").count(),
    mixedObjects,
  );
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save").click();
  const download = await downloadPromise;
  const completed = output + "/paperwork-lab-interactive-mixed-completed.pdf";
  await download.saveAs(completed);
  const completedBytes = readFileSync(completed);
  const savedForm = (await PDFDocument.load(completedBytes)).getForm();
  assert.match(
    savedForm.getTextField("comments").acroField.getDefaultAppearance(),
    /\s11 Tf/,
  );
  assert.match(
    savedForm.getDropdown("document_type").acroField.getDefaultAppearance(),
    /\s10 Tf/,
  );
  receipt.checks.native_appearance_size_preserved = "pass";
  receipt.downloaded_pdf_sha256 = createHash("sha256")
    .update(completedBytes)
    .digest("hex");
  receipt.checks.field_and_mixed_browser_journey = "pass";
  assert.equal(
    await page.locator("#document-state").getAttribute("data-state"),
    "downloaded",
  );
  receipt.checks.document_edit_export_state_and_pending_field_undo = "pass";
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (let i = 0; i < 3; i++) {
    await page.locator("#zoom-out").click();
    await ready(1);
  }
  await page.screenshot({ path: output + "/editor-overview.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Print must receive an independently generated *completed* PDF with identical document bytes.
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
  writeFileSync(output + "/print-completed.pdf", Buffer.from(printBytes));
  assert.equal(
    createHash("sha256").update(Buffer.from(printBytes)).digest("hex"),
    receipt.downloaded_pdf_sha256,
  );
  receipt.checks.print_uses_completed_pdf = "pass";
  assert.equal(
    await page.locator("#document-state").getAttribute("data-state"),
    "print",
  );
  assert.equal(await page.locator("#print-fallback").isVisible(), true);
  await page.locator('[data-field="case_note"]').fill("A later correction");
  assert.equal(await page.locator("#print-fallback").count(), 0);
  assert.equal(
    await page.locator("#document-state").getAttribute("data-state"),
    "changed",
  );
  await page.locator('[data-field="case_note"]').fill(expected.case_note);
  receipt.checks.stale_print_copy_removed_after_edit = "pass";
  // Mutate a real field during the asynchronous export, before it can publish a blob.
  await page.evaluate(() => {
    document.querySelector("#print").click();
    const field = document.querySelector('[data-field="case_note"]');
    field.value = "An edit made while preparing the PDF";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("edits changed"),
  );
  assert.equal(await page.locator("#print-fallback").count(), 0);
  assert.equal(await page.locator("#print-frame").count(), 0);
  assert.equal(
    await page.locator('[data-field="case_note"]').inputValue(),
    "An edit made while preparing the PDF",
  );
  await page.locator('[data-field="case_note"]').fill(expected.case_note);
  receipt.checks.edits_during_export_cannot_publish_stale_pdf = "pass";
  // Reopen the downloaded file through the same public UI and verify actual native values.
  await page.locator("#pdf-file").setInputFiles(completed);
  await ready(0);
  assert.equal(
    await page.locator('[data-field="full_name"]').inputValue(),
    expected.full_name,
  );
  await go(1);
  assert.equal(
    await page.locator('[data-field="case_note"]').inputValue(),
    expected.case_note,
  );
  await page.screenshot({ path: output + "/reopened-mixed.png" });
  // Failure recovery with unrelated unsaved work.
  await page.locator('[data-field="case_note"]').fill("Unsaved work retained");
  await page
    .locator("#pdf-file")
    .setInputFiles(fixture + "/negative-password-protected.pdf");
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("password"),
  );
  assert.equal(
    await page.locator('[data-field="case_note"]').inputValue(),
    "Unsaved work retained",
  );
  await page
    .locator("#pdf-file")
    .setInputFiles(fixture + "/negative-truncated.pdf");
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("damaged"),
  );
  assert.equal(
    await page.locator('[data-field="case_note"]').inputValue(),
    "Unsaved work retained",
  );
  receipt.checks.negative_cases_preserve_work = "pass";
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: (await indexedDB.databases()).length,
  }));
  assert.deepEqual(storage, { local: 0, session: 0, databases: 0 });
  assert.deepEqual(errors, []);
  writeFileSync(output + "/network.json", JSON.stringify(requests, null, 2));
  console.log(
    "Non-app requests",
    requests
      .filter(
        (r) =>
          r.method !== "GET" ||
          (!r.url.startsWith(base) && !r.url.startsWith("blob:")),
      )
      .map((r) => ({ url: r.url.slice(0, 180), method: r.method })),
  );
  assert.equal(
    requests.filter(
      (r) =>
        /^https?:/.test(r.url) &&
        (r.method !== "GET" || !r.url.startsWith(base)),
    ).length,
    0,
  );
  receipt.checks.no_document_egress_or_persistence = "pass";
  writeFileSync(output + "/network.json", JSON.stringify(requests, null, 2));
  // Properties use the same history/export model. Derive the regression in
  // memory from the actual completed corpus; never change the owner fixture.
  const metadataSource = await PDFDocument.load(completedBytes, {
    updateMetadata: false,
  });
  metadataSource.setTitle("Fictional source title");
  metadataSource.setAuthor("Original fictional author");
  metadataSource.setCreator("Fictional Fixture Maker");
  metadataSource.context
    .lookup(metadataSource.context.trailerInfo.Info)
    .set(
      PDFName.of("FictionalCustom"),
      PDFString.of("Fictional private property"),
    );
  const xml =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>FICTIONAL_XMP_AUTHOR_489</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>';
  metadataSource.catalog.set(
    PDFName.of("Metadata"),
    metadataSource.context.register(
      metadataSource.context.stream(xml, { Type: "Metadata", Subtype: "XML" }),
    ),
  );
  await page.locator("#pdf-file").setInputFiles({
    name: "Fictional metadata.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await metadataSource.save()),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#page").dataset.rendered === "0" &&
      document.querySelector("#page").getAttribute("aria-busy") === "false",
  );
  const openProperties = async (target) => {
    await target.locator("#more-actions").click();
    await target.locator("#properties").click();
    await target.locator("#properties-dialog").waitFor({ state: "visible" });
  };
  await openProperties(page);
  assert.equal(
    await page.locator("#property-author").inputValue(),
    "Original fictional author",
  );
  assert(
    (await page.locator("#property-details").textContent()).includes(
      "FICTIONAL_XMP_AUTHOR_489",
    ),
  );
  await page.evaluate(
    (bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], "Another fictional PDF.pdf", {
          type: "application/pdf",
        }),
      );
      window.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
      );
    },
    Array.from(readFileSync(file)),
  );
  assert(
    (await page.locator("#properties-feedback").textContent()).includes(
      "Apply or cancel",
    ),
  );
  assert.equal(
    await page.locator("#filename").textContent(),
    "Fictional metadata.pdf",
  );
  await page.locator("#clear-properties").click();
  await page.locator("#cancel-properties").click();
  assert.equal(
    (await page.locator("#document-state span").textContent()).trim(),
    "Ready",
  );
  await openProperties(page);
  assert.equal(
    await page.locator("#property-author").inputValue(),
    "Original fictional author",
  );
  const properties = {
    title: "Résumé 日本語 ✨",
    author: "Alex Example",
    subject: "Fictional note\nSecond line",
    keywords: "synthetic, demo; café",
  };
  for (const [key, value] of Object.entries(properties))
    await page.locator("#property-" + key).fill(value);
  await page.screenshot({ path: output + "/properties-desktop-dark.png" });
  await page.locator('#properties-dialog button[type="submit"]').click();
  assert(
    (await page.locator("#document-state").textContent()).includes(
      "Changes not downloaded",
    ),
  );
  assert.equal(await page.title(), publicTitle);
  const metadataDownload = page.waitForEvent("download");
  await page.locator("#save").click();
  const metadataPath = output + "/properties-completed.pdf";
  await (await metadataDownload).saveAs(metadataPath);
  const metadataBytes = readFileSync(metadataPath);
  const metadataPdf = await PDFDocument.load(metadataBytes, {
    updateMetadata: false,
  });
  for (const [key, value] of Object.entries(properties))
    assert.equal(
      metadataPdf["get" + key[0].toUpperCase() + key.slice(1)](),
      value,
    );
  assert.equal(metadataPdf.getCreator(), "Fictional Fixture Maker");
  assert(!metadataPdf.catalog.has(PDFName.of("Metadata")));
  assert(!metadataBytes.includes(Buffer.from("FICTIONAL_XMP_AUTHOR_489")));
  for (const key of Object.keys(expected)) {
    assert.equal(
      metadataPdf
        .getForm()
        .getField(key)
        .acroField.dict.get(PDFName.of("V"))
        ?.toString(),
      savedForm.getField(key).acroField.dict.get(PDFName.of("V"))?.toString(),
      key + " native value survives metadata editing",
    );
  }
  await page.locator("#print").click();
  await page.locator("#print-frame").waitFor({ state: "attached" });
  const metadataPrint = await page.evaluate(async () =>
    Array.from(
      new Uint8Array(
        await (
          await fetch(document.querySelector("#print-frame").src)
        ).arrayBuffer(),
      ),
    ),
  );
  assert.equal(
    createHash("sha256").update(Buffer.from(metadataPrint)).digest("hex"),
    createHash("sha256").update(metadataBytes).digest("hex"),
  );
  await page.locator("#pdf-file").setInputFiles(metadataPath);
  await page.waitForFunction(
    () =>
      document.querySelector("#page").dataset.rendered === "0" &&
      document.querySelector("#page").getAttribute("aria-busy") === "false",
  );
  await openProperties(page);
  for (const [key, value] of Object.entries(properties))
    assert.equal(await page.locator("#property-" + key).inputValue(), value);
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .locator("#more-actions")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await openProperties(page);
  await page.locator("#clear-properties").click();
  await page.locator('#properties-dialog button[type="submit"]').click();
  await page.locator("#undo").click();
  await openProperties(page);
  assert.equal(
    await page.locator("#property-title").inputValue(),
    properties.title,
  );
  await page.locator("#cancel-properties").click();
  await page.locator("#redo").click();
  const clearDownload = page.waitForEvent("download");
  await page.locator("#save").click();
  const clearPath = output + "/properties-cleared.pdf";
  await (await clearDownload).saveAs(clearPath);
  const clearPdf = await PDFDocument.load(readFileSync(clearPath), {
    updateMetadata: false,
  });
  assert.equal(
    clearPdf.context.lookup(clearPdf.context.trailerInfo.Info).keys().length,
    0,
  );
  assert(!clearPdf.catalog.has(PDFName.of("Metadata")));
  assert.equal(
    clearPdf.getForm().getTextField("full_name").getText(),
    expected.full_name,
  );
  assert.equal(clearPdf.getPageCount(), 4);
  assert.equal(
    requests.filter(
      (r) =>
        /^https?:/.test(r.url) &&
        (r.method !== "GET" || !r.url.startsWith(base)),
    ).length,
    0,
  );
  receipt.checks.document_properties_edit_clear_cancel_history_reopen_print =
    "pass";
  assert.deepEqual(errors, []);
  writeFileSync(output + "/network.json", JSON.stringify(requests, null, 2));
  // One phone-sized WebKit journey, using real touch events for pen and browser controls.
  const mobile = await webkit.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_WEBKIT
      ? { executablePath: process.env.PLAYWRIGHT_WEBKIT }
      : {}),
  });
  browsers.push(mobile);
  const mobileContext = await mobile.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  const phone = await mobileContext.newPage();
  await phone.goto(base);
  await phone
    .locator(".press-illustration img")
    .evaluate((img) => img.decode());
  await phone.screenshot({
    path: output + "/welcome-phone-dark.png",
    fullPage: true,
  });
  await phone.locator("#theme").tap();
  await phone.screenshot({
    path: output + "/welcome-phone-light.png",
    fullPage: true,
  });
  await phone.locator("#theme").tap();
  await phone.locator("#pdf-file").setInputFiles(file);
  await phone.waitForFunction(
    () => document.querySelector("#page").getAttribute("aria-busy") === "false",
  );
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );

  const phoneSpace = await phone
    .locator("#workspace")
    .evaluate((el) => ({ height: el.clientHeight, viewport: innerHeight }));
  assert(
    phoneSpace.height / phoneSpace.viewport >= 0.7,
    "Phone document should own at least 70% of the viewport",
  );
  await phone.setViewportSize({ width: 390, height: 600 });
  const shortSpace = await phone
    .locator("#workspace")
    .evaluate((el) => ({ height: el.clientHeight, viewport: innerHeight }));
  assert(
    shortSpace.height / shortSpace.viewport >= 0.6,
    "Short phone must retain document space",
  );
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.locator("#more-actions").tap();
  await phone.locator("[data-open-apps]").tap();
  await phone.locator("#app-navigation [data-close-apps]").tap();
  assert(
    await phone
      .locator("#more-actions")
      .evaluate((el) => el === document.activeElement),
  );
  receipt.checks.apps_menu_ldraw_phone = await checkLdrawAppsMenu(
    phone,
    "phone",
    async () => {
      await phone.locator("#more-actions").tap();
      await phone.locator("[data-open-apps]").tap();
    },
  );
  assert(
    await phone
      .locator("#more-actions")
      .evaluate((el) => el === document.activeElement),
    "Escape returns compact focus to the menu trigger",
  );
  receipt.checks.compact_phone_document_space = { phoneSpace, shortSpace };
  assert(await phone.locator("#filename").isVisible());
  assert.equal(
    await phone.locator("#filename").getAttribute("title"),
    "paperwork-lab-interactive-mixed.pdf",
  );
  await phone.locator('[data-field="full_name"]').fill("Phone Example");
  await phone.locator("#page-number").selectOption({ value: "1" });
  await phone.waitForFunction(
    () => document.querySelector("#page").dataset.rendered === "1",
  );
  await phone.locator('button[data-tool="pen"]').tap();
  const phoneBox = await phone.locator("#page").boundingBox();
  const px = phoneBox.x + (70 * phoneBox.width) / 595,
    py = phoneBox.y + (100 * phoneBox.width) / 595;
  await phone.touchscreen.tap(px, py);
  assert.equal(await phone.locator("#additions [data-object]").count(), 1);
  await phone.locator("#undo-mobile").tap();
  assert.equal(await phone.locator("#additions [data-object]").count(), 0);
  await phone.locator("#redo-mobile").tap();
  await phone
    .locator("#signature-file")
    .setInputFiles(fixture + "/demo-signature-transparent.png");
  await phone.waitForFunction(
    () => document.querySelector("#page").dataset.tool === "image",
  );
  await phone.tap("#surface", { position: { x: 90, y: 230 } });
  await phone.locator("#more-actions").tap();
  await phone.locator("#theme").tap();
  await phone.screenshot({ path: output + "/phone-light.png" });
  await phone.locator("#more-actions").tap();
  await phone.locator("#theme").tap();
  await phone.screenshot({ path: output + "/phone-dark.png" });
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const mobileDownloadPromise = phone.waitForEvent("download");
  await phone.locator("#save").tap();
  await (await mobileDownloadPromise).saveAs(output + "/phone-completed.pdf");
  const mobilePdf = await PDFDocument.load(
    readFileSync(output + "/phone-completed.pdf"),
  );
  assert.equal(
    mobilePdf.getForm().getTextField("full_name").getText(),
    "Phone Example",
  );
  receipt.checks.webkit_phone_touch_export = "pass";
  await phone.locator("#more-actions").click();
  if ((await phone.locator("#theme").getAttribute("aria-pressed")) === "true")
    await phone.locator("#theme").click();
  else await phone.keyboard.press("Escape");
  await openProperties(phone);
  const propertiesBox = await phone.locator("#properties-dialog").boundingBox();
  assert(propertiesBox.width <= 390 && propertiesBox.height <= 844);
  assert(
    await phone
      .locator("#property-title")
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  );
  await phone.locator("#property-author").fill("Fictional Phone Editor");
  await phone.screenshot({ path: output + "/properties-phone-light.png" });
  await phone.locator('#properties-dialog button[type="submit"]').click();
  const phonePropertiesDownload = phone.waitForEvent("download");
  await phone.locator("#save").click();
  const phonePropertiesPath = output + "/phone-properties.pdf";
  await (await phonePropertiesDownload).saveAs(phonePropertiesPath);
  assert.equal(
    (
      await PDFDocument.load(readFileSync(phonePropertiesPath), {
        updateMetadata: false,
      })
    ).getAuthor(),
    "Fictional Phone Editor",
  );
  receipt.checks.phone_properties_export = "pass";
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  receipt.failure = error.stack;
  if (activePage) {
    receipt.state = await activePage.evaluate(() => ({
      status: document.querySelector("#status").textContent,
      page: document.querySelector("#page").outerHTML.slice(0, 400),
      selection: document.querySelector("#page-number").value,
    }));
    await activePage.screenshot({ path: output + "/failure.png" });
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  writeFileSync(output + "/receipt.json", JSON.stringify(receipt, null, 2));
  for (const b of browsers) await b.close();
  await new Promise((r) => server.close(r));
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
