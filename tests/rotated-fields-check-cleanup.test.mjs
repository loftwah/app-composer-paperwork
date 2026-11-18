import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROTATED_CHECK = fileURLToPath(
  new URL("../scripts/rotated-fields-check.mjs", import.meta.url),
);
const ROOT_PREFIX = "paperwork-rotated-fields-";

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

const matchingRoots = () =>
  new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(ROOT_PREFIX)));

const fakeModule = (ready, close) => `
  const fs = require('node:fs');
  setInterval(() => {}, 1000); // keep the loop alive until signalled
  module.exports = {
    chromium: { launch: async () => ({
      newPage: async () => ({
        goto: async () => {
          fs.writeFileSync(${JSON.stringify(ready)}, 'goto');
          return new Promise(() => {});
        },
      }),
      close: async () => { ${close} },
    }) },
  };`;

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`rotated-fields closes the browser, removes only its owned root and marks completion on ${signal}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "paperwork-rotated-signal-"));
    const ready = join(root, "ready");
    const closed = join(root, "closed");
    const completion = join(root, "completion.json");
    const module = join(root, "fake-playwright.cjs");
    // An unrelated directory with a similar name must survive the run.
    const decoy = join(tmpdir(), ROOT_PREFIX + "DECOY-" + Date.now());
    const decoyFile = join(decoy, "keep.txt");
    t.after(async () => {
      await rm(root, { recursive: true, force: true });
      await rm(decoy, { recursive: true, force: true });
    });
    await writeFile(module, fakeModule(ready, `fs.writeFileSync(${JSON.stringify(closed)}, 'closed')`));
    await mkdir(decoy, { recursive: true });
    await writeFile(decoyFile, "unrelated work");
    const before = matchingRoots();

    // cwd is the owned temp root so output/rotated-fields stays disposable;
    // pdf-lib/pdfjs-dist resolve from the script's own location.
    const child = spawn(process.execPath, [ROTATED_CHECK], {
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
    const leftover = [...matchingRoots()].filter((name) => !before.has(name));
    assert.deepEqual(leftover, [], "only this run's owned root was removed");
    assert.equal(
      await readFile(decoyFile, "utf8"),
      "unrelated work",
      "an unrelated similarly named directory survives",
    );
    assert.deepEqual(
      JSON.parse(await readFile(completion, "utf8")),
      { version: 1, generation: "test", cleanup: "complete" },
      "completion marker follows a successful close and exact root removal",
    );
  });
}

test("rotated-fields still removes its owned root but withholds completion when the close fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "paperwork-rotated-closefail-"));
  const ready = join(root, "ready");
  const completion = join(root, "completion.json");
  const module = join(root, "fake-playwright.cjs");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(module, fakeModule(ready, `throw new Error('close failed')`));
  const before = matchingRoots();

  const child = spawn(process.execPath, [ROTATED_CHECK], {
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
  assert.deepEqual(
    [...matchingRoots()].filter((name) => !before.has(name)),
    [],
    "the owned root is removed even when the close fails",
  );
  await assert.rejects(
    readFile(completion, "utf8"),
    "no completion marker after a failed owned close",
  );
});
