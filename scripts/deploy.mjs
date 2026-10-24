// MIT. Local-only release from reviewed clean pushed main to the declared static target.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { verifyStaticAssets } from "./verify-static-assets.mjs";
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
    cfg.routes ||
    Object.keys(cfg).some((key) =>
      /databases|buckets|queues|triggers|services|kv_namespaces/.test(key),
    ) ||
    cfg.assets.directory !== "dist"
  )
    throw Error("Unexpected target or metered runtime configuration.");
}
guard();
for (const args of [["audit", "--audit-level", "low"], ["check"], ["build"]])
  run("pnpm", args, { stdio: "inherit" });
guard();
const output = run("pnpm", [
  "exec",
  "wrangler",
  "deploy",
  "--message",
  "Paperwork " + sha,
]);
process.stdout.write(output);
const urls = output.match(
  /https:\/\/composer-paperwork\.[a-z0-9-]+\.workers\.dev/g,
);
if (!urls?.length) throw Error("No verified static deployment URL returned.");
const origin = urls[0];
const paths = [
  "/brand/launcher.js",
  "/brand/launcher.css",
  "/brand/space-latin-20261018.woff2",
  "/brand/composer-icon-20261022b-96.png",
  ...["linkarooie", "herethere", "linkcheck", "hello", "carryforward"].map(
    (name) => `/brand/apps/${name}-small-20261018.webp`,
  ),
  "/build.json",
  "/",
  "/help.html",
  "/artwork/press-20261024.webp",
  "/paperwork.json",
  "/app.manifest.json",
  "/examples/garden-form.pdf",
];
const verified = await verifyStaticAssets({
  origin,
  assets: paths.map((path) => ({
    path,
    bytes: readFileSync(path === "/" ? "dist/index.html" : "dist" + path),
    ...(path.endsWith(".png") ? { type: "image/png" } : {}),
    ...(path.endsWith(".webp") ? { type: "image/webp" } : {}),
    ...(path === "/" ? { csp: true } : {}),
  })),
});
console.log(
  JSON.stringify({
    sourceSha: sha,
    origin,
    processing: "browser-local",
    verifiedAssets: verified,
    verified: new Date().toISOString(),
  }),
);
