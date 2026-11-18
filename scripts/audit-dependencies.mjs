import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";

// Remove this verification and the pnpm patch once upstream ships a fix.
// pnpm audit sees registry versions, not the local patch.
const parserHashes = new Map([
  ["4.0.7", "5f0f5f94d9dfabdd886897ed6c8519a175ed933cbdc714a945860aa0a6e607b0"],
]);
const executable = process.env.npm_execpath || "pnpm";
const pnpmIsScript = /\.(?:c|m)?js$/.test(executable);
const command = pnpmIsScript ? process.execPath : executable;
const prefix = pnpmIsScript ? [executable] : [];
const pnpm = (args, options) =>
  execFileSync(command, [...prefix, ...args], options);
const list = (...flags) =>
  pnpm(["list", "picomatch", "--depth", "Infinity", "--parseable", ...flags], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .sort();

const installed = list();
const locked = list("--lockfile-only");
if (installed.join("\n") !== locked.join("\n")) {
  throw Error("Install the locked dependencies before running the audit.");
}

const directories = installed.filter((directory) =>
  directory.endsWith(sep + join("node_modules", "picomatch")),
);
const verified = new Set();
const versions = new Set();
for (const directory of directories) {
  const { version } = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  const hash = createHash("sha256")
    .update(readFileSync(join(directory, "lib/parse.js")))
    .digest("hex");
  if (hash !== parserHashes.get(version))
    throw Error(`Unverified picomatch parser for ${version}.`);
  verified.add(realpathSync(directory));
  versions.add(version);
}
if (versions.size !== parserHashes.size)
  throw Error("The picomatch backport must be installed.");

for (const directory of installed) {
  const require = createRequire(join(directory, "package.json"));
  let resolved;
  try {
    resolved = require.resolve("picomatch");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    continue;
  }
  if (!verified.has(dirname(realpathSync(resolved)))) {
    throw Error("A dependency resolves to an unverified picomatch copy.");
  }
}
// The raw audit still reports the registry version. Only this invocation
// accepts the known finding after verifying the locally installed backport.
const advisoryId = "GHSA-fc5q-39xc-vjpf";
const audit = spawnSync(
  command,
  [...prefix, "audit", "--audit-level", "low", "--json"],
  {
    encoding: "utf8",
  },
);
if (audit.error) throw audit.error;
if (audit.stderr) process.stderr.write(audit.stderr);
const { advisories, metadata } = JSON.parse(audit.stdout);
const findings = Object.values(advisories);
if (
  Object.values(metadata.vulnerabilities).reduce(
    (total, count) => total + count,
    0,
  ) !== findings.length
) {
  throw Error("Dependency audit report contains an unexpected finding count.");
}
const onlyVerifiedBackport =
  audit.status === 1 &&
  findings.length === 1 &&
  findings[0].github_advisory_id === advisoryId &&
  findings[0].module_name === "picomatch" &&
  findings[0].findings.length > 0 &&
  findings[0].findings.every(({ version }) => versions.has(version));

if (onlyVerifiedBackport) {
  console.log(
    `Dependency audit passed with the verified local picomatch backport for ${advisoryId}.`,
  );
} else if (audit.status === 0 && findings.length === 0) {
  console.log("Dependency audit found no vulnerabilities.");
} else {
  for (const { github_advisory_id, module_name, severity } of findings) {
    console.error(`${github_advisory_id} ${module_name} (${severity})`);
  }
  throw Error("Dependency audit failed.");
}
