// Toolbar/options height stability and page-navigation regression.
// Run after `pnpm build`; PAPERWORK_ORIGIN selects a deployed build.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = path.resolve(
  process.env.PAPERWORK_EVIDENCE || "output/toolbar-check",
);
mkdirSync(output, { recursive: true });
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
  if (!file.startsWith(path.resolve("dist") + path.sep) || !existsSync(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader(
    "Content-Type",
    types[path.extname(file)] || "application/octet-stream",
  );
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin =
  process.env.PAPERWORK_ORIGIN ||
  `http://127.0.0.1:${server.address().port}`;
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
  measurements: {},
};
const metrics = (page) =>
  page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return {
        x: +box.x.toFixed(1),
        y: +box.y.toFixed(1),
        w: +box.width.toFixed(1),
        h: +box.height.toFixed(1),
      };
    };
    return {
      toolbar: rect(".toolbar"),
      options: rect("#toolbar-options"),
      context: rect("#context-bar"),
      page: rect("#page"),
      pageBar: rect(".page-bar"),
      scrollTop: document.querySelector("#workspace").scrollTop,
      pageNumber: document.querySelector("#page-number").value,
    };
  });
const clickTool = (page, tool) =>
  page.locator(`button[data-tool="${tool}"]`).click();
try {
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["phone", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport, hasTouch: label === "phone" });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.locator("#sample").click();
    await page.waitForSelector('#page[data-tool="select"]');
    await page.waitForTimeout(600);
    const expectedToolbar = label === "desktop" ? 53 : 49;
    const expectedContext = label === "desktop" ? 51 : 49;
    const baseline = await metrics(page);
    assert.equal(baseline.toolbar.h, expectedToolbar);
    assert.equal(
      baseline.context.h,
      expectedContext,
      `${label}: Select uses the fixed options strip`,
    );
    const toolStates = {};
    for (const tool of [
      "select",
      "pen",
      "highlight",
      "eraser",
      "text",
      "tick",
      "circle",
    ]) {
      await clickTool(page, tool);
      await page.waitForTimeout(80);
      const state = await metrics(page);
      toolStates[tool] = state;
      assert.equal(
        state.toolbar.h,
        expectedToolbar,
        `${label}: ${tool} must not change toolbar height`,
      );
      assert.equal(
        state.context.h,
        expectedContext,
        `${label}: ${tool} must use the fixed options height`,
      );
      assert.equal(
        state.options.h,
        expectedContext,
        `${label}: ${tool} options height must match`,
      );
      assert.deepEqual(
        [state.page.x, state.page.y, state.pageBar.x, state.pageBar.y, state.scrollTop],
        [baseline.page.x, baseline.page.y, baseline.pageBar.x, baseline.pageBar.y, baseline.scrollTop],
        `${label}: ${tool} must not move the PDF or page controls`,
      );
      if (["eraser", "tick"].includes(tool))
        await page.screenshot({
          path: `${output}/${label}-${tool}.png`,
        });
    }
    receipt.measurements[label] = {
      toolbar: expectedToolbar,
      context: expectedContext,
      toolStates: Object.fromEntries(
        Object.entries(toolStates).map(([tool, state]) => [
          tool,
          {
            toolbarHeight: state.toolbar.h,
            optionsHeight: state.options.h,
            pageY: state.page.y,
            pageBarY: state.pageBar.y,
          },
        ]),
      ),
    };
    receipt.checks[`${label}_toolbar_height_stable`] = "pass";

    // Page controls and scrolling remain independent: scroll within a page,
    // use the page control, then scroll again without losing either path.
    await page.locator("#zoom-in").click();
    await page.locator("#zoom-in").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#page").getAttribute("aria-busy") === "false",
    );
    await page.locator("#workspace").evaluate((element) => {
      element.scrollTop = 240;
    });
    assert(
      (await metrics(page)).scrollTop > 0,
      `${label}: the workspace scrolls within a page`,
    );
    await page.locator("#next").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#page").getAttribute("aria-busy") === "false",
    );
    const nextPage = await metrics(page);
    assert.equal(nextPage.pageNumber, "1", `${label}: next page control works`);
    assert.equal(
      nextPage.scrollTop,
      0,
      `${label}: page change returns to the page top`,
    );
    await page.locator("#workspace").evaluate((element) => {
      element.scrollTop = 160;
    });
    assert(
      (await metrics(page)).scrollTop > 0,
      `${label}: the new page scrolls too`,
    );
    assert(
      await page.locator(".page-bar").isVisible(),
      `${label}: page controls stay visible while scrolled`,
    );
    await page.locator("#previous").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#page").getAttribute("aria-busy") === "false",
    );
    assert.equal(
      (await metrics(page)).pageNumber,
      "0",
      `${label}: previous page control works after scrolling`,
    );
    receipt.checks[`${label}_page_controls_and_scroll`] = "pass";
    await page.screenshot({ path: `${output}/${label}-navigation.png` });
    await context.close();
  }
  writeFileSync(
    `${output}/toolbar-receipt.json`,
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await browser.close();
  server.close();
}
