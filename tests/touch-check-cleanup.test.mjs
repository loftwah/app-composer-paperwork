import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOUCH_CHECK = fileURLToPath(
  new URL("../scripts/touch-check.mjs", import.meta.url),
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
const fakeModule = (ready, close) => `
  const fs = require('node:fs');
  setInterval(() => {}, 1000); // keep the loop alive until signalled
  module.exports = {
    chromium: { launch: async () => ({
      newContext: async () => ({
        newPage: async () => ({
          goto: async () => {
            fs.writeFileSync(${JSON.stringify(ready)}, 'goto');
            return new Promise(() => {});
          },
        }),
        newCDPSession: async () => ({ send: async () => {} }),
      }),
      close: async () => { ${close} },
    }) },
  };`;

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`touch-check closes the owned browser and marks completion on ${signal}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "paperwork-touch-signal-"));
    const ready = join(root, "ready");
    const closed = join(root, "closed");
    const completion = join(root, "completion.json");
    const module = join(root, "fake-playwright.cjs");
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(module, fakeModule(ready, `fs.writeFileSync(${JSON.stringify(closed)}, 'closed')`));

    // cwd is the owned temp root so the script's output/touch stays disposable.
    const child = spawn(process.execPath, [TOUCH_CHECK], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PLAYWRIGHT_MODULE: module,
        PAPERWORK_ORIGIN: "http://127.0.0.1:1",
        LOFTWAH_VALIDATION_COMPLETION: completion,
        LOFTWAH_VALIDATION_GENERATION: "test",
      },
    });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    });
    const exited = once(child, "exit");
    await waitForFile(ready);
    assert.equal(child.kill(signal), true, "signal reaches the owned process");
    const [exitCode, exitSignal] = await exited;
    assert.equal(exitSignal, null);
    assert.equal(exitCode, code, "the conventional signal exit code is preserved");

    assert.equal(await readFile(closed, "utf8"), "closed", "owned browser closed");
    assert.deepEqual(
      JSON.parse(await readFile(completion, "utf8")),
      { version: 1, generation: "test", cleanup: "complete" },
      "completion marker follows a successful owned close",
    );
  });
}

test("touch-check withholds completion when the owned close fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "paperwork-touch-closefail-"));
  const ready = join(root, "ready");
  const completion = join(root, "completion.json");
  const module = join(root, "fake-playwright.cjs");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(module, fakeModule(ready, `throw new Error('close failed')`));

  const child = spawn(process.execPath, [TOUCH_CHECK], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PLAYWRIGHT_MODULE: module,
      PAPERWORK_ORIGIN: "http://127.0.0.1:1",
      LOFTWAH_VALIDATION_COMPLETION: completion,
      LOFTWAH_VALIDATION_GENERATION: "test",
    },
  });
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
    readFile(completion, "utf8"),
    "no completion marker after a failed owned close",
  );
});
