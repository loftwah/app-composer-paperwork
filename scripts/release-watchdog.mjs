#!/usr/bin/env node
// MIT. Small operational companion to lib/delivery/release-timing.mjs.
// It does not run releases. It reports stale running receipts and retries
// redacted SLA alerts that could not reach GitHub during a release.

import { existsSync } from "node:fs";
import {
  createGitHubAdapter,
  findStuckRuns,
  flushPendingAlerts,
  reportStuckRun,
} from "./lib/release-timing.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const repo = option("--repo", process.env.RELEASE_TIMING_REPO ?? "");
const receiptDir = option("--receipt-dir", ".release/timing");
const pendingDir = `${receiptDir}/pending`;
const checkStuck = args.includes("--check-stuck") || args.length === 0;
const retryPending = args.includes("--retry-pending");

let github = null;
try {
  if (repo) github = createGitHubAdapter({ repo });
} catch (error) {
  console.error(`GitHub alert reporter unavailable: ${error.message}`);
}

let failed = false;
if (checkStuck) {
  const stuck = findStuckRuns({ receiptDir });
  console.log(JSON.stringify({ check: "stuck-runs", count: stuck.length, runs: stuck.map((run) => ({
    repo: run.repo,
    runId: run.runId,
    sha: run.sha,
    releasePath: run.releasePath,
    startedAt: run.startedAt,
    ageMs: run.ageMs,
  })) }, null, 2));
  for (const run of stuck) {
    const state = await reportStuckRun({ stuck: run, github });
    console.log(`stuck alert ${run.runId}: ${state}`);
    if (state === "pending") failed = true;
  }
}

if (retryPending) {
  if (!existsSync(pendingDir)) {
    console.log(JSON.stringify({ check: "pending-alerts", flushed: 0, remaining: 0 }));
  } else {
    const result = await flushPendingAlerts({ pendingDir, github });
    console.log(JSON.stringify({ check: "pending-alerts", ...result }));
    if (result.blocked) console.error(`pending alerts cannot be filed: ${result.blocked}`);
    if (result.remaining) failed = true;
  }
}

if (failed) process.exitCode = 2;
