import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicOrigin, pageMetadata, sharePath } from "../scripts/seo.mjs";
import { inspectHead } from "../scripts/verify-seo.mjs";
const origin = "https://paperwork.loftwah.com",
  page = {
    path: "/",
    title: "Paperwork — Fill, sign and edit PDFs in your browser",
    description:
      "Fill PDF forms, draw and add your signature. Your documents stay in your browser. No account or uploads.",
  };
const html = () =>
  "<html><head>" + pageMetadata(origin, page) + "</head></html>";
test("the published static head has a consistent public canonical and dedicated large PNG card", () => {
  assert.equal(
    inspectHead(html(), { canonical: origin + "/", image: origin + sharePath })
      .canonical,
    origin + "/",
  );
});
test("missing or generic sharing artwork fails the release contract", () => {
  for (const text of [
    html().replace(/<meta property="og:image"[^>]*>/, ""),
    html().replaceAll(sharePath, "/generic-composer.jpg"),
    html().replace("index,follow,max-image-preview:large", "noindex"),
  ])
    assert.throws(() =>
      inspectHead(text, { canonical: origin + "/", image: origin + sharePath }),
    );
});
test("prepared instances cannot inherit the reference public URL or indexability", () => {
  assert.equal(publicOrigin(null), null);
  const head = pageMetadata(null, page);
  assert.match(head, /noindex,nofollow/);
  assert.doesNotMatch(head, /canonical|og:url|loftwah/);
  for (const value of [
    { origin: "http://example.com" },
    { origin: origin + "/wrong" },
    { origin: origin + "?x=1" },
    { origin: "https://user:password@example.com" },
    { origin, extra: true },
  ])
    assert.throws(() => publicOrigin(value));
});
test("the shipped share image is a complete 1200 by 630 PNG", () => {
  const bytes = readFileSync(new URL("../public" + sharePath, import.meta.url));
  assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a");
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  assert(bytes.length > 10000 && bytes.length < 5 * 1024 * 1024);
});

test("the actual build switches a prepared instance from noindex to its own reviewed origin", async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeSiteMetadata } = await import("../scripts/seo.mjs");
  const root = mkdtempSync(join(tmpdir(), "paperwork-seo-build."));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "dist"));
  mkdirSync(join(root, "public"));
  writeFileSync(
    join(root, "public/paperwork.json"),
    JSON.stringify({ title: "Community Paperwork $&" }),
  );
  const reset = () => {
    for (const [file, source] of [
      ["index.html", "../index.html"],
      ["help.html", "../public/help.html"],
    ])
      writeFileSync(
        join(root, "dist", file),
        readFileSync(new URL(source, import.meta.url)),
      );
  };
  reset();
  writeSiteMetadata(root);
  assert.match(
    readFileSync(join(root, "dist/index.html"), "utf8"),
    /noindex,nofollow/,
  );
  assert(!existsSync(join(root, "dist/sitemap.xml")));
  const ownOrigin = "https://community.example";
  writeFileSync(join(root, "site.json"), JSON.stringify({ origin: ownOrigin }));
  reset();
  writeSiteMetadata(root);
  const page = readFileSync(join(root, "dist/index.html"), "utf8");
  assert.equal(
    inspectHead(page, {
      canonical: ownOrigin + "/",
      image: ownOrigin + sharePath,
      siteName: "Community Paperwork $&",
    }).title,
    "Community Paperwork $& — Fill, sign and edit PDFs in your browser",
  );
  assert.doesNotMatch(page, /https:\/\/paperwork\.loftwah\.com/);
  const xml = readFileSync(join(root, "dist/sitemap.xml"), "utf8");
  assert(xml.includes(ownOrigin + "/help.html"));
});
