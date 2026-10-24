# Paperwork

One document. One editor. One finished PDF.

Fill ordinary PDF form fields, draw, highlight, type on scanned forms, add ticks and place a transparent signature PNG. Save or print a completed PDF. Documents and signatures stay in browser memory. No account, uploads, telemetry, server processing or automatic persistence.

## Run

Node 22 and pnpm 12.8.1:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm build` bundles the pinned PDF.js worker, rendering resources, pdf-lib, fontkit and local font. `pnpm check` runs strict TypeScript and focused real-PDF export tests. `pnpm exec vite preview --host 127.0.0.1 --port 4264` serves the built app. Production uses the static-only Cloudflare configuration and the clean pushed-main `pnpm deploy` guard.

## Use

Open a PDF, or Try a sample. Select fills native fields and moves additions. Pen, Highlighter, Eraser, Text, Tick and Signature work in the same session. Signature accepts a local transparent PNG; drag its corner to resize. Undo/Redo and page/zoom controls retain edits. The filename and ready/unsaved/exported indicator stay visible on phones. Shortcuts opens an in-place keyboard guide (also available with ? outside fields). Save PDF downloads `-completed.pdf`. Print creates that same completed PDF and hands it to the browser PDF reader, with an explicit open-to-print fallback.

Added objects remain individually editable in this session. After saving, they are ordinary page content; native PDF fields remain editable on reopening. Download before closing: nothing is silently saved.

Supports AcroForm text/multiline/check/radio/dropdown/list fields; read-only and max-length constraints; flat/scanned pages; mixed sizes, crop boxes and cardinal rotations. Up to 30 MB, 100 pages, 2,000 widgets and 3,000 additions, with bounded canvas and ink sizes. Password-protected, XFA and already certificate-signed documents are refused. The bundled font supports Latin and extended Latin, not every writing system. Unsupported text fails export with edits retained. This is visual signing; no certificate or identity workflow.

## Independent mini-app contract

`app.manifest.json` declares contract/data version 1, static-assets runtime, no data capabilities and title/introduction/theme configuration. `public/paperwork.json` is the only host configuration. It never contains files, signatures, credentials or executable instructions. App Composer links the independently deployed app and offers a configuration specification; it does not own document data or provide a PDF backend.

Configuration is validated at startup. Missing/invalid configuration keeps the default editor. To reproduce an instance, clone the exact source pin recorded in Composer, prepare `public/paperwork.json`, build and release to a separately reviewed target. Changing title/introduction/theme changes the interface only.

## Synthetic acceptance pack

The owner-supplied v1 pack is preserved byte-for-byte under `tests/fixtures/paperwork-fixtures/`, including generator, expectations, verifier and transparent **DEMO SIGNATURE**. It is the principal four-page acceptance document, covering 11 native fields, mixed overlays, 90-degree rotation and an image-only scan. `pnpm samples` regenerates the smaller fictional onboarding examples; production builds do not rewrite source fixtures.

```sh
python tests/fixtures/paperwork-fixtures/verify_output.py --fixture-only
node scripts/browser-check.mjs
python tests/fixtures/paperwork-fixtures/verify_output.py \
  --completed output/acceptance/paperwork-lab-interactive-mixed-completed.pdf \
  --expected-values tests/fixtures/paperwork-fixtures/expected-fields-example.json \
  --report output/acceptance/verification.json
```

Verifier dependencies: pypdf, PyMuPDF, Pillow and NumPy. Browser checks use the installed Chrome and Playwright WebKit. On the shared development host, run the browser command through Woodhouse's existing host-validation lane. `PAPERWORK_ORIGIN` selects a live release; `PAPERWORK_EVIDENCE` selects the owned ignored output directory. The script downloads the actual edited PDF, reopens it via the public UI, checks negative-file recovery, verifies print receives the same completed bytes, and checks network/storage. It closes its own browsers and HTTP server on success and failure. The unchanged source must fail completed-document checks.

The supplied verifier's ROI differences establish changed pixels, not exact object fidelity. Pair it with PDF.js and independent MuPDF/Poppler renders and inspect rotation, transparency and source preservation. Physical-device, OS print-dialog and unfamiliar-human acceptance remain separate from automation.

[Contributing](CONTRIBUTING.md) · [Accessibility](ACCESSIBILITY.md) · [Security](SECURITY.md) · [MIT licence](LICENSE)

Continuous mobile input regression (native Chromium touch events, including two-finger zoom and PNG move/resize): `PAPERWORK_ORIGIN=https://composer-paperwork.loftwah.workers.dev node scripts/touch-check.mjs`. Without an origin override, start the built preview on 127.0.0.1:4264 first. This tests the browser input pipeline; it does not establish physical iPhone or stylus acceptance.

Native-widget rotation regression: `PAPERWORK_ORIGIN=https://composer-paperwork.loftwah.workers.dev node scripts/rotated-fields-check.mjs`. It derives 90°/270° variants from the unchanged owner corpus in an owned temporary root, checks every native widget's actual browser bounds against the PDF viewport, and inspects downloaded field values. The temporary source variants are removed on success and failure.

Print-shop artwork: the original master, generation prompt and export provenance are in [artwork/](artwork/). The original Paperwork document icon and other apps’ identities are retained.
