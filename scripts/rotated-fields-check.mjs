import { PDFDocument, degrees } from "pdf-lib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createOwnedCleanup } from "./lib/owned-cleanup.mjs";

mkdirSync("output/rotated-fields", { recursive: true });
const ownedRoot = mkdtempSync(path.join(tmpdir(), "paperwork-rotated-fields-"));

// Track the launch so a signal arriving mid-launch still owns the browser that
// resolves from it. Handlers are installed before launch: Node's default
// SIGINT/SIGTERM exit skips `finally` and would strand the browser and the
// temporary PDF variants this run created.
let browser;
let pendingLaunch;
const teardown = async () => {
  const failures = [];
  if (pendingLaunch) {
    try {
      browser = await pendingLaunch;
    } catch {
      // A failed launch leaves no browser. Preserve its original error.
    }
    pendingLaunch = undefined;
  }
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      failures.push(error);
    }
  }
  // Remove the exact root allocated for this run.
  try {
    rmSync(ownedRoot, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    throw new AggregateError(failures, "Rotated-fields cleanup failed");
  // The validation completion marker is written only after the owned browser
  // closed and the owned root was removed, on normal exit, errors and signals.
  if (process.env.LOFTWAH_VALIDATION_COMPLETION)
    writeFileSync(
      process.env.LOFTWAH_VALIDATION_COMPLETION,
      JSON.stringify({
        version: 1,
        generation: process.env.LOFTWAH_VALIDATION_GENERATION,
        cleanup: "complete",
      }),
    );
};
const owned = createOwnedCleanup(teardown);
owned.install();

try {
  pendingLaunch = chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
      : { channel: "chrome" }),
    // This module owns SIGINT/SIGTERM teardown; Playwright's default handlers
    // would close the browser and exit before our cleanup ran.
    handleSIGINT: false,
    handleSIGTERM: false,
  });
  browser = await pendingLaunch;
  pendingLaunch = undefined;
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  await page.goto(process.env.PAPERWORK_ORIGIN || "http://127.0.0.1:4264");
  for (const angle of [90, 270]) {
    const source = await PDFDocument.load(
      readFileSync(
        "tests/fixtures/paperwork-fixtures/paperwork-lab-interactive-mixed.pdf",
      ),
    );
    source.getPage(0).setRotation(degrees(angle));
    const bytes = await source.save(),
      file = path.join(ownedRoot, "widgets-" + angle + ".pdf");
    writeFileSync(file, bytes);
    const task = getDocument({ data: bytes.slice() });
    const pdf = await task.promise;
    const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
    await task.destroy();
    await page.locator("#pdf-file").setInputFiles(file);
    await page.waitForFunction(name =>
      document.querySelector('#filename').textContent === name &&
      document.querySelector('#page').getAttribute('aria-busy') === 'false' &&
      document.querySelectorAll('[data-field]').length > 8,
      `widgets-${angle}.pdf`,
    );
    const pageBox = await page.locator("#page").boundingBox(),
      scale = pageBox.width / viewport.width;
    await page.screenshot({ path: `output/rotated-fields/page-${angle}.png` });
    for (const field of source.getForm().getFields())
      for (const [index, widget] of field.acroField.getWidgets().entries()) {
        if (field.getName() === "case_note") continue;
        const r = widget.getRectangle(),
          a = viewport.convertToViewportPoint(r.x, r.y),
          b = viewport.convertToViewportPoint(r.x + r.width, r.y + r.height),
          box = await page
            .locator(`[data-field="${field.getName()}"]`)
            .nth(index)
            .boundingBox();
        const expected = {
          x: pageBox.x + Math.min(a[0], b[0]) * scale,
          y: pageBox.y + Math.min(a[1], b[1]) * scale,
          width: Math.abs(a[0] - b[0]) * scale,
          height: Math.abs(a[1] - b[1]) * scale,
        };
        for (const key of ["x", "y", "width", "height"])
          assert(
            Math.abs(box[key] - expected[key]) < 1.1,
            `${angle}° ${field.getName()} ${key}: ${box[key]} expected ${expected[key]}`,
          );
      }
    await page.locator('[data-field="full_name"]').fill("Alex Rotated Example");
    await page
      .locator('[data-field="delivery_window"]')
      .selectOption("Evening");
    const promise = page.waitForEvent("download");
    await page.locator("#save").click();
    const download = await promise;
    const completed = `output/rotated-fields/completed-${angle}.pdf`;
    await download.saveAs(completed);
    const saved = await PDFDocument.load(readFileSync(completed));
    assert.equal(saved.getPage(0).getRotation().angle, angle);
    assert.equal(
      saved.getForm().getTextField("full_name").getText(),
      "Alex Rotated Example",
    );
    assert.deepEqual(
      saved.getForm().getDropdown("delivery_window").getSelected(),
      ["Evening"],
    );
  }
  writeFileSync(
    "output/rotated-fields/receipt.json",
    JSON.stringify({
      rotations: [90, 270],
      all_native_widget_bounds: "pass",
      actual_saved_values: "pass",
    }),
  );
  console.log("90° and 270° native widget bounds and actual downloads pass.");
} finally {
  // Normal completion and thrown errors drain the same bounded teardown the
  // signal handler uses. Keep the listeners installed until it settles so a
  // signal during cleanup cannot restore Node's immediate default exit.
  try {
    await owned.clean();
  } finally {
    owned.uninstall();
  }
}
