import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BROWSER_CHECK = fileURLToPath(
  new URL("../scripts/browser-check.mjs", import.meta.url),
);

const waitForFile = async (path, predicate = () => true, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await readFile(path, "utf8");
      if (predicate(value)) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${path}`);
};

test("browser-check releases owned resources and writes evidence on SIGINT", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "paperwork-check-signal-"));
  const ready = join(root, "ready");
  const closed = join(root, "closed");
  const evidence = join(root, "evidence");
  const completion = join(root, "completion.json");
  const fakeModule = join(root, "fake-playwright.cjs");
  t.after(() => rm(root, { recursive: true, force: true }));

  // A deliberately tiny owned-browser stand-in: reaching goto proves the real
  // script started its listener and launched the browser, then it parks there.
  await writeFile(
    fakeModule,
    `const fs = require('node:fs');
     const browser = () => ({
       version: () => 'fake',
       newContext: async () => ({ newPage: async () => ({
         on() {},
         goto: async (url) => {
           fs.writeFileSync(${JSON.stringify(ready)}, url);
           return new Promise(() => {});
         },
       }) }),
       close: async () => fs.appendFileSync(${JSON.stringify(closed)}, 'chromium\\n'),
     });
     module.exports = {
       chromium: { launch: async () => browser() },
       webkit: { launch: async () => browser() },
     };`,
  );

  const unrelated = createServer((_req, res) => res.end("alive"));
  await new Promise((resolve) => unrelated.listen(0, "127.0.0.1", resolve));
  const unrelatedPort = unrelated.address().port;
  t.after(() => new Promise((resolve) => unrelated.close(resolve)));

  const child = spawn(
    process.execPath,
    [BROWSER_CHECK],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PLAYWRIGHT_MODULE: fakeModule,
        PAPERWORK_EVIDENCE: evidence,
        LOFTWAH_VALIDATION_COMPLETION: completion,
        LOFTWAH_VALIDATION_GENERATION: "test",
      },
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  const exited = once(child, "exit");
  const origin = await waitForFile(ready);
  // The owned server is live before the interrupt and accepts a request.
  const before = await fetch(origin, { signal: AbortSignal.timeout(2000) });
  assert.ok(before.status >= 100, "owned listener should be live before SIGINT");

  assert.equal(child.kill("SIGINT"), true);
  const [code, signal] = await exited;
  assert.equal(signal, null);
  assert.equal(code, 130, "conventional SIGINT exit code is preserved");

  assert.equal(await readFile(closed, "utf8"), "chromium\n");
  const receipt = JSON.parse(await readFile(join(evidence, "receipt.json"), "utf8"));
  assert.equal(receipt.interrupted, "SIGINT");
  const completionData = JSON.parse(await readFile(completion, "utf8"));
  assert.deepEqual(completionData, {
    version: 1,
    generation: "test",
    cleanup: "complete",
  });
  await assert.rejects(
    fetch(origin, { signal: AbortSignal.timeout(2000) }),
    "owned listener must be released",
  );
  assert.equal(
    await (await fetch(`http://127.0.0.1:${unrelatedPort}`)).text(),
    "alive",
    "an unrelated listener must keep running",
  );
});
