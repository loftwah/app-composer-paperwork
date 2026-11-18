import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLBAR_CHECK = fileURLToPath(
  new URL("../scripts/toolbar-check.mjs", import.meta.url),
);

const waitForFile = async (path, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${path}`);
};

// A tiny owned-browser stand-in: reaching goto proves the script installed its
// signal handlers, started its listener and launched the browser, then it parks
// there until signalled. The keep-alive interval is cleared by the owned close
// so a caught check failure can still exit naturally with its receipt intact.
const fakeModule = (ready, close, fail = "") => `
  const fs = require('node:fs');
  const keepAlive = setInterval(() => {}, 1000);
  module.exports = {
    chromium: { launch: async () => ({
      version: () => 'test-browser',
      newContext: async () => ({
        newPage: async () => ({
          on: () => {},
          goto: async (url) => {
            ${fail}
            fs.writeFileSync(${JSON.stringify(ready)}, url);
            return new Promise(() => {});
          },
        }),
      }),
      close: async () => {
        clearInterval(keepAlive);
        ${close}
      },
    }) },
  };`;

const spawnCheck = (root, module, evidence, completion) =>
  spawn(process.execPath, [TOOLBAR_CHECK], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PLAYWRIGHT_MODULE: module,
      PAPERWORK_ORIGIN: "",
      PAPERWORK_EVIDENCE: evidence,
      LOFTWAH_VALIDATION_COMPLETION: completion,
      LOFTWAH_VALIDATION_GENERATION: "test",
    },
  });

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`toolbar-check closes its owned browser and listener on ${signal}, writes the receipt and leaves foreign work alone`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "paperwork-toolbar-signal-"));
    const ready = join(root, "ready");
    const closed = join(root, "closed");
    const module = join(root, "fake-playwright.cjs");
    const evidence = join(root, "evidence");
    const completion = join(root, "completion.json");
    const decoy = join(evidence, "unrelated.txt");
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(
      module,
      fakeModule(ready, `fs.writeFileSync(${JSON.stringify(closed)}, 'closed')`),
    );
    await mkdir(evidence, { recursive: true });
    await writeFile(decoy, "unrelated work");

    const foreign = createServer((_req, res) => res.end("alive"));
    await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
    const foreignPort = foreign.address().port;
    t.after(() => new Promise((resolve) => foreign.close(resolve)));

    // cwd is the owned temp root so the caller-declared evidence stays disposable.
    const child = spawnCheck(root, module, evidence, completion);
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    });
    const exited = once(child, "exit");
    const origin = await waitForFile(ready);
    // The owned listener is live before the interrupt and accepts a request.
    assert.ok(
      (await fetch(origin, { signal: AbortSignal.timeout(2000) })).status >= 100,
      "owned listener should be live before the signal",
    );

    assert.equal(child.kill(signal), true, "signal reaches the owned process");
    const [exitCode, exitSignal] = await exited;
    assert.equal(exitSignal, null);
    assert.equal(exitCode, code, "the conventional signal exit code survives");

    assert.equal(await readFile(closed, "utf8"), "closed", "owned browser closed");
    await assert.rejects(
      fetch(origin, { signal: AbortSignal.timeout(2000) }),
      "owned listener must be released",
    );
    const receipt = JSON.parse(
      await readFile(join(evidence, "toolbar-receipt.json"), "utf8"),
    );
    assert.equal(receipt.pass, false, "an interrupted run is not a pass");
    assert.equal(receipt.interrupted, signal, "the owned signal handler ran");
    assert.deepEqual(receipt.checks, {}, "no checks are invented on interrupt");
    assert.deepEqual(
      JSON.parse(await readFile(completion, "utf8")),
      { version: 1, generation: "test", cleanup: "complete" },
      "completion marker follows a settled owned close",
    );
    assert.equal(
      await readFile(decoy, "utf8"),
      "unrelated work",
      "unrelated files in the evidence directory survive",
    );
    assert.equal(
      await (await fetch(`http://127.0.0.1:${foreignPort}`)).text(),
      "alive",
      "an unrelated listener keeps answering throughout",
    );
  });
}

test("toolbar-check withholds the completion marker when the owned close fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "paperwork-toolbar-closefail-"));
  const ready = join(root, "ready");
  const module = join(root, "fake-playwright.cjs");
  const evidence = join(root, "evidence");
  const completion = join(root, "completion.json");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(module, fakeModule(ready, `throw new Error('close failed')`));

  const child = spawnCheck(root, module, evidence, completion);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  const exited = once(child, "exit");
  await waitForFile(ready);
  assert.equal(child.kill("SIGINT"), true);
  const [exitCode, exitSignal] = await exited;
  assert.deepEqual([exitCode, exitSignal], [130, null]);
  const receipt = JSON.parse(
    await readFile(join(evidence, "toolbar-receipt.json"), "utf8"),
  );
  assert.equal(receipt.pass, false, "a failed close is not reported as a pass");
  assert.equal(receipt.interrupted, "SIGINT", "the owned signal handler ran");
  await assert.rejects(
    readFile(completion, "utf8"),
    "no completion marker after a failed owned close",
  );
});

test("toolbar-check records an honest failure and still releases owned resources when a check throws", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "paperwork-toolbar-throw-"));
  const ready = join(root, "ready");
  const closed = join(root, "closed");
  const module = join(root, "fake-playwright.cjs");
  const evidence = join(root, "evidence");
  const completion = join(root, "completion.json");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    module,
    fakeModule(
      ready,
      `fs.writeFileSync(${JSON.stringify(closed)}, 'closed')`,
      "throw new Error('check failed')",
    ),
  );

  const child = spawnCheck(root, module, evidence, completion);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const [exitCode, exitSignal] = await once(child, "exit");
  assert.equal(exitSignal, null);
  assert.equal(exitCode, 1, "the original check failure still fails the run");
  assert.match(stderr, /check failed/);
  assert.equal(await readFile(closed, "utf8"), "closed", "owned browser closed");
  const receipt = JSON.parse(
    await readFile(join(evidence, "toolbar-receipt.json"), "utf8"),
  );
  assert.equal(receipt.pass, false, "a thrown check is not reported as a pass");
  assert.equal(receipt.interrupted, undefined, "no signal was involved");
  assert.match(receipt.failure, /check failed/, "failure is kept as evidence");
  assert.deepEqual(
    JSON.parse(await readFile(completion, "utf8")),
    { version: 1, generation: "test", cleanup: "complete" },
    "cleanup settled, so the completion marker is published",
  );
});
