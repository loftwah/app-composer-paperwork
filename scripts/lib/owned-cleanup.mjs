// Bounded, idempotent teardown for task-owned ephemeral browser checks.
// The proven `finally` path still handles normal completion and thrown errors.
// SIGINT/SIGTERM are different: Node's default handler exits the process
// immediately, so no JavaScript `finally` runs and owned browsers/listeners/
// evidence files survive. Install a narrow handler that drains the same
// teardown once, then exits with the conventional code. No global kills or
// broad cleanup.

const EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
const DEFAULT_TIMEOUT_MS = 5_000;

export function createOwnedCleanup(
  teardown,
  { timeoutMs = DEFAULT_TIMEOUT_MS, onInterrupt = () => {} } = {},
) {
  let pending;
  let handling = false;
  const listeners = new Map();

  // Normal completion propagates teardown failures. On interruption, the
  // diagnostic accompanies the conventional signal exit code.
  const clean = () => {
    if (!pending) pending = Promise.resolve().then(teardown);
    return pending;
  };

  const uninstall = () => {
    for (const [name, listener] of listeners)
      process.removeListener(name, listener);
    listeners.clear();
  };

  const handleSignal = (signal) => {
    if (handling) return;
    handling = true;
    onInterrupt(signal);
    const code = EXIT_CODES[signal] ?? 1;
    // Last resort if owned teardown hangs: never keep the process alive.
    const bail = setTimeout(() => {
      console.error(`Owned browser-check cleanup timed out after ${timeoutMs}ms.`);
      process.exit(code);
    }, timeoutMs);
    const finish = () => {
      clearTimeout(bail);
      uninstall();
      process.exit(code);
    };
    // Listeners stay installed until teardown settles, so a repeat signal is
    // ignored instead of restoring the default kill. The `handling` flag keeps
    // it from starting a second teardown.
    void clean().then(finish, (error) => {
      console.error("Owned browser-check cleanup failed:", error.message);
      finish();
    });
  };

  const install = () => {
    for (const signal of Object.keys(EXIT_CODES)) {
      if (listeners.has(signal)) continue;
      const listener = () => handleSignal(signal);
      listeners.set(signal, listener);
      process.on(signal, listener);
    }
    return uninstall;
  };

  return { clean, install, uninstall };
}

// Best-effort failure diagnostics (page.evaluate/screenshot) have no built-in
// timeout and can stay pending forever when a renderer is blocked. Bound such a
// step so it can never starve the `finally` that drains owned teardown and
// writes the receipt/completion evidence. A timed-out step rejects; the caller
// records it as unavailable and teardown still runs.
const DEFAULT_STEP_TIMEOUT_MS = 5_000;

export function withTimeout(step, timeoutMs = DEFAULT_STEP_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve().then(step),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Step timed out after ${timeoutMs}ms.`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
