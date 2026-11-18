import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LIMIT_MS,
  assertReceipt,
  classifyDuration,
  createReleaseRun,
  createGitHubAdapter,
  findStuckRuns,
  flushPendingAlerts,
  isWithinLimit,
  redact,
  reportStuckRun,
  stableFingerprint,
} from "../scripts/lib/release-timing.mjs";

const SHA = "a".repeat(40);
const FE_GUARD_START = new Date("2026-11-16T00:05:00.000Z");

function ownedDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "release-timing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms) {
      value += ms;
    },
  };
}

function fakeGitHub() {
  const issues = [];
  let next = 1;
  return {
    issues,
    async findOpen(fingerprint) {
      return (
        issues.find((issue) =>
          String(issue.body ?? "").includes(`<!-- delivery-sla:${fingerprint} -->`),
        ) ?? null
      );
    },
    async create({ title, body }) {
      const issue = { number: next++, title, body, comments: [] };
      issues.push(issue);
      return { number: issue.number, url: `https://example.test/issues/${issue.number}` };
    },
    async comment(number, body) {
      const issue = issues.find((item) => item.number === number);
      if (!issue) throw new Error("missing issue");
      issue.comments.push(body);
      return { number };
    },
  };
}

function runFor(dir, clock, github, overrides = {}) {
  return createReleaseRun({
    repo: "loftwah/example",
    project: "example",
    sha: SHA,
    runId: `run-${Math.random().toString(16).slice(2)}`,
    receiptDir: join(dir, "timing"),
    now: clock.now,
    wallClock: () => new Date("2026-11-16T00:00:00.000Z"),
    github,
    logger: { log() {}, error() {} },
    ...overrides,
  });
}

// A run whose guard stays fast (guardAdvanceMs) while the supplied first-edit
// gap supplies the rest, so firstEditToLiveIdentityMs === firstEditToLiveMs.
function firstEditRun(dir, clock, github, { firstEditToLiveMs, guardAdvanceMs = 1_000 }) {
  const gap = firstEditToLiveMs - guardAdvanceMs;
  const firstEditAt = new Date(FE_GUARD_START.getTime() - gap).toISOString();
  return {
    firstEditAt,
    run: runFor(dir, clock, github, { wallClock: () => FE_GUARD_START, firstEditAt }),
  };
}

test("the limit is strict: 299,999 passes and 300,000 is already a breach", () => {
  assert.equal(isWithinLimit(299_999), true);
  assert.equal(isWithinLimit(300_000), false);
  assert.equal(isWithinLimit(300_001), false);
  assert.equal(classifyDuration(299_999), "passed");
  assert.equal(classifyDuration(300_000), "over-budget");
  assert.equal(classifyDuration(300_001), "over-budget");
  assert.equal(classifyDuration(10, { failed: true }), "failed");
});

for (const [label, duration, expected, alerts] of [
  ["pass at 299,999ms", 299_999, "passed", 0],
  ["breach at exactly 300,000ms", 300_000, "over-budget", 1],
  ["breach at 300,001ms", 300_001, "over-budget", 1],
]) {
  test(label, async (t) => {
    const dir = ownedDir(t);
    const clock = fakeClock();
    const github = fakeGitHub();
    const run = runFor(dir, clock, github);
    await run.stage("qualification", async () => {
      clock.advance(duration);
    });
    const receipt = await run.finish({ liveRevision: SHA });
    assert.equal(receipt.status, expected);
    assert.equal(github.issues.length, alerts);
    assert.equal(receipt.alert.state, alerts ? "created" : "none");
    assert.equal(assertReceipt(receipt).schema, "release-timing/v1");
  });
}

test("a breach alerts while the run is still running", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const github = fakeGitHub();
  const run = runFor(dir, clock, github);
  await run.stage("upload", async () => {
    clock.advance(LIMIT_MS);
  });
  assert.equal(github.issues.length, 1);
  assert.equal(run.alertState, "created");
  await run.stage("live verification", async () => clock.advance(10));
  await run.finish({ liveRevision: SHA });
  assert.equal(github.issues.length, 1, "one issue per bottleneck");
});

test("the same bottleneck updates one issue; a different bottleneck opens another", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const github = fakeGitHub();

  const first = runFor(dir, clock, github);
  await first.stage("Worker upload", async () => clock.advance(LIMIT_MS));
  await first.finish({ liveRevision: SHA });
  assert.equal(github.issues.length, 1);

  const second = runFor(dir, clock, github);
  await second.stage("Worker upload", async () => clock.advance(LIMIT_MS));
  await second.finish({ liveRevision: SHA });
  assert.equal(github.issues.length, 1);
  assert.equal(github.issues[0].comments.length, 1);
  assert.match(github.issues[0].comments[0], /Worker upload/);

  const third = runFor(dir, clock, github);
  await third.stage("Worker upload", async () => clock.advance(10));
  await third.stage("live verification", async () => clock.advance(LIMIT_MS));
  await third.finish({ liveRevision: SHA });
  assert.equal(github.issues.length, 2);
});

test("a failed run under the limit is failed, not green and not an SLA breach", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const github = fakeGitHub();
  const run = runFor(dir, clock, github);
  await assert.rejects(
    run.stage("required checks", async () => {
      clock.advance(1_000);
      throw new Error("typecheck failed");
    }),
    /typecheck failed/,
  );
  const receipt = await run.fail(new Error("typecheck failed"));
  assert.equal(receipt.status, "failed");
  assert.match(receipt.failure, /typecheck failed/);
  assert.equal(github.issues.length, 0);
});

test("a successful but slow release is deployed and recorded over-budget", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const github = fakeGitHub();
  const run = runFor(dir, clock, github);
  await run.stage("required checks", async () => clock.advance(240_000));
  await run.stage("live verification", async () => clock.advance(70_000));
  const receipt = await run.finish({ status: "passed", liveRevision: SHA });
  assert.equal(receipt.status, "over-budget");
  assert.equal(receipt.notes.liveRevision, SHA);
  assert.equal(github.issues.length, 1);
});

test("a mismatched live revision cannot produce a green receipt", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const github = fakeGitHub();
  const run = runFor(dir, clock, github);
  await run.stage("live verification", async () => clock.advance(1_000));
  const receipt = await run.finish({ liveRevision: "b".repeat(40) });
  assert.equal(receipt.status, "failed");
  assert.match(receipt.failure, /live revision/);
});

test("GitHub failure queues a redacted event and the next run retries it", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const broken = fakeGitHub();
  broken.create = async () => {
    throw new Error("gh: authentication failed for token ghp_abcdefghijklmnopqrstuvwxyz");
  };
  const run = runFor(dir, clock, broken);
  await run.stage("Worker upload", async () => clock.advance(LIMIT_MS));
  const receipt = await run.finish({ liveRevision: SHA });
  assert.equal(receipt.alert.state, "pending");
  const pending = readdirSync(join(dir, "timing", "pending"));
  assert.equal(pending.length, 1);
  const queued = readFileSync(join(dir, "timing", "pending", pending[0]), "utf8");
  assert.doesNotMatch(queued, /ghp_abcdefghijklmnopqrstuvwxyz/);

  const github = fakeGitHub();
  const retry = runFor(dir, fakeClock(), github);
  const flushed = await retry.flushPending();
  assert.equal(flushed.flushed, 1);
  assert.equal(github.issues.length, 1);
  assert.equal(readdirSync(join(dir, "timing", "pending")).length, 0);
});

test("an unfiled alert is never reported as a clean retry", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const run = runFor(dir, clock, null);
  await run.stage("Worker upload", async () => clock.advance(LIMIT_MS));
  const receipt = await run.finish({ liveRevision: SHA });
  assert.equal(receipt.alert.state, "pending");
  const pendingDir = join(dir, "timing", "pending");
  const queued = readdirSync(pendingDir);
  assert.equal(queued.length, 1);
  assert.equal(receipt.alert.fingerprint, queued[0].replace(/\.json$/, ""));

  const blocked = await flushPendingAlerts({ pendingDir, github: null });
  assert.deepEqual(blocked, {
    flushed: 0,
    remaining: 1,
    blocked: "github-adapter-unavailable",
  });
  assert.equal(readdirSync(pendingDir).length, 1, "the breach stays queued for a real retry");

  const empty = await flushPendingAlerts({ pendingDir: join(dir, "nothing"), github: null });
  assert.deepEqual(empty, { flushed: 0, remaining: 0, blocked: null });
});

test("a queued alert that is later filed still gains recovery evidence", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const queued = runFor(dir, clock, null);
  await queued.stage("Worker upload", async () => clock.advance(LIMIT_MS));
  await queued.finish({ liveRevision: SHA });

  const github = fakeGitHub();
  const flushed = await flushPendingAlerts({ pendingDir: join(dir, "timing", "pending"), github });
  assert.equal(flushed.flushed, 1);
  assert.equal(github.issues.length, 1);

  const passing = runFor(dir, fakeClock(), github);
  await passing.stage("Worker upload", async () => {});
  const receipt = await passing.finish({ liveRevision: SHA });
  assert.equal(receipt.status, "passed");
  assert.equal(github.issues[0].comments.length, 1);
  assert.match(github.issues[0].comments[0], /Measured recovery/);

  const second = runFor(dir, fakeClock(), github);
  await second.stage("Worker upload", async () => {});
  await second.finish({ liveRevision: SHA });
  assert.equal(github.issues[0].comments.length, 1, "recovery evidence is not spammed");
});

test("an explicitly failed finish cannot produce a green receipt", async (t) => {
  const dir = ownedDir(t);
  const github = fakeGitHub();
  const run = runFor(dir, fakeClock(), github);
  await run.stage("required checks", async () => {});
  const receipt = await run.finish({ status: "failed" });
  assert.equal(receipt.status, "failed");
  assert.ok(receipt.failure, "a failed receipt names the failure");
  assert.equal(github.issues.length, 0, "a failed run is not an SLA breach");
});

test("a passing release adds recovery evidence once without closing the issue", async (t) => {
  const dir = ownedDir(t);
  const github = fakeGitHub();
  // Use a dedicated clock for the breach so the boundary is exact.
  const breachClock = fakeClock();
  const breach = runFor(dir, breachClock, github);
  await breach.stage("Worker upload", async () => breachClock.advance(LIMIT_MS));
  await breach.finish({ liveRevision: SHA });
  assert.equal(github.issues.length, 1);

  const pass = runFor(dir, fakeClock(), github);
  await pass.stage("Worker upload", async () => {});
  const receipt = await pass.finish({ liveRevision: SHA });
  assert.equal(receipt.status, "passed");
  assert.equal(github.issues[0].comments.length, 1);
  assert.match(github.issues[0].comments[0], /Measured recovery/);

  const secondPass = runFor(dir, fakeClock(), github);
  await secondPass.stage("Worker upload", async () => {});
  await secondPass.finish({ liveRevision: SHA });
  assert.equal(github.issues[0].comments.length, 1, "recovery evidence is not spammed");
});

test("redaction removes credentials, token query values and secret fields", () => {
  const safe = redact({
    token: "ghp_abcdefghijklmnopqrstuvwxyz",
    url: "https://user:password@example.test/path?token=abc123&ok=1",
    note: "Bearer abcdefghijklmnop.qrstuvwxyz",
  });
  assert.equal(safe.token, "[redacted]");
  assert.doesNotMatch(safe.url, /user|password|abc123/);
  assert.doesNotMatch(safe.note, /abcdefghijklmnop/);
});

test("a stale running receipt is found and reported, never treated as a pass", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const run = runFor(dir, clock, fakeGitHub(), {
    wallClock: () => new Date("2026-11-16T00:00:00.000Z"),
  });
  await run.stage("required checks", async () => clock.advance(1_000));
  assert.equal(run.receipt, null, "an unfinished run has no final receipt");
  const stuck = findStuckRuns({
    receiptDir: join(dir, "timing"),
    now: new Date("2026-11-16T00:06:00.000Z"),
  });
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].sha, SHA);
  const github = fakeGitHub();
  assert.equal(await reportStuckRun({ stuck: stuck[0], github, logger: { error() {} } }), "created");
  assert.equal(github.issues.length, 1);
  assert.match(github.issues[0].title, /did not finish/);
});

test("a forged or tampered receipt is refused", () => {
  const valid = {
    schema: "release-timing/v1",
    sha: SHA,
    runId: "run-12345678",
    stages: [{ name: "checks", durationMs: 1_000 }],
    totalMs: 1_000,
    liveRevision: SHA,
  };
  assert.equal(assertReceipt(valid).sha, SHA);
  assert.throws(() => assertReceipt({ ...valid, liveRevision: "b".repeat(40) }), /live revision/);
  assert.throws(() => assertReceipt({ ...valid, stages: [{ name: "checks", durationMs: 99_999 }] }), /exceed the total/);
  assert.throws(() => assertReceipt({ ...valid, schema: "other" }), /schema/);
});

test("one fingerprint identifies one repo, release path and bottleneck", () => {
  const base = { repo: "loftwah/example", releasePath: "scripts/deploy.mjs", bottleneck: "upload" };
  assert.equal(stableFingerprint(base), stableFingerprint({ ...base }));
  assert.notEqual(stableFingerprint(base), stableFingerprint({ ...base, bottleneck: "checks" }));
  assert.notEqual(stableFingerprint(base), stableFingerprint({ ...base, repo: "loftwah/other" }));
});

test("the GitHub adapter allows a bounded multi-megabyte issue list", async () => {
  let options = null;
  const github = createGitHubAdapter({
    repo: "loftwah/example",
    exec: (_command, _args, received) => {
      options = received;
      return "[]";
    },
  });
  await github.findOpen("fingerprint");
  assert.ok(options.maxBuffer >= 32 * 1024 * 1024);
});

test("the real adapter files one issue per fingerprint and comments on the next match", async () => {
  const issues = [];
  let next = 1;
  // Stateful `gh` stand-in that honours the real argv and the stdin body the
  // adapter sends with --body-file -.
  const exec = (_command, argv, options = {}) => {
    const args = argv.slice(2); // drop --repo owner/name
    const body = String(options.input ?? "");
    if (args[0] === "issue" && args[1] === "list")
      return JSON.stringify(issues.map((issue) => ({ number: issue.number, title: issue.title, body: issue.body })));
    if (args[0] === "issue" && args[1] === "create") {
      const issue = { number: next++, title: args[args.indexOf("--title") + 1], body, comments: [] };
      issues.push(issue);
      return `https://github.com/loftwah/composer-media-studio/issues/${issue.number}`;
    }
    if (args[0] === "issue" && args[1] === "comment") {
      issues.find((issue) => issue.number === Number(args[2])).comments.push(body);
      return "";
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  const github = createGitHubAdapter({ repo: "loftwah/composer-media-studio", exec });
  const fingerprint = (bottleneck) =>
    stableFingerprint({ repo: "loftwah/composer-media-studio", releasePath: "scripts/deploy.mjs", bottleneck });

  const upload = fingerprint("Worker upload");
  assert.equal(await github.findOpen(upload), null);
  const created = await github.create({
    title: "[DELIVERY SLA] Routine release exceeded 300s — Worker upload",
    body: `<!-- delivery-sla:${upload} -->`,
  });
  assert.equal(created.number, 1);

  const existing = await github.findOpen(upload);
  assert.equal(existing.number, 1, "the marker in the stored body identifies the open issue");
  await github.comment(existing.number, "second breach of the same bottleneck");
  assert.equal(issues.length, 1, "a matching breach never opens a second issue");
  assert.equal(issues[0].comments.length, 1);

  const checks = fingerprint("required checks");
  assert.equal(await github.findOpen(checks), null);
  await github.create({ title: "different bottleneck", body: `<!-- delivery-sla:${checks} -->` });
  assert.equal(issues.length, 2, "a different bottleneck opens a separate issue");
});

test("first-edit note adds the UTC start→guard gap to the monotonic guard interval", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const run = runFor(dir, clock, fakeGitHub(), {
    wallClock: () => new Date("2026-11-16T00:02:00.000Z"),
    firstEditAt: "2026-11-15T23:59:30.000Z", // 150s before the guard start
  });
  await run.stage("live verification", async () => clock.advance(40_000));
  const receipt = await run.finish({ liveRevision: SHA });
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.totalMs, 40_000, "the monotonic guard interval is unchanged");
  assert.equal(receipt.notes.firstEditAt, "2026-11-15T23:59:30.000Z");
  assert.equal(receipt.notes.firstEditToLiveIdentityMs, 150_000 + 40_000);
  assert.equal(redact(receipt).notes.firstEditAt, receipt.notes.firstEditAt, "the note is redaction-stable");
});

test("invalid, future and unverified first-edit values leave the note absent", async (t) => {
  const dir = ownedDir(t);
  const guardStart = new Date("2026-11-16T00:00:30.000Z");
  const secretish = "ghp_firstEditSecretValue1234567890";
  const logged = [];
  const logger = {
    log: (...parts) => logged.push(parts.join(" ")),
    error: (...parts) => logged.push(parts.join(" ")),
  };

  for (const value of [
    secretish, // invalid and secret-shaped
    "2026-11-16T00:00:00-05:00", // not a UTC Z instant
    "2026-02-30T00:00:00.000Z", // not a real date
    "2026-11-16T00:01:00.000Z", // future relative to the guard start
  ]) {
    const clock = fakeClock();
    const run = runFor(dir, clock, fakeGitHub(), { wallClock: () => guardStart, firstEditAt: value, logger });
    await run.stage("live verification", async () => clock.advance(1_000));
    const receipt = await run.finish({ liveRevision: SHA });
    assert.equal(receipt.status, "passed");
    assert.equal(receipt.totalMs, 1_000, "guard timing is never reset");
    assert.ok(!("firstEditAt" in receipt.notes));
    assert.ok(!("firstEditToLiveIdentityMs" in receipt.notes));
    assert.ok(!logged.some((line) => line.includes(secretish)), "the raw value is never logged");
  }

  // A valid timestamp alone is not enough: the exact released source must be verified.
  const mismatchClock = fakeClock();
  const mismatch = runFor(dir, mismatchClock, fakeGitHub(), {
    wallClock: () => guardStart,
    firstEditAt: "2026-11-15T23:59:00.000Z",
  });
  await mismatch.stage("live verification", async () => mismatchClock.advance(1_000));
  const failed = await mismatch.finish({ liveRevision: "b".repeat(40) });
  assert.equal(failed.status, "failed");
  assert.ok(!("firstEditAt" in failed.notes));

  const noLiveClock = fakeClock();
  const noLive = runFor(dir, noLiveClock, fakeGitHub(), {
    wallClock: () => guardStart,
    firstEditAt: "2026-11-15T23:59:00.000Z",
  });
  await noLive.stage("live verification", async () => noLiveClock.advance(1_000));
  const unfinished = await noLive.finish({ status: "passed" });
  assert.ok(!("firstEditAt" in unfinished.notes), "no verified live revision means no note");
});

// ---- first-edit-only breach alert (issue #624, distinct from the guard SLO) ----

for (const [label, firstEditToLiveMs, expectedAlerts] of [
  ["first-edit 299,999ms passes", 299_999, 0],
  ["first-edit exactly 300,000ms breaches", 300_000, 1],
  ["first-edit 300,001ms breaches", 300_001, 1],
]) {
  test(label, async (t) => {
    const dir = ownedDir(t);
    const clock = fakeClock();
    const github = fakeGitHub();
    const { run, firstEditAt } = firstEditRun(dir, clock, github, { firstEditToLiveMs });
    await run.stage("live verification", async () => clock.advance(1_000));
    const receipt = await run.finish({ liveRevision: SHA });
    assert.equal(receipt.status, "passed", "the guard classification is unchanged");
    assert.equal(receipt.totalMs, 1_000, "the guard total is unchanged");
    assert.equal(receipt.notes.firstEditToLiveIdentityMs, firstEditToLiveMs);
    assert.equal(github.issues.length, expectedAlerts);
    assert.equal(receipt.alert.state, expectedAlerts ? "created" : "none");
    if (expectedAlerts) {
      assert.match(github.issues[0].title, /First edit/);
      assert.ok(github.issues[0].body.includes(`| First edit → live | ${firstEditToLiveMs} ms |`));
      assert.ok(!github.issues[0].body.includes(firstEditAt), "no raw input time in GitHub");
    }
  });
}

test("a first-edit alert needs a verified exact live revision", async (t) => {
  const dir = ownedDir(t);

  const mismatchClock = fakeClock();
  const mismatchGithub = fakeGitHub();
  const mismatch = firstEditRun(dir, mismatchClock, mismatchGithub, { firstEditToLiveMs: 320_000 }).run;
  await mismatch.stage("live verification", async () => mismatchClock.advance(1_000));
  const failed = await mismatch.finish({ liveRevision: "b".repeat(40) });
  assert.equal(failed.status, "failed");
  assert.equal(mismatchGithub.issues.length, 0);
  assert.ok(!("firstEditToLiveIdentityMs" in failed.notes));

  const noLiveClock = fakeClock();
  const noLiveGithub = fakeGitHub();
  const noLive = firstEditRun(dir, noLiveClock, noLiveGithub, { firstEditToLiveMs: 320_000 }).run;
  await noLive.stage("live verification", async () => noLiveClock.advance(1_000));
  const unverified = await noLive.finish({ status: "passed" });
  assert.equal(unverified.status, "passed");
  assert.equal(noLiveGithub.issues.length, 0);
  assert.ok(!("firstEditToLiveIdentityMs" in unverified.notes));
});

test("a guard breach does not also raise a second first-edit alert", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const github = fakeGitHub();
  const firstEditAt = new Date(FE_GUARD_START.getTime() - 400_000).toISOString();
  const run = runFor(dir, clock, github, { wallClock: () => FE_GUARD_START, firstEditAt });
  await run.stage("upload", async () => clock.advance(LIMIT_MS));
  const receipt = await run.finish({ liveRevision: SHA });
  assert.equal(receipt.status, "over-budget");
  assert.equal(github.issues.length, 1, "only the guard alert is filed");
  assert.equal(receipt.notes.firstEditToLiveIdentityMs, 400_000 + LIMIT_MS);
  assert.match(github.issues[0].title, /Routine release exceeded 300s/);
});

test("a first-edit breach gets no false recovery from missing or still-slow timing", async (t) => {
  const dir = ownedDir(t);
  const github = fakeGitHub();

  const breachClock = fakeClock();
  const breach = firstEditRun(dir, breachClock, github, { firstEditToLiveMs: 320_000 }).run;
  await breach.stage("live verification", async () => breachClock.advance(1_000));
  await breach.finish({ liveRevision: SHA });
  assert.equal(github.issues.length, 1);
  const issue = github.issues[0];

  // Another slow release of the same kind deduplicates to a comment, not recovery.
  const slowClock = fakeClock();
  const slow = firstEditRun(dir, slowClock, github, { firstEditToLiveMs: 310_000 }).run;
  await slow.stage("live verification", async () => slowClock.advance(1_000));
  await slow.finish({ liveRevision: SHA });
  assert.equal(github.issues.length, 1);
  assert.equal(issue.comments.length, 1);
  assert.doesNotMatch(issue.comments[0], /Measured recovery/);

  // A guard-passing release with no first-edit timing is not recovery either.
  const noTiming = runFor(dir, fakeClock(), github);
  await noTiming.stage("live verification", async () => {});
  await noTiming.finish({ liveRevision: SHA });
  assert.equal(issue.comments.length, 1, "missing timing is not recovery");

  // A genuinely compliant first-edit span attaches recovery evidence once.
  const okClock = fakeClock();
  const ok = firstEditRun(dir, okClock, github, { firstEditToLiveMs: 120_000 }).run;
  await ok.stage("live verification", async () => okClock.advance(1_000));
  await ok.finish({ liveRevision: SHA });
  assert.match(issue.comments.at(-1), /Measured recovery/);
  assert.match(issue.comments.at(-1), /120000 ms/);
});

test("a queued first-edit breach is filed by the pending path without raw input time", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const { run, firstEditAt } = firstEditRun(dir, clock, null, { firstEditToLiveMs: 310_000 });
  await run.stage("live verification", async () => clock.advance(1_000));
  const receipt = await run.finish({ liveRevision: SHA });
  assert.equal(receipt.alert.state, "pending");
  const pendingDir = join(dir, "timing", "pending");
  assert.equal(readdirSync(pendingDir).length, 1);
  const queued = readFileSync(join(pendingDir, `${receipt.alert.fingerprint}.json`), "utf8");
  assert.match(queued, /First edit/);
  assert.ok(!queued.includes(firstEditAt), "the raw operator timestamp is not queued");

  const github = fakeGitHub();
  const flushed = await flushPendingAlerts({ pendingDir, github });
  assert.equal(flushed.flushed, 1);
  assert.equal(github.issues.length, 1);
  assert.match(github.issues[0].body, /First edit/);
  assert.ok(!github.issues[0].body.includes(firstEditAt), "the raw operator timestamp never reaches GitHub");
  assert.equal(readdirSync(pendingDir).length, 0);

  // The queued event keeps its breach identity: later missing timing is not recovery.
  const noTiming = runFor(dir, fakeClock(), github);
  await noTiming.stage("live verification", async () => {});
  await noTiming.finish({ liveRevision: SHA });
  assert.equal(github.issues[0].comments.length, 0);
});

test("a date -u seconds-only edit time is accepted and stored normalized", async (t) => {
  const dir = ownedDir(t);
  const clock = fakeClock();
  const github = fakeGitHub();
  const guardStart = new Date("2026-11-17T08:42:32.000Z");
  const run = runFor(dir, clock, github, {
    wallClock: () => guardStart,
    firstEditAt: "2026-11-17T08:42:22Z", // exact date -u value from #718
  });
  await run.stage("live verification", async () => clock.advance(10_000));
  const receipt = await run.finish({ liveRevision: SHA });
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.notes.firstEditAt, "2026-11-17T08:42:22.000Z", "stored note is normalized");
  assert.equal(receipt.notes.firstEditToLiveIdentityMs, 10_000 + 10_000);
  assert.equal(github.issues.length, 0);
});

test("seconds-only edit times still reject rollover, offsets and whitespace", async (t) => {
  const dir = ownedDir(t);
  const guardStart = new Date("2026-12-01T00:00:00.000Z");
  for (const value of [
    "2026-02-30T08:42:22Z", // calendar rollover to 2026-03-02
    "2026-11-17T24:00:00Z", // hour rollover to 2026-11-18
    "2026-11-17T08:42:22+00:00", // an explicit offset, even zero
    "2026-11-17T08:42:22Z ", // trailing whitespace
    " 2026-11-17T08:42:22Z", // leading whitespace
    "2026-11-17T08:42:22.12Z", // wrong fractional width
  ]) {
    const clock = fakeClock();
    const run = runFor(dir, clock, fakeGitHub(), {
      wallClock: () => guardStart,
      firstEditAt: value,
    });
    await run.stage("live verification", async () => clock.advance(1_000));
    const receipt = await run.finish({ liveRevision: SHA });
    assert.equal(receipt.status, "passed", value);
    assert.ok(!("firstEditAt" in receipt.notes), `accepted rollover/offset/whitespace: ${value}`);
    assert.ok(!("firstEditToLiveIdentityMs" in receipt.notes), value);
  }
});

test("a renewed breach on the same issue permits one new measured recovery", async (t) => {
  const dir = ownedDir(t);
  const github = fakeGitHub();
  // Each run uses a fresh guard clock advanced by the helper's 1s default, so
  // firstEditToLiveIdentityMs matches the supplied first-edit span exactly.
  const advance = (clock) => async () => clock.advance(1_000);

  // First over-budget first-edit release: one issue, no comment on creation.
  const breachClock = fakeClock();
  const breach = firstEditRun(dir, breachClock, github, { firstEditToLiveMs: 320_000 }).run;
  await breach.stage("live verification", advance(breachClock));
  const breachReceipt = await breach.finish({ liveRevision: SHA });
  assert.equal(github.issues.length, 1);
  const issue = github.issues[0];
  assert.equal(issue.comments.length, 0);
  assert.equal(breachReceipt.alert.state, "created");

  // A measured compliant release attaches recovery evidence exactly once.
  const recoveryClock = fakeClock();
  const recovery = firstEditRun(dir, recoveryClock, github, { firstEditToLiveMs: 120_000 }).run;
  await recovery.stage("live verification", advance(recoveryClock));
  const recoveryReceipt = await recovery.finish({ liveRevision: SHA });
  assert.equal(recoveryReceipt.status, "passed", "the guard outcome is unchanged");
  assert.equal(github.issues.length, 1, "recovery never opens a second issue");
  assert.equal(issue.comments.length, 1);
  assert.match(issue.comments[0], /Measured recovery/);

  // A renewed real breach updates the same open issue, not a new one.
  const renewedClock = fakeClock();
  const renewed = firstEditRun(dir, renewedClock, github, { firstEditToLiveMs: 310_000 }).run;
  await renewed.stage("live verification", advance(renewedClock));
  const renewedReceipt = await renewed.finish({ liveRevision: SHA });
  assert.equal(github.issues.length, 1, "the deduplicated breach stays on one issue");
  assert.equal(issue.comments.length, 2);
  assert.doesNotMatch(issue.comments[1], /Measured recovery/);
  assert.equal(renewedReceipt.alert.state, "updated");

  // That renewed breach permits exactly one further measured recovery.
  const againClock = fakeClock();
  const again = firstEditRun(dir, againClock, github, { firstEditToLiveMs: 110_000 }).run;
  await again.stage("live verification", advance(againClock));
  const againReceipt = await again.finish({ liveRevision: SHA });
  assert.equal(againReceipt.status, "passed");
  assert.equal(github.issues.length, 1);
  assert.equal(issue.comments.length, 3);
  assert.match(issue.comments[2], /Measured recovery/);
  assert.match(issue.comments[2], /110000 ms/);

  // A further green run is ignored: no repeated green comment.
  const repeatClock = fakeClock();
  const repeat = firstEditRun(dir, repeatClock, github, { firstEditToLiveMs: 100_000 }).run;
  await repeat.stage("live verification", advance(repeatClock));
  await repeat.finish({ liveRevision: SHA });
  assert.equal(github.issues.length, 1);
  assert.equal(issue.comments.length, 3, "repeat green is ignored");
});
