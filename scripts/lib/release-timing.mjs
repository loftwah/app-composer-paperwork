// MIT. One small, portable release clock for the routine changed-code -> verified
// production path. It does not orchestrate a release and it never changes a
// release result: a successful-but-slow release is still deployed, but its timing
// SLO is recorded as over-budget and a deduplicated GitHub issue is filed.
//
// Canonical contract: loftwah/app-composer#624. The same module is vendored into
// independently released repositories so each keeps its own release authority.

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const RECEIPT_SCHEMA = "release-timing/v1";
export const TARGET_MS = 180_000;
export const LIMIT_MS = 300_000;
export const ALERT_LABEL = "delivery-sla";
export const MARKER_PREFIX = "delivery-sla:";
const FIRST_EDIT_BOTTLENECK = "first-edit to exact live identity";

// Full UTC ISO 8601: `Z` only, whole seconds or exactly three fractional digits.
// `date -u +%Y-%m-%dT%H:%M:%SZ` emits the seconds-only form.
const FULL_UTC_SECOND = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/;

const SECRET_KEY = /(token|secret|password|passwd|cookie|authorization|api[-_]?key|private[-_]?key)/i;
const SECRET_VALUE = [
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[redacted]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[redacted]"],
  [/\b(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@"],
  [/([?&](?:token|secret|signature|sig|key|password)=)[^&\s]+/gi, "$1[redacted]"],
];

/** True only when the duration is strictly under five minutes. */
export function isWithinLimit(durationMs) {
  return Number.isFinite(durationMs) && durationMs < LIMIT_MS;
}

/** Classify a completed routine release. 300,000 ms is a breach. */
export function classifyDuration(durationMs, { failed = false } = {}) {
  if (failed) return "failed";
  if (!Number.isFinite(durationMs) || durationMs < 0) return "measurement-unavailable";
  return durationMs < LIMIT_MS ? "passed" : "over-budget";
}

function parseFirstEditAt(value) {
  if (typeof value !== "string") return null;
  const match = FULL_UTC_SECOND.exec(value);
  if (!match || match[0] !== value) return null;
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return null;
  // Round-trip through toISOString to reject rollover (e.g. 2026-02-30, 24:00:00)
  // and to pin the stored note to the canonical three-digit UTC form.
  const normalized = match[2] ? `${match[1]}.${match[2]}Z` : `${match[1]}.000Z`;
  return new Date(epoch).toISOString() === normalized ? epoch : null;
}

/** Remove credentials, private URLs and obvious secret-shaped values. */
export function redact(value, depth = 0) {
  if (depth > 8) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    let text = value;
    for (const [pattern, replacement] of SECRET_VALUE) text = text.replace(pattern, replacement);
    return text.length > 2_000 ? text.slice(0, 2_000) + "…" : text;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) out[key] = "[redacted]";
      else out[key] = redact(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function stableFingerprint({ repo, releasePath, bottleneck }) {
  return createHash("sha256")
    .update(`${repo}\n${releasePath}\n${bottleneck}`)
    .digest("hex")
    .slice(0, 16);
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function round(value) {
  return Math.max(0, Math.round(value));
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  const temporary = path + ".tmp";
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, path);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Validate a receipt before another tool trusts it. */
export function assertReceipt(receipt) {
  if (!receipt || receipt.schema !== RECEIPT_SCHEMA) throw new Error("release receipt schema mismatch");
  if (!/^[0-9a-f]{40}$/.test(receipt.sha ?? "")) throw new Error("release receipt source SHA is invalid");
  if (typeof receipt.runId !== "string" || receipt.runId.length < 8) throw new Error("release receipt run id is invalid");
  if (!Array.isArray(receipt.stages)) throw new Error("release receipt stages are invalid");
  if (!Number.isFinite(receipt.totalMs) || receipt.totalMs < 0) throw new Error("release receipt total is invalid");
  const summed = receipt.stages.reduce((total, stage) => total + (Number(stage.durationMs) || 0), 0);
  if (summed > receipt.totalMs + Math.max(5, receipt.stages.length * 2))
    throw new Error("release receipt stage times exceed the total");
  if (receipt.liveRevision && receipt.liveRevision !== receipt.sha)
    throw new Error("release receipt live revision does not match the source SHA");
  return receipt;
}

/** GitHub CLI adapter. Issues-write only; no token ever enters a receipt. */
export function createGitHubAdapter({ repo, exec = execFileSync, timeout = 20_000, logger = console }) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo ?? "")) throw new Error("GitHub adapter needs an owner/name repository");
  const gh = (args, options = {}) =>
    exec("gh", ["--repo", repo, ...args], {
      encoding: "utf8",
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      input: options.input,
    });
  return {
    async findOpen(fingerprint) {
      const raw = gh([
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        "200",
        "--json",
        "number,title,body",
      ]);
      const issues = JSON.parse(raw || "[]");
      return issues.find((issue) => String(issue.body ?? "").includes(`<!-- ${MARKER_PREFIX}${fingerprint} -->`)) ?? null;
    },
    async create({ title, body }) {
      let raw;
      try {
        raw = gh(["issue", "create", "--title", title, "--body-file", "-", "--label", ALERT_LABEL], {
          input: body,
        });
      } catch (error) {
        if (!/label|not found/i.test(String(error?.stderr ?? error?.message ?? ""))) throw error;
        try {
          gh([
            "label",
            "create",
            ALERT_LABEL,
            "--description",
            "Routine release exceeded the 300s delivery limit",
            "--color",
            "D93F0B",
          ]);
        } catch (labelError) {
          if (!/already exists/i.test(String(labelError?.stderr ?? labelError?.message ?? ""))) throw labelError;
        }
        raw = gh(["issue", "create", "--title", title, "--body-file", "-", "--label", ALERT_LABEL], {
          input: body,
        });
      }
      const match = String(raw).match(/\/issues\/(\d+)/);
      if (!match) throw new Error("GitHub issue creation returned no issue number");
      return { number: Number(match[1]), url: String(raw).trim() };
    },
    async comment(number, body) {
      gh(["issue", "comment", String(number), "--body-file", "-"], { input: body });
      return { number };
    },
  };
}

function issueBody({ receipt, fingerprint, bottleneck, now, firstEditMs = null }) {
  const slowest = receipt.stages
    .slice()
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5)
    .map((stage) => `| ${stage.name.replaceAll("|", "/")} | ${(stage.durationMs / 1000).toFixed(1)}s |`)
    .join("\n");
  const timing = firstEditMs === null
    ? "Routine release exceeded the 300s delivery limit"
    : "First edit → exact live identity reached the 300s delivery limit";
  const firstEditRow = firstEditMs === null ? "" : `| First edit → live | ${firstEditMs} ms |
`;
  const focus = firstEditMs === null
    ? "Remove repeated full gates, duplicate builds, serial waits or avoidable propagation retries only where the same risk stays covered."
    : "Inspect the time between the first relevant edit and the start of the guard.";
  return `<!-- ${MARKER_PREFIX}${fingerprint} -->
## ${timing}

A real release path crossed the strict five-minute limit. This is a **timing SLO
breach**, not a claim that the deployed code is wrong. The safe release was allowed
to finish; do not kill an upload or migration mid-flight to satisfy the clock.

| Field | Value |
|---|---|
| Repository | \`${receipt.repo}\` |
| Project | \`${receipt.project}\` |
| Release path | \`${receipt.releasePath}\` |
| Source | \`${receipt.sha}\` |
| Run | \`${receipt.runId}\` |
| Status | **${receipt.status}** |
| Guard total | ${(receipt.totalMs / 1000).toFixed(1)}s (limit 300.0s, target 180.0s) |
${firstEditRow}| Timing category | ${bottleneck} |
| Observed | ${iso(now)} |

### Slowest stages

| Stage | Duration |
|---|---:|
${slowest}

### What to inspect

1. Read the private redacted receipt for this run in \`.release/timing/\`.
2. ${focus}
3. Do not weaken security, data-integrity, identity, payment or hardware checks,
   and do not add a second mandatory CI service.
4. Add a recovery receipt here after a measured compliant release. This issue is
   not auto-closed.

_Receipts contain no credentials, signed URLs or private media._
`;
}

function recoveryBody({ receipt, now, firstEditMs = null }) {
  const firstEditRow = firstEditMs === null ? "" : `| First edit → live | ${firstEditMs} ms |
`;
  return `## Measured recovery

A later routine release completed within the limit.

| Field | Value |
|---|---|
| Source | \`${receipt.sha}\` |
| Run | \`${receipt.runId}\` |
| Guard total | ${(receipt.totalMs / 1000).toFixed(1)}s |
${firstEditRow}| Status | **${receipt.status}** |
| Observed | ${iso(now)} |

This is recovery evidence only. Keep this issue open until the owner or the owning
delivery record explicitly decides it can close.
`;
}

/** Record the latest breach and clear the recovery marker from the previous one. */
function rememberIssue(breachesPath, { fingerprint, repo, releasePath, issue, at = new Date() }) {
  const state = readJson(breachesPath) ?? { schema: "release-timing-breaches/v1", issues: {} };
  state.schema = "release-timing-breaches/v1";
  state.issues = { ...(state.issues ?? {}) };
  const previous = { ...(state.issues[fingerprint] ?? {}) };
  delete previous.recoveredBy;
  delete previous.recoveredAt;
  state.issues[fingerprint] = { ...previous, repo, releasePath, issue, lastBreachAt: iso(at) };
  writeJson(breachesPath, state);
}

/** Retry redacted alert events queued when GitHub was unavailable. */
export async function flushPendingAlerts({
  pendingDir = ".release/timing/pending",
  github,
  breachesPath = join(pendingDir, "..", "breaches.json"),
} = {}) {
  const queued = existsSync(pendingDir)
    ? readdirSync(pendingDir).filter((file) => file.endsWith(".json"))
    : [];
  // A missing reporter must never read as "nothing pending": the queued event is
  // the only record of an unfiled breach. Report it so the caller fails visibly.
  if (!github)
    return {
      flushed: 0,
      remaining: queued.length,
      blocked: queued.length ? "github-adapter-unavailable" : null,
    };
  let flushed = 0;
  let remaining = 0;
  for (const name of queued) {
    const path = join(pendingDir, name);
    const pending = readJson(path);
    if (!pending?.payload?.title || !pending?.payload?.body) {
      remaining += 1;
      continue;
    }
    try {
      const existing = await github.findOpen(pending.fingerprint);
      const issue = existing
        ? await github.comment(existing.number, pending.payload.body)
        : await github.create(pending.payload);
      // An alert that arrived through the queue is still a known breach: record
      // its issue so a later compliant release can attach recovery evidence.
      if (pending.repo && pending.releasePath && Number.isInteger(issue?.number)) {
        try {
          rememberIssue(breachesPath, {
            fingerprint: pending.fingerprint,
            repo: pending.repo,
            releasePath: pending.releasePath,
            issue: issue.number,
          });
        } catch {
          // Recovery bookkeeping must not re-queue an alert that was filed.
        }
      }
      rmSync(path, { force: true });
      flushed += 1;
    } catch {
      remaining += 1;
    }
  }
  return { flushed, remaining };
}

/**
 * One run. Call `stage()` around every measured qualification/upload/live check.
 * The same clock starts before the first required final qualification and stops
 * only after exact live identity is verified.
 */
export function createReleaseRun({
  repo,
  project = repo,
  sha,
  runId = randomUUID(),
  kind = "worker-production",
  releasePath = "scripts/deploy.mjs",
  receiptDir = ".release/timing",
  targetMs = TARGET_MS,
  limitMs = LIMIT_MS,
  now = () => performance.now(),
  wallClock = () => new Date(),
  firstEditAt = null,
  github = null,
  logger = console,
  threshold = true,
} = {}) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo ?? "")) throw new Error("release run needs an owner/name repository");
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("release run needs the exact 40-character source SHA");
  const dir = receiptDir;
  const pendingDir = join(dir, "pending");
  const breachesPath = join(dir, "breaches.json");
  mkdirSync(dir, { recursive: true });

  const startedMono = now();
  const startedAt = iso(wallClock());
  const startedWallMs = Date.parse(startedAt);
  const firstEditMs = parseFirstEditAt(firstEditAt);
  const stages = [];
  let finished = false;
  let receipt = null;
  let alertPromise = null;
  let alertState = "none";
  let alertIssue = null;
  let alertFingerprint = null;
  let failed = false;
  let failure = null;
  let notes = {};

  const total = () => Math.max(0, now() - startedMono);

  const bottleneckStage = () => {
    if (!stages.length) return "qualification before the first measured stage";
    const slowest = stages.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));
    return slowest.name;
  };

  const markerFor = (fingerprint) => `<!-- ${MARKER_PREFIX}${fingerprint} -->`;

  const rememberBreach = (fingerprint, issue) => {
    rememberIssue(breachesPath, { fingerprint, repo, releasePath, issue, at: wallClock() });
  };

  const knownBreaches = () => {
    const state = readJson(breachesPath) ?? { issues: {} };
    return Object.entries(state.issues ?? {}).filter(([, value]) => value?.repo === repo && value?.releasePath === releasePath);
  };

  const pendingPath = (fingerprint) => join(pendingDir, `${fingerprint}.json`);
  const firstEditFingerprint = stableFingerprint({ repo, releasePath, bottleneck: FIRST_EDIT_BOTTLENECK });

  const queuePending = (fingerprint, payload, reason) => {
    writeJson(pendingPath(fingerprint), {
      schema: "release-timing-pending/v1",
      fingerprint,
      repo,
      releasePath,
      reason: redact(reason),
      queuedAt: iso(wallClock()),
      payload: redact(payload),
    });
  };

  const raiseAlert = async (reason, {
    bottleneck = bottleneckStage(), completedReceipt = null, firstEditMs = null,
  } = {}) => {
    const fingerprint = stableFingerprint({ repo, releasePath, bottleneck });
    alertFingerprint = fingerprint;
    const payload = {
      title: firstEditMs === null
        ? alertTitle(bottleneck)
        : `[DELIVERY SLA] ${repo} · First edit → exact live identity reached the 300s limit`,
      body: issueBody({
        receipt: completedReceipt ?? snapshot("over-budget"), fingerprint, bottleneck,
        now: wallClock(), firstEditMs,
      }),
    };
    if (!github) {
      alertState = "pending";
      queuePending(fingerprint, payload, "GitHub issue reporting is not configured");
      return;
    }
    try {
      const existing = await github.findOpen(fingerprint);
      if (existing) {
        await github.comment(existing.number, `<!-- ${MARKER_PREFIX}${fingerprint} -->\n` + payload.body);
        alertState = "updated";
        alertIssue = existing.number;
        try {
          rememberBreach(fingerprint, existing.number);
        } catch {
          // The breach comment was already posted. Keep its delivery result.
          logger.error(`Could not record local recovery state for issue #${alertIssue}.`);
        }
      } else {
        const created = await github.create(payload);
        alertState = "created";
        alertIssue = created.number;
        rememberBreach(fingerprint, created.number);
      }
      rmSync(pendingPath(fingerprint), { force: true });
      logger.log(`Delivery SLA ${alertState}: issue #${alertIssue} (${bottleneck})`);
    } catch (error) {
      alertState = "pending";
      queuePending(fingerprint, payload, error?.stderr ?? error?.message ?? String(error));
      logger.error(`Delivery SLA alert pending (${reason}): GitHub write failed; a redacted event is queued for the next run.`);
    }
    return alertState;
  };

  const alertTitle = (bottleneck = bottleneckStage()) =>
    `[DELIVERY SLA] ${repo} · Routine release exceeded 300s — ${bottleneck}`;

  const snapshot = (status = "running") => {
    const measured = stages.reduce((value, stage) => value + (Number(stage.durationMs) || 0), 0);
    return {
      schema: RECEIPT_SCHEMA,
      version: 1,
      repo,
      project,
      sha,
      runId,
      kind,
      releasePath,
      targetMs,
      limitMs,
      startedAt,
      endedAt: status === "running" ? null : iso(wallClock()),
      totalMs: round(total()),
      unmeasuredMs: round(Math.max(0, total() - measured)),
      stages: stages.map((stage) => ({ name: stage.name, durationMs: round(stage.durationMs) })),
      status,
      failure: failure ? redact(failure) : null,
      notes: redact(notes),
      alert: { state: alertState, issue: alertIssue, fingerprint: alertFingerprint },
      coverage: notes.coverage ?? "measured from before the first required final qualification to exact live identity",
    };
  };

  // A running receipt is the stuck-run watchdog's only honest signal. It is
  // replaced atomically at finish; a stale one is never a green pass.
  writeJson(join(dir, `receipt-${runId}.json`), snapshot("running"));

  const maybeThreshold = async () => {
    if (!threshold || alertPromise || alertState !== "none") return;
    if (total() < limitMs) return;
    logger.error(`Delivery SLA exceeded ${(limitMs / 1000).toFixed(0)}s at ${(total() / 1000).toFixed(1)}s; reporting now.`);
    alertPromise = raiseAlert("threshold");
    await alertPromise;
  };

  return {
    get receipt() {
      return receipt;
    },
    get alertState() {
      return alertState;
    },
    get alertIssue() {
      return alertIssue;
    },
    async flushPending() {
      return flushPendingAlerts({ pendingDir, github });
    },
    async stage(name, work) {
      const started = now();
      try {
        return await work();
      } finally {
        stages.push({ name: String(name), durationMs: Math.max(0, now() - started) });
        await maybeThreshold();
      }
    },
    recordStage(name, durationMs) {
      stages.push({ name: String(name), durationMs: Math.max(0, Number(durationMs) || 0) });
    },
    note(key, value) {
      notes[String(key)] = value;
    },
    async finish({ status = "passed", liveRevision = null, target = null, reason = null } = {}) {
      if (finished) return receipt;
      finished = true;
      const elapsed = total();
      if (reason) notes.finishReason = reason;
      if (target) notes.deployTarget = target;
      if (liveRevision) notes.liveRevision = liveRevision;
      if (liveRevision && liveRevision !== sha) {
        failed = true;
        failure = failure ?? "live revision does not match the released source";
      }
      if (status === "failed") {
        failed = true;
        failure = failure ?? "release finished with an explicit failed status";
      }
      const finalStatus = failed ? "failed" : status === "incomplete" ? "incomplete" : classifyDuration(elapsed);
      notes.coverage = notes.coverage ?? "measured from before the first required final qualification to exact live identity";
      let firstEditToLiveMs = null;
      if (firstEditMs !== null && firstEditMs <= startedWallMs && liveRevision === sha &&
          !failed && finalStatus !== "incomplete") {
        firstEditToLiveMs = round(startedWallMs - firstEditMs + elapsed);
        notes.firstEditAt = new Date(firstEditMs).toISOString();
        notes.firstEditToLiveIdentityMs = firstEditToLiveMs;
      }
      receipt = snapshot(finalStatus);
      writeJson(join(dir, `receipt-${runId}.json`), assertReceipt(receipt));

      if (finalStatus === "over-budget") {
        if (!alertPromise) alertPromise = raiseAlert("completed over budget");
        await alertPromise;
      } else if (finalStatus === "passed") {
        if (firstEditToLiveMs !== null && firstEditToLiveMs >= limitMs &&
            !alertPromise && alertState === "none") {
          await raiseAlert("first-edit to live reached the limit", {
            bottleneck: FIRST_EDIT_BOTTLENECK,
            completedReceipt: receipt,
            firstEditMs: firstEditToLiveMs,
          });
        }
        // Recovery evidence is attached once to each known open issue, never auto-closed.
        const state = readJson(breachesPath) ?? { issues: {} };
        let changed = false;
        for (const [fingerprint, known] of knownBreaches()) {
          if (!github || known.recoveredBy) continue;
          const firstEditBreach = fingerprint === firstEditFingerprint;
          if (firstEditBreach && (firstEditToLiveMs === null || firstEditToLiveMs >= limitMs)) continue;
          try {
            await github.comment(
              known.issue,
              `<!-- ${MARKER_PREFIX}recovery:${runId} -->\n` + recoveryBody({ receipt, now: wallClock(), firstEditMs: firstEditBreach ? firstEditToLiveMs : null }),
            );
            state.issues[fingerprint] = { ...known, recoveredBy: runId, recoveredAt: iso(wallClock()) };
            changed = true;
          } catch {
            // A failed recovery comment must not turn a verified release green or red.
          }
        }
        if (changed) writeJson(breachesPath, state);
      }
      receipt.alert.state = alertState;
      receipt.alert.issue = alertIssue;
      receipt.alert.fingerprint = alertFingerprint;
      writeJson(join(dir, `receipt-${runId}.json`), receipt);
      return receipt;
    },
    async fail(error, { reason = "release failed before verified live identity", liveRevision = null, target = null } = {}) {
      if (finished) return receipt;
      failed = true;
      failure = redact(error?.message ?? String(error));
      return this.finish({ status: "failed", liveRevision, target, reason });
    },
  };
}

/** Find receipts that started but never finished (an externally scheduled check). */
export function findStuckRuns({ receiptDir = ".release/timing", now = new Date(), limitMs = LIMIT_MS } = {}) {
  if (!existsSync(receiptDir)) return [];
  const stuck = [];
  for (const name of readdirSync(receiptDir).filter((file) => /^receipt-.*\.json$/.test(file))) {
    const receipt = readJson(join(receiptDir, name));
    if (!receipt || receipt.status !== "running" || !receipt.startedAt) continue;
    const ageMs = now.getTime() - new Date(receipt.startedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= limitMs) stuck.push({ ...receipt, ageMs });
  }
  return stuck;
}

/** Report one stuck run through the same deduplicated alert path. */
export async function reportStuckRun({ stuck, github, logger = console }) {
  if (!github) return "pending";
  const fingerprint = stableFingerprint({
    repo: stuck.repo,
    releasePath: stuck.releasePath,
    bottleneck: "run did not finish",
  });
  const payload = {
    title: `[DELIVERY SLA] ${stuck.repo} · Release run did not finish — ${stuck.releasePath}`,
    body: `<!-- ${MARKER_PREFIX}${fingerprint} -->
## Release run did not finish within 300s

| Field | Value |
|---|---|
| Repository | \`${stuck.repo}\` |
| Release path | \`${stuck.releasePath}\` |
| Source | \`${stuck.sha}\` |
| Run | \`${stuck.runId}\` |
| Started | ${stuck.startedAt} |
| Observed age | ${(stuck.ageMs / 1000).toFixed(1)}s |

The run never recorded verified live identity. Inspect the host process, then
record a fresh measured release. Do not treat a stale receipt as a pass.
`,
  };
  try {
    const existing = await github.findOpen(fingerprint);
    if (existing) await github.comment(existing.number, payload.body);
    else await github.create(payload);
    return existing ? "updated" : "created";
  } catch (error) {
    logger.error(`Delivery SLA stuck alert pending: ${redact(error?.message ?? String(error))}`);
    return "pending";
  }
}
