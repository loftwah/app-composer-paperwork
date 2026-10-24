// Focused release gate for Paperwork's public search and sharing contract.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sharePath, shareAlt } from "./seo.mjs";
const decode = (value) =>
  value.replace(
    /&(amp|quot|lt|gt|#39);/g,
    (_, name) => ({ amp: "&", quot: '"', lt: "<", gt: ">", "#39": "'" })[name],
  );
export function inspectHead(
  html,
  { canonical, image, siteName = "Paperwork" },
) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  assert(head, "Missing server-rendered head");
  const attrs = (tag) =>
    Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
        ([, key, a, b]) => [key.toLowerCase(), decode(a ?? b)],
      ),
    );
  const values = new Map();
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const a = attrs(tag),
      key = a.property || a.name;
    if (!key) continue;
    assert(!values.has(key), "Duplicate metadata: " + key);
    values.set(key, a.content);
  }
  const canonicals = (head.match(/<link\b[^>]*>/gi) || [])
    .map(attrs)
    .filter((a) => a.rel === "canonical");
  assert.equal(canonicals.length, 1, "Exactly one canonical required");
  assert.equal(canonicals[0].href, canonical);
  const titles = [...head.matchAll(/<title>([\s\S]*?)<\/title>/gi)];
  assert.equal(titles.length, 1);
  const title = decode(titles[0][1]);
  assert(
    title.includes("Paperwork") && title.includes("PDF"),
    "Title must identify the PDF editor",
  );
  const required = {
    "og:type": "website",
    "og:url": canonical,
    "og:site_name": siteName,
    "og:image": image,
    "og:image:type": "image/png",
    "og:image:width": "1200",
    "og:image:height": "630",
    "twitter:card": "summary_large_image",
    "twitter:image": image,
  };
  for (const [key, value] of Object.entries(required))
    assert.equal(values.get(key), value, key);
  assert.equal(values.get("og:title"), title);
  assert.equal(values.get("twitter:title"), title);
  assert(values.get("description")?.length > 70);
  assert.equal(values.get("og:description"), values.get("description"));
  assert.equal(values.get("twitter:description"), values.get("description"));
  assert.equal(values.get("og:image:alt"), shareAlt);
  assert.equal(values.get("twitter:image:alt"), shareAlt);
  assert(
    !/noindex/i.test(values.get("robots") || ""),
    "Public page is noindex",
  );
  return { title, canonical, image, description: values.get("description") };
}
export async function verifySeo({ origin, imageBytes, fetchImpl = fetch }) {
  const image = origin + sharePath,
    records = [];
  const agents = [
    "Twitterbot/1.0",
    "facebookexternalhit/1.1",
    "LinkedInBot/1.0",
    "Googlebot",
  ];
  for (const agent of agents) {
    for (const path of ["/", "/help.html", "/?sample=lab&qa=seo"]) {
      const response = await fetchImpl(origin + path, {
        headers: { "User-Agent": agent },
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 200, agent + " " + path);
      assert(!/noindex/i.test(response.headers.get("x-robots-tag") || ""));
      const canonical = origin + (path.startsWith("/?") ? "/" : path);
      const html = await response.text();
      const record = inspectHead(html, { canonical, image });
      const schema = JSON.parse(
        html.match(
          /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
        )?.[1] || "null",
      );
      assert(schema);
      assert.equal(schema.url, canonical);
      records.push({ agent, path, ...record });
    }
    const response = await fetchImpl(image, {
      headers: { "User-Agent": agent },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type")?.split(";")[0],
      "image/png",
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 630);
    assert(bytes.length < 5 * 1024 * 1024);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      createHash("sha256").update(imageBytes).digest("hex"),
    );
  }
  const robots = await fetchImpl(origin + "/robots.txt");
  assert.equal(robots.status, 200);
  const robotsText = await robots.text();
  assert(robotsText.includes("Sitemap: " + origin + "/sitemap.xml"));
  assert(/User-agent: \*\s+Allow: \//.test(robotsText));
  const sitemap = await fetchImpl(origin + "/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert(sitemap.headers.get("content-type")?.includes("xml"));
  const xml = await sitemap.text();
  assert.deepEqual(
    [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]),
    [origin + "/", origin + "/help.html"],
  );
  const missing = await fetchImpl(origin + "/not-a-page-seo-check");
  assert.equal(missing.status, 404);
  const sample = await fetchImpl(origin + "/examples/garden-form.pdf");
  assert.equal(sample.status, 200);
  assert(/noindex/i.test(sample.headers.get("x-robots-tag") || ""));
  return {
    records,
    image,
    robots: true,
    sitemap: true,
    real404: true,
    fictionalExamplesNoindex: true,
    providerCacheRenderingVerified: false,
  };
}
