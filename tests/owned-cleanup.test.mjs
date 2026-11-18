import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOwnedCleanup } from "../scripts/lib/owned-cleanup.mjs";

const helper = new URL("../scripts/lib/owned-cleanup.mjs", import.meta.url).href;

const waitForFile = async (path, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
};

test("teardown is idempotent, balanced and failures stay visible", async () => {
  let calls = 0;
  const owned = createOwnedCleanup(async () => {
    calls += 1;
  });
  const before = process.listenerCount("SIGINT");
  const beforeTerm = process.listenerCount("SIGTERM");
  owned.install();
  assert.equal(process.listenerCount("SIGINT"), before + 1);
  assert.equal(process.listenerCount("SIGTERM"), beforeTerm + 1);
  await Promise.all([owned.clean(), owned.clean()]);
  assert.equal(calls, 1, "concurrent clean() calls drain the teardown once");
  owned.uninstall();
  assert.equal(process.listenerCount("SIGINT"), before);
  assert.equal(process.listenerCount("SIGTERM"), beforeTerm);

  const failing = createOwnedCleanup(async () => {
    throw new Error("teardown failed");
  });
  await assert.rejects(failing.clean(), /teardown failed/);
});

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`${signal} drains once, ignores repeats and preserves the exit code`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "paperwork-owned-cleanup-"));
    const ready = join(root, "ready");
    const started = join(root, "started");
    const marker = join(root, "cleaned");
    t.after(() => rm(root, { recursive: true, force: true }));
    const childCode = `
      import { createOwnedCleanup } from ${JSON.stringify(helper)};
      import { writeFile } from "node:fs/promises";
      setInterval(() => {}, 1000); // keep the event loop alive until signalled
      let calls = 0;
      const owned = createOwnedCleanup(async () => {
        calls += 1;
        await writeFile(process.env.PAPERWORK_CLEANUP_STARTED, "started");
        await new Promise((resolve) => setTimeout(resolve, 150));
        await writeFile(process.env.PAPERWORK_CLEANUP_MARKER, String(calls));
      });
      owned.install();
      await writeFile(process.env.PAPERWORK_CLEANUP_READY, "ready");
      await new Promise(() => {});
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", childCode],
      {
        stdio: "ignore",
        env: {
          ...process.env,
          PAPERWORK_CLEANUP_READY: ready,
          PAPERWORK_CLEANUP_STARTED: started,
          PAPERWORK_CLEANUP_MARKER: marker,
        },
      },
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    });
    const exited = new Promise((done) =>
      child.once("exit", (exitCode, exitSignal) =>
        done({ exitCode, exitSignal }),
      ),
    );
    await waitForFile(ready);
    assert.equal(child.kill(signal), true);
    // The second signal lands while teardown is draining; listeners must still
    // be installed so it is ignored rather than restoring the default kill.
    await waitForFile(started);
    child.kill(signal);
    assert.deepEqual(await exited, { exitCode: code, exitSignal: null });
    assert.equal(await waitForFile(marker), "1");
  });
}
