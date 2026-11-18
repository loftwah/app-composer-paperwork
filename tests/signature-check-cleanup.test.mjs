import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SIGNATURE_CHECK = fileURLToPath(
  new URL("../scripts/signature-check.mjs", import.meta.url),
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
// signal handlers and launched the browser, then it parks there until signalled.
const fakeModule = (ready, close, fail = "") => `
  const fs = require('node:fs');
  setInterval(() => {}, 1000); // keep the loop alive until signalled
  module.exports = {
    chromium: { launch: async () => ({
      version: () => 'test-browser',
      newContext: async () => ({
        newPage: async () => ({
          on: () => {},
          goto: async () => {
            ${fail}
            fs.writeFileSync(${JSON.stringify(ready)}, 'goto');
            return new Promise(() => {});
          },
        }),
      }),
      close: async () => { ${close} },
    }) },
  };`;

const spawnCheck = (root, module, evidence) =>
  spawn(process.execPath, [SIGNATURE_CHECK], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PLAYWRIGHT_MODULE: module,
      PAPERWORK_ORIGIN: "http://127.0.0.1:1",
      PAPERWORK_EVIDENCE: evidence,
    },
  });

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`signature-check closes its owned browser on ${signal} and leaves unrelated work alone`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "paperwork-signature-signal-"));
    const ready = join(root, "ready");
    const closed = join(root, "closed");
    const module = join(root, "fake-playwright.cjs");
    const evidence = join(root, "evidence");
    const decoy = join(evidence, "unrelated.txt");
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(
      module,
      fakeModule(ready, `fs.writeFileSync(${JSON.stringify(closed)}, 'closed')`),
    );
    await mkdir(evidence, { recursive: true });
    await writeFile(decoy, "unrelated work");

    // cwd is the owned temp root so the evidence directory stays disposable.
    const child = spawnCheck(root, module, evidence);
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    });
    const exited = once(child, "exit");
    await waitForFile(ready);
    assert.equal(child.kill(signal), true, "signal reaches the owned process");
    const [exitCode, exitSignal] = await exited;
    assert.equal(exitSignal, null);
    assert.equal(exitCode, code, "the conventional signal exit code survives");

    assert.equal(await readFile(closed, "utf8"), "closed", "owned browser closed");
    assert.equal(
      await readFile(decoy, "utf8"),
      "unrelated work",
      "unrelated files in the evidence directory survive",
    );
    await assert.rejects(
      readFile(join(evidence, "signature-receipt.json"), "utf8"),
      "no completed receipt is invented for an interrupted journey",
    );
  });
}

test("signature-check still exits conventionally when the owned close fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "paperwork-signature-closefail-"));
  const ready = join(root, "ready");
  const module = join(root, "fake-playwright.cjs");
  const evidence = join(root, "evidence");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(module, fakeModule(ready, `throw new Error('close failed')`));

  const child = spawnCheck(root, module, evidence);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  const exited = once(child, "exit");
  await waitForFile(ready);
  assert.equal(child.kill("SIGINT"), true);
  const [exitCode, exitSignal] = await exited;
  assert.deepEqual([exitCode, exitSignal], [130, null]);
  await assert.rejects(
    readFile(join(evidence, "signature-receipt.json"), "utf8"),
    "no receipt after a failed owned close",
  );
});

test("signature-check drains owned cleanup on a thrown check failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "paperwork-signature-throw-"));
  const closed = join(root, "closed");
  const module = join(root, "fake-playwright.cjs");
  const evidence = join(root, "evidence");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    module,
    fakeModule(
      join(root, "ready"),
      `fs.writeFileSync(${JSON.stringify(closed)}, 'closed')`,
      "throw new Error('check failed')",
    ),
  );

  const child = spawnCheck(root, module, evidence);
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
  await assert.rejects(
    readFile(join(evidence, "signature-receipt.json"), "utf8"),
    "no completed receipt for a failed journey",
  );
});
