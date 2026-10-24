// MIT. Retry only bounded propagation failures; every accepted response must match the reviewed bytes.
import { createHash } from "node:crypto";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function verifyStaticAssets({
  origin,
  assets,
  attempts = 6,
  delayMs = 3000,
  fetchImpl = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > 6 ||
    delayMs < 0 ||
    delayMs > 3000
  )
    throw Error("Static verification retry bounds are invalid.");
  let pending = assets.map((asset) => ({
    ...asset,
    sha256: digest(asset.bytes),
  }));
  const verified = [];
  let failures = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const results = await Promise.all(
      pending.map(async (asset) => {
        try {
          const response = await fetchImpl(new URL(asset.path, origin), {
            headers: { "Cache-Control": "no-cache" },
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          if (
            asset.type &&
            response.headers.get("content-type")?.split(";")[0] !== asset.type
          )
            throw Error("content type differs");
          if (
            asset.csp &&
            !response.headers
              .get("content-security-policy")
              ?.includes("connect-src 'self'")
          )
            throw Error("static CSP boundary missing");
          if (
            asset.csp &&
            !response.headers.get("cache-control")?.includes("no-transform")
          )
            throw Error("HTML transformation protection missing");
          if (
            digest(new Uint8Array(await response.arrayBuffer())) !==
            asset.sha256
          )
            throw Error("SHA-256 differs from reviewed bytes");
          return { asset, attempt };
        } catch (error) {
          return {
            asset,
            error: error instanceof Error ? error.message : "request failed",
          };
        }
      }),
    );
    pending = [];
    failures = [];
    for (const result of results)
      if (result.error) {
        pending.push(result.asset);
        failures.push(`${result.asset.path}: ${result.error}`);
      } else
        verified.push({
          path: result.asset.path,
          sha256: result.asset.sha256,
          attempt: result.attempt,
        });
    if (!pending.length) return verified;
    if (attempt < attempts) await wait(delayMs);
  }
  throw Error(
    `Served assets did not match after ${attempts} bounded propagation checks: ${failures.join("; ")}`,
  );
}
