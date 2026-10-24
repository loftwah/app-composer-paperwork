// Build-time public metadata only. Documents and signatures never enter this module.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export const sharePath = "/social/paperwork-20261024.png";
export const shareAlt =
  "Paperwork: Fill it. Sign it. Get on with your day. An orange stamp press on charcoal.";
const description =
  "Fill PDF forms, draw, add your signature and save or print the completed PDF. Your documents and signatures stay in your browser. No account or uploads.";
const pages = [
  {
    file: "index.html",
    path: "/",
    title: "Paperwork — Fill, sign and edit PDFs in your browser",
    description,
  },
  {
    file: "help.html",
    path: "/help.html",
    title: "Paperwork help — PDF editing, signatures and privacy",
    description:
      "How to fill PDF forms, draw, add a PNG signature, save and print with Paperwork. Read about compatibility, privacy and keyboard shortcuts.",
  },
];
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export function publicOrigin(site) {
  if (site === null) return null;
  if (
    !site ||
    Object.keys(site).length !== 1 ||
    typeof site.origin !== "string"
  )
    throw Error("Public site metadata needs one reviewed origin.");
  const url = new URL(site.origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== site.origin ||
    url.username ||
    url.password
  )
    throw Error(
      "Use one clean HTTPS public origin, without a path, query or credentials.",
    );
  return url.origin;
}
export function pageMetadata(origin, page) {
  const meta = (key, value, property = false) =>
    `<meta ${property ? "property" : "name"}="${key}" content="${escape(value)}" />`;
  const head = [
    `<title>${escape(page.title)}</title>`,
    meta("description", page.description),
  ];
  if (!origin) return [...head, meta("robots", "noindex,nofollow")].join("\n");
  const url = origin + page.path,
    image = origin + sharePath;
  head.push(
    `<link rel="canonical" href="${url}" />`,
    meta("robots", "index,follow,max-image-preview:large"),
  );
  for (const [key, value] of Object.entries({
    type: "website",
    title: page.title,
    description: page.description,
    url,
    site_name: page.appName || "Paperwork",
    locale: "en_AU",
    image,
    "image:secure_url": image,
    "image:type": "image/png",
    "image:width": "1200",
    "image:height": "630",
    "image:alt": shareAlt,
  }))
    head.push(meta("og:" + key, value, true));
  for (const [key, value] of Object.entries({
    card: "summary_large_image",
    title: page.title,
    description: page.description,
    image,
    "image:alt": shareAlt,
  }))
    head.push(meta("twitter:" + key, value));
  const schema =
    page.path === "/"
      ? {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          "@id": origin + "/#application",
          name: page.appName || "Paperwork",
          url,
          description: page.description,
          image,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          browserRequirements: "Requires JavaScript and WebAssembly",
          isAccessibleForFree: true,
        }
      : {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: page.title,
          url,
          description: page.description,
          isPartOf: { "@id": origin + "/#application" },
        };
  head.push(
    '<script type="application/ld+json">' +
      JSON.stringify(schema).replaceAll("<", "\\u003c") +
      "</script>",
  );
  return head.join("\n");
}
export function writeSiteMetadata(root = process.cwd()) {
  let site = null;
  try {
    site = JSON.parse(readFileSync(resolve(root, "site.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const origin = publicOrigin(site),
    dist = resolve(root, "dist");
  const config = JSON.parse(
    readFileSync(resolve(root, "public/paperwork.json"), "utf8"),
  );
  if (
    typeof config.title !== "string" ||
    !config.title.trim() ||
    config.title.length > 80
  )
    throw Error("Invalid public app title.");
  for (const page of pages) {
    const path = resolve(dist, page.file),
      html = readFileSync(path, "utf8"),
      marker = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/g;
    if ([...html.matchAll(marker)].length !== 1)
      throw Error("Expected one metadata slot in " + page.file);
    writeFileSync(
      path,
      html.replace(
        marker,
        () =>
          "<!-- seo:start -->\n" +
          pageMetadata(origin, {
            ...page,
            title: page.title.replace(/^Paperwork/, () => config.title),
            appName: config.title,
          }) +
          "\n<!-- seo:end -->",
      ),
    );
  }
  if (origin) {
    writeFileSync(
      resolve(dist, "robots.txt"),
      "User-agent: *\nAllow: /\n\nSitemap: " + origin + "/sitemap.xml\n",
    );
    writeFileSync(
      resolve(dist, "sitemap.xml"),
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        pages
          .map(
            (page) =>
              "  <url><loc>" + escape(origin + page.path) + "</loc></url>",
          )
          .join("\n") +
        "\n</urlset>\n",
    );
  } else {
    for (const name of ["robots.txt", "sitemap.xml"])
      rmSync(resolve(dist, name), { force: true });
  }
  console.log(
    origin
      ? "Public metadata built for " + origin
      : "No public origin configured; prepared instance remains noindex.",
  );
}
