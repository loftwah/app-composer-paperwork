# Paperwork Lab — synthetic PDF acceptance pack

**Version 1.0.0 • 2026/10/24 AEDT (Australia/Melbourne, UTC+11) / 2026/10/24 UTC**

This is a fully fictional interoperability fixture pack for [App Composer Paperwork #264](https://github.com/loftwah/app-composer/issues/264). There is **no genuine signature, personal information or confidential document** in these files. The included PNG is transparent and explicitly marked as a demo.

## Contents

| File | Purpose |
| --- | --- |
| `paperwork-lab-interactive-mixed.pdf` | Four-page canonical synthetic form, including 11 AcroForm fields, flat overlay areas, rotated coordinates, and a simulated scanned page |
| `demo-signature-transparent.png` | Transparent fictional signature: "Alex Example" (not a real person's handwriting) |
| `negative-password-protected.pdf` | Encrypted negative fixture; password is `paperwork-demo-only` if needed to verify recovery |
| `negative-truncated.pdf` | Deliberately damaged negative fixture; must fail cleanly |
| `fixture-manifest.json` | Machine-readable field inventory, page specifications, overlay rectangles and acceptance cases |
| `expected-fields-example.json` | Expected `/V` values after an example editing journey |
| `generate_fixtures.py` | Repeatable authoring script; use only synthetic data |
| `verify_output.py` | Baseline checks and output structural/render/pixel-change checks (Python: pypdf, PyMuPDF, Pillow, NumPy) |
| `BROWSER_ACCEPTANCE.md` | Codex + browser instructions, with evidence rules |
| `SHA256SUMS.json` | SHA256 of distributed source fixtures and their manifest |

## Why four pages?

**Page 1 — interactive widgets:** existing text to edit, blank text, max-length, read-only, multiline, two checkboxes (one prechecked), a three-option radio group, dropdown and list selection. The output PDF must retain correct native field values and appearances.

**Page 2 — hybrid work:** native form field plus graphical printed targets for free text, ticks/crosses, pen, highlighter, and a draggable imported signature. The editor must not lose form state after changing tools.

**Page 3 — 90-degree rotation:** originally landscape vector artwork, rotated in the PDF page dictionary, with three annotation zones. Detect off-by-rotation/crop/zoom coordinate bugs.

**Page 4 — image-only form:** simulated scanned US Letter page. The editor must allow overlays despite no editable fields and retain the original raster artwork.

This is not an exhaustive PDF standards compliance corpus. In particular, **it does not contain a genuine XFA form**, an actual certificate-signed document or a malicious active-content exploit. Add carefully sourced, isolated cases later as issues are encountered. Do not fake unsupported compatibility.

## Quick checks

Run fixture validation:

```bash
python verify_output.py --fixture-only
```

After Paperwork has exported a completed file, inspect it independently:

```bash
python verify_output.py \
  --completed ./paperwork-lab-interactive-mixed-completed.pdf \
  --expected-values expected-fields-example.json \
  --report ./paperwork-acceptance-result.json
```

This checks structural fields, expected values, retained source text and **visible changes** inside page-two targets. It does **not** prove correct stroke shapes, exact PNG appearance, privacy or print behaviour on its own. Pair it with browser-driven acceptance and rendered visual inspection in **two independent PDF implementations**. Compare the saved output, not a screenshot of the editor.

## No theatre

A test is **passing** only if the action actually occurred and the resulting PDF passed the relevant checks. Failures become named regression tests, reusing these fixtures instead of building a new QA platform. Failed, unrun and blocked are separate statuses. Keep a small reproducible evidence record with exact source, Worker, exported PDF, tested browser and command result.

No `GitHub Actions` or paid PDF SDK required.
