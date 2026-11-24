// MIT. Local-only release from reviewed clean pushed main to the declared static target.
// The monotonic release clock spans qualification, upload and exact live identity.
// SLA breaches and failures are recorded in a private, redacted .release receipt.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { verifyStaticAssets } from "./verify-static-assets.mjs";
import { verifySeo } from "./verify-seo.mjs";
import { createGitHubAdapter, createReleaseRun } from "./lib/release-timing.mjs";

const REPO = "loftwah/app-composer-paperwork";
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", ...options });
const git = (args) => run("git", args).trim(),
  sha = git(["rev-parse", "HEAD"]);
function guard() {
  if (
    git(["branch", "--show-current"]) !== "main" ||
    git(["rev-parse", "origin/main"]) !== sha ||
    git(["rev-parse", "HEAD"]) !== sha ||
    git(["status", "--porcelain"])
  )
    throw Error("Release requires clean reviewed pushed main.");
  const cfg = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  if (
    cfg.name !== "composer-paperwork" ||
    cfg.account_id !== "1003dc1d93af0ebea56b2f1252f89627" ||
    cfg.main ||
    JSON.stringify(cfg.routes) !==
      JSON.stringify([
        { pattern: "paperwork.loftwah.com", custom_domain: true },
      ]) ||
    Object.keys(cfg).some((key) =>
      /databases|buckets|queues|triggers|services|kv_namespaces/.test(key),
    ) ||
    cfg.assets.directory !== "dist"
  )
    throw Error("Unexpected target or metered runtime configuration.");
}
guard();

let github = null;
try {
  github = createGitHubAdapter({ repo: REPO });
} catch (error) {
  console.error(
    "Delivery SLA reporting is unavailable; a redacted pending event will be queued. " +
      error.message,
  );
}
const release = createReleaseRun({
  repo: REPO,
  project: "app-composer-paperwork",
  sha,
  releasePath: "scripts/deploy.mjs",
  kind: "worker-static-assets",
  receiptDir: ".release/timing",
  firstEditAt: process.env.PAPERWORK_FIRST_EDIT_AT,
  github,
});

const pending = await release.flushPending();
if (pending.blocked || pending.remaining)
  console.error(
    `Delivery SLA: ${pending.remaining} redacted alert(s) queued in .release/timing/pending for retry on the next release run.`,
  );

const stage = async (name, work) => {
  const started = performance.now();
  const result = await release.stage(name, work);
  console.log(
    `Release gate passed: ${name} (${((performance.now() - started) / 1000).toFixed(1)}s)`,
  );
  return result;
};

const paths = [
  "/brand/launcher.js",
  "/brand/launcher.css",
  "/brand/space-latin-20261018.woff2",
  "/brand/composer-icon-20261022b-96.png",
  ...["linkarooie", "herethere", "linkcheck", "hello", "carryforward"].map(
    (name) => `/brand/apps/${name}-small-20261018.webp`,
  ),
  "/brand/apps/ldraw-tile-fa7a2ab6171c-010cfbd2-r2-96.webp",
  "/build.json",
  "/",
  "/help.html",
  "/canonical.js",
  "/artwork/press-20261024.webp",
  "/artwork/paper-bench-motion-20261114.webp",
  "/artwork/paper-bench-motion-20261114.mp4",
  "/social/paperwork-20261024.png",
  "/icons/paperwork-48-20261024.png",
  "/icons/paperwork-180-20261024.png",
  "/sitemap.xml",
  "/paperwork.json",
  "/app.manifest.json",
  "/examples/garden-form.pdf",
];

let target = null;
try {
  console.log(`checking ${sha.slice(0, 12)}…`);
  await stage("dependency audit", () =>
    run("node", ["scripts/audit-dependencies.mjs"], { stdio: "inherit" }),
  );
  await stage("required checks", () =>
    run("pnpm", ["check"], { stdio: "inherit" }),
  );
  await stage("build", () =>
    run("pnpm", ["build"], { stdio: "inherit" }),
  );
  guard();
  // The built /build.json names the same source sha; the bounded readback of
  // those exact bytes below establishes exact live identity without a new gate.
  const checkedAssets = await stage("checked build identity", () => {
    const build = JSON.parse(readFileSync("dist/build.json", "utf8"));
    if (build?.app !== "paperwork" || build.sha !== sha)
      throw Error("The checked build identity does not match the released source.");
    return paths.map((path) => ({
      path,
      bytes: readFileSync(path === "/" ? "dist/index.html" : "dist" + path),
      ...(path.endsWith(".png") ? { type: "image/png" } : {}),
      ...(path.endsWith(".webp") ? { type: "image/webp" } : {}),
      ...(path.endsWith(".mp4") ? { type: "video/mp4" } : {}),
      ...(path === "/" || path === "/help.html" ? { csp: true } : {}),
      ...(path === "/help.html" ? { mediaCsp: true } : {}),
    }));
  });

  const output = await stage("static-assets upload", () =>
    run("pnpm", [
      "exec",
      "wrangler",
      "deploy",
      "--message",
      "Paperwork " + sha,
    ]),
  );
  process.stdout.write(output);
  const urls = output.match(
    /https:\/\/composer-paperwork\.[a-z0-9-]+\.workers\.dev/g,
  );
  if (!urls?.length) throw Error("No verified static deployment URL returned.");
  if (!output.includes("paperwork.loftwah.com"))
    throw Error("The reviewed custom domain was not deployed.");
  const origin = "https://paperwork.loftwah.com";
  target = origin;
  const verified = await stage("served static assets", () =>
    verifyStaticAssets({ origin, assets: checkedAssets }),
  );
  console.log(
    JSON.stringify({
      sourceSha: sha,
      origin,
      processing: "browser-local",
      verifiedAssets: verified,
      verified: new Date().toISOString(),
    }),
  );

  const seo = await stage("served SEO metadata", () =>
    verifySeo({
      origin,
      imageBytes: readFileSync("dist/social/paperwork-20261024.png"),
    }),
  );
  console.log(JSON.stringify({ seo }));

  const receipt = await release.finish({
    status: "passed",
    target,
    liveRevision: sha,
  });
  console.log(
    JSON.stringify({
      timing: {
        status: receipt.status,
        totalMs: receipt.totalMs,
        receipt: `.release/timing/receipt-${receipt.runId}.json`,
      },
    }),
  );
  console.log(
    `release ${receipt.status}: ${(receipt.totalMs / 1000).toFixed(1)}s (target ${(receipt.targetMs / 1000).toFixed(0)}s, limit ${(receipt.limitMs / 1000).toFixed(0)}s)`,
  );
} catch (error) {
  await release.fail(error, { target });
  throw error;
}
