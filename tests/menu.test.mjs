import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

for (const page of ["index.html"]) {
  const html = readFileSync(page, "utf8");
  const destinations = [...html.matchAll(/<li data-destination>([\s\S]*?)<\/li>/g)].map(
    ([, body]) => ({
      body,
      href: body.match(/<a href="([^"]+)"/)?.[1] ?? "",
      label: (
        body.match(/<span>([^<]*)</)?.[1] ??
        body.match(/<a href="[^"]*"(?:\s[^>]*)?>\s*([^<]*)/)?.[1] ??
        ""
      ).trim(),
      image: body.match(/<img\s+src="([^"]+)"/)?.[1] ?? "",
      alt: body.match(/\salt="([^"]*)"/)?.[1],
      description: body.match(/<small>([^<]*)<\/small>/)?.[1] ?? "",
    }),
  );

  test(`${page} provides the shared illustrated Apps menu shell`, () => {
    assert.match(html, /data-open-apps/);
    assert.match(html, /class="dialog-heading"/);
    assert.match(html, /id="app-navigation-title">Apps and shortcuts/);
    assert.match(html, /role="status" aria-live="polite"/);
    assert.match(html, /src="\/brand\/launcher.js" defer/);
    assert.equal(destinations.length, 6);
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

  // The authored row is this shell's navigation authority; the local controller
  // keeps the same named destination, its search aliases and its keyboard paths.
  test(`${page} authors the LDraw destination last, after Carry / forward`, () => {
    const ldraw = destinations.filter((row) => row.label === "LDraw");
    assert.equal(ldraw.length, 1, "exactly one authored LDraw row");
    assert.equal(ldraw[0].href, "https://ldraw.loftwah.com/");
    assert.equal(
      ldraw[0].image,
      "/brand/apps/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96.webp",
    );
    assert.equal(ldraw[0].alt, "", "the tile is decorative beside the label");
    assert.equal(ldraw[0].description, "Editable diagrams");
    assert.match(ldraw[0].body, /width="40"\s+height="40"/);
    assert.equal(destinations.at(-1), ldraw[0], "LDraw closes the app rows");
    assert.equal(
      destinations.at(-2).label,
      "Carry / forward",
      "LDraw follows Carry / forward",
    );
    for (const path of ["/brand/ldraw", "/brand/apps/ldraw-icon", "ldraw-logo"])
      assert.equal(html.includes(path), false, "no invented LDraw mark " + path);
  });
}

test("the local Apps menu controller is the reviewed Composer distribution with LDraw", () => {
  const launcher = readFileSync("public/brand/launcher.js");
  assert.equal(
    createHash("sha256").update(launcher).digest("hex"),
    "c952399adeb5fc8bfa8f7916222d2c57c1e792b2164807cb9b80592bd520c3cb",
    "public/brand/launcher.js must be the reviewed Composer distribution",
  );
  const code = launcher.toString("utf8");
  assert.match(
    code,
    /\{ name: "LDraw", href: "https:\/\/ldraw\.loftwah\.com\/", image: "apps\/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96\.webp", standaloneOnly: true, explainer: "\/ldraw", description: "Editable diagrams, PNG and SVG", keywords: "draw drawing diagram excalidraw scene png svg local offline" \}/,
  );
  for (const pattern of [
    /event\.key === "Escape"/,
    /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/,
    /event\.key === "Home"/,
    /event\.key === "End"/,
    /event\.key\.toLowerCase\(\) === "k"/,
    /event\.isComposing/,
    /keyCode === 229/,
    /normalize\("NFD"\)/,
    /\\p\{Diacritic\}/,
  ])
    assert.match(code, pattern);
});

test("the local LDraw tile is the reviewed 96px WebP", () => {
  const tile = readFileSync(
    "public/brand/apps/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96.webp",
  );
  assert.equal(tile.subarray(0, 4).toString("latin1"), "RIFF");
  assert.equal(tile.subarray(8, 12).toString("latin1"), "WEBP");
  assert.equal(
    createHash("sha256").update(tile).digest("hex"),
    "eeabb3049de7c9f830a9ded2e40a5014fbcd0fdb7c51373115ba45da2b15748f",
    "the committed tile must be the reviewed Composer export",
  );
});
