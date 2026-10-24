import { chromium, webkit } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
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
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
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
  await page.locator("#pdf-file").setInputFiles(file);
  const ready = async (n) =>
    page.waitForFunction(
      (n) =>
        document.querySelector("#page").dataset.rendered === String(n) &&
        document.querySelector("#page").getAttribute("aria-busy") === "false",
      n,
    );
  await ready(0);
  await page.screenshot({ path: output + "/desktop-fields.png" });
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
  await page
    .locator("#signature-file")
    .setInputFiles(fixture + "/demo-signature-transparent.png");
  await page.waitForFunction(
    () => document.querySelector("#page").dataset.tool === "image",
  );
  await tap(80, 640);
  let signature = page
    .locator("#additions [data-object]")
    .filter({ has: page.locator("image") });
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
  await page.locator('[data-field="case_note"]').fill(expected.case_note);
  await page.locator('[data-field="case_note"]').press("Tab");
  await page.screenshot({ path: output + "/desktop-mixed.png" });
  const mixedObjects = await page.locator("#additions [data-object]").count();
  assert.equal(mixedObjects, 5);
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
  await page.locator("#reuse").click();
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
  await page.locator('[data-field="case_note"]').fill("A later correction");
  assert.equal(await page.locator("#print-fallback").count(), 0);
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
  // One phone-sized WebKit journey, using real touch events for pen and browser controls.
  const mobile = await webkit.launch({ headless: true });
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
  await phone.locator("#theme").tap();
  await phone.screenshot({ path: output + "/phone-light.png" });
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
