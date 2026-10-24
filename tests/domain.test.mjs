import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const redirect = readFileSync(
  new URL("../public/canonical.js", import.meta.url),
  "utf8",
);
test("existing Workers page links retain their path, sample and fragment at the public domain", () => {
  let destination;
  const href =
    "https://composer-paperwork.loftwah.workers.dev/help.html?sample=lab&analytics=off&qa=domain#privacy";
  runInNewContext(redirect, {
    URL,
    location: {
      hostname: new URL(href).hostname,
      href,
      replace: (value) => {
        destination = value;
      },
    },
  });
  assert.equal(
    destination,
    "https://paperwork.loftwah.com/help.html?sample=lab&analytics=off&qa=domain#privacy",
  );
});
test("public, local and reproduced instances never navigate to the reference domain", () => {
  for (const href of [
    "https://paperwork.loftwah.com/",
    "http://localhost:4264/",
    "https://my-paperwork.example.workers.dev/",
    "https://composer-paperwork.loftwah.workers.dev.example/",
  ]) {
    runInNewContext(redirect, {
      URL,
      location: {
        hostname: new URL(href).hostname,
        href,
        replace: () => assert.fail("Unexpected reference navigation"),
      },
    });
  }
});
