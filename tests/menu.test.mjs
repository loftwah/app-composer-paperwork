import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const page of ["index.html"]) {
  test(`${page} provides the shared illustrated Apps menu shell`, () => {
    const html = readFileSync(page, "utf8");
    assert.match(html, /data-open-apps/);
    assert.match(html, /class="dialog-heading"/);
    assert.match(html, /id="app-navigation-title">Apps and shortcuts/);
    assert.match(html, /role="status" aria-live="polite"/);
    assert.match(html, /src="\/brand\/launcher.js" defer/);
    assert.equal((html.match(/data-destination/g) ?? []).length, 5);
    for (const name of [
      "linkarooie",
      "herethere",
      "linkcheck",
      "hello",
      "carryforward",
    ]) {
      assert(html.includes(`/brand/apps/${name}-small-20261018.webp`));
    }
  });
}
