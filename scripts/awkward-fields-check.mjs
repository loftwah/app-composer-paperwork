// Awkward-widget interoperability check for the synthetic #264 fixture.
// Run after `pnpm build`: node scripts/awkward-fields-check.mjs
// It never sends the document anywhere; the browser is local and the fixture is fictional.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFNumber, decodePDFRawStream } from "pdf-lib";
import path from "node:path";
import assert from "node:assert/strict";

const output = path.resolve(
  process.env.PAPERWORK_EVIDENCE || "output/awkward-fields",
);
mkdirSync(output, { recursive: true });
const fixture = path.resolve("tests/fixtures/interop-264");
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
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const receipt = {
  url: base,
  checks: {},
  known_limitations: [
    "Rendered widget geometry is checked in Chromium only; no physical printer or second OS was exercised.",
    "The XFA fixture is a minimal synthetic /XFA carrier, not a genuine LiveCycle form.",
  ],
};
const appearanceBytes = (stream) =>
  Buffer.from(decodePDFRawStream(stream).decode());
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  receipt.browser = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.goto(base);
  await page.screenshot({ path: output + "/welcome-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: output + "/welcome-phone.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const settled = (name) =>
    page.waitForFunction(
      (expected) =>
        document.querySelector("#filename").textContent === expected &&
        !document.querySelector("#save").disabled,
      name,
    );
  await page.locator("#pdf-file").setInputFiles(fixture + "/awkward-widgets.pdf");
  await settled("awkward-widgets.pdf");
  await page.locator('[data-field="unprintable_value"]').waitFor();
  receipt.checks.awkward_fixture_opens = "pass";
  assert.equal(
    await page.locator('[data-field="turned_label"]').inputValue(),
    "SIDEWAYS",
  );
  const turnedTransform = await page
    .locator('[data-field="turned_label"]')
    .evaluate((element) => getComputedStyle(element).transform);
  assert.match(turnedTransform, /matrix\(/);
  const turnedBox = await page.locator('[data-field="turned_label"]').boundingBox();
  assert.ok(
    turnedBox.height > turnedBox.width,
    "a /MK rotated widget must keep its tall on-screen box",
  );
  receipt.checks.mk_rotated_widget_positions = "pass";
  const source = await PDFDocument.load(
    readFileSync(fixture + "/awkward-widgets.pdf"),
  );
  const customArt = appearanceBytes(
    source
      .getForm()
      .getCheckBox("custom_tick")
      .acroField.getWidgets()[0]
      .getAppearances()
      .normal.lookup(PDFName.of("Yes")),
  );
  await page.locator('[data-field="custom_tick"]').check();
  await page
    .locator('[data-field="unprintable_value"]')
    .fill("Completed by the user");
  await page.locator('[data-field="tight_combo"]').selectOption("Experienced");
  await page
    .locator('[data-field="tight_list"]')
    .selectOption(["Flowers", "Vegetables"]);
  await page.screenshot({ path: output + "/awkward-edited.png" });
  const download = page.waitForEvent("download");
  await page.locator("#save").click();
  const saved = await download;
  const completed = output + "/awkward-widgets-completed.pdf";
  await saved.saveAs(completed);
  const completedPdf = await PDFDocument.load(readFileSync(completed));
  const form = completedPdf.getForm();
  assert.equal(
    form
      .getTextField("unprintable_value")
      .acroField.getWidgets()[0]
      .dict.lookupMaybe(PDFName.of("F"), PDFNumber)
      .asNumber() &
      4,
    4,
  );
  assert.equal(
    form
      .getCheckBox("silent_tick")
      .acroField.getWidgets()[0]
      .dict.has(PDFName.of("F")),
    false,
  );
  receipt.checks.changed_field_marked_printable = "pass";
  receipt.checks.untouched_field_flags_preserved = "pass";
  assert.deepEqual(form.getCheckBox("custom_tick").isChecked(), true);
  assert.deepEqual(
    appearanceBytes(
      form
        .getCheckBox("custom_tick")
        .acroField.getWidgets()[0]
        .getAppearances()
        .normal.lookup(PDFName.of("Yes")),
    ),
    customArt,
  );
  receipt.checks.custom_check_art_preserved = "pass";
  const listSize = Number(
    form
      .getOptionList("tight_list")
      .acroField.getDefaultAppearance()
      .match(/(\d*\.?\d+)\s+Tf/)[1],
  );
  assert.ok(listSize < 23, `list size ${listSize} must be reduced to fit`);
  receipt.checks.tight_choice_sizes_fit = "pass";
  await page.locator("#pdf-file").setInputFiles(completed);
  await settled("awkward-widgets-completed.pdf");
  assert.equal(
    await page.locator('[data-field="unprintable_value"]').inputValue(),
    "Completed by the user",
  );
  assert.deepEqual(
    await page
      .locator('[data-field="tight_list"]')
      .evaluate((element) =>
        Array.from(element.selectedOptions).map((option) => option.value),
      ),
    ["Flowers", "Vegetables"],
  );
  receipt.checks.completed_pdf_reopens_with_values = "pass";
  // Negative files are opened in a second tab so the completed document stays
  // open, exactly as a person would compare two files.
  const other = await context.newPage();
  other.on("pageerror", (error) => errors.push(error.message));
  await other.goto(base);
  await other.locator("#pdf-file").setInputFiles(fixture + "/xfa-form.pdf");
  await other.waitForFunction(
    () => document.querySelector("#status").textContent.includes("XFA"),
    undefined,
    { timeout: 15000 },
  );
  assert.equal(
    await other.locator("#status").getAttribute("data-visible"),
    "true",
  );
  receipt.checks.synthetic_xfa_refused_truthfully = "pass";
  await other
    .locator("#pdf-file")
    .setInputFiles("tests/fixtures/paperwork-fixtures/negative-truncated.pdf");
  await other.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("damaged"),
  );
  receipt.checks.damaged_pdf_refused_truthfully = "pass";
  assert.equal(
    await page.locator("#filename").textContent(),
    "awkward-widgets-completed.pdf",
  );
  receipt.checks.negative_tab_keeps_completed_document_open = "pass";
  assert.deepEqual(errors, []);
  receipt.checks.no_page_errors = "pass";
} finally {
  await browser.close();
  server.close();
  receipt.pass = Object.values(receipt.checks).every((value) => value === "pass");
  writeFileSync(output + "/receipt.json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.pass) process.exitCode = 1;
}
