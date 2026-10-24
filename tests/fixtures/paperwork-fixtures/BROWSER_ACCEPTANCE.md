# Codex + ChatGPT browser acceptance protocol

Use this protocol *after* Paperwork exists. Do not equate passing fixture preflight with passing the editor.

## Division of responsibility

**Codex / local code runner**

- Develop the editor, run focused tests and drive a repeatable browser session using the project’s supported automation (Playwright if already available; do not introduce a testing service).
- Load `paperwork-lab-interactive-mixed.pdf` by the same visible file-picker/drag/drop flow as users, select fields, enter values from `expected-fields-example.json`, add markings to designated page-two regions, and import `demo-signature-transparent.png`.
- Save the **downloaded PDF bytes** from the browser, not just screenshots or JavaScript memory state.
- Call `verify_output.py` against these real exported bytes. Record field mismatches and overlay ROI differences as failures.
- Render export via **two separate PDF implementations** (e.g. PDF.js plus Poppler/PyMuPDF, or independent browsers/viewers). Check legibility, shifted ink, correct form appearances, and preservation of source/vector content. If reader support is limited, state it, do not claim equivalence.
- Capture the negative password/corrupt flow and network traffic: documents and signature bytes must not be uploaded, sent to analytics or silently persisted.
- Verify Print opens **completed** output or print-to-PDF agrees with completed output. A print-dialog screenshot alone is insufficient evidence of fidelity.

**ChatGPT browser extension / desktop Work or Codex browser**

- In an enabled supported browser, open the deployed Paperwork app and perform one **real human-style** pass: open the test PDF, change a widget, draw, undo, move the demo signature, download and reopen. Review phone-sized layout and feedback at appropriate widths.
- You can use the ChatGPT browser extension with an enabled browser/profile through the ChatGPT desktop app or supported ChatGPT web workflow. Browser control availability depends on setup and permissions. It is **not** automatically available to a shell-only Codex CLI or IDE extension.
- Browser-side success demonstrates the interaction path and visible results, **not** that AcroForm appearance streams, print fidelity, privacy or exported document structure are correct. Use the local verifier and independent reader as well.
- File upload/download permissions may require a user-approved browser setup; never claim a test passed when that action was blocked. Use synthetic data only.

## Required reproducible journey

1. Open canonical four-page PDF, no login.
2. Change all fields to `expected-fields-example.json` values. Try changing the radio and dropdown twice; try (and fail to change) read-only ID. For checkbox states, use the PDF's actual exported on-state rather than trusting `true`/`false` UI alone.
3. Move to page 2. Change `case_note`, switch to pen, draw two strokes, erase one, undo/redo, add a text overlay, tick a box, highlight the printed phrase, and place/resize the transparent demo PNG.
4. Go to page 3. Place annotations in three rotated targets at two zoom levels; observe exact targets in emitted PDF.
5. Go to page 4. Add text/tick/ink/signature on an image-only form; keep original background.
6. Return to page 1 and prove native field values and focus survived page/tool changes.
7. Save/download completed PDF; run structural and region analyser; reopen independently. Print this completed copy.
8. With another unsaved document active, open the truncated fixture and confirm helpful failure without losing the current work; separately check password handling.
9. Inspect network and storage behaviours; no PDF/signature bytes leave the browser or persist without consent.

## Evidence, not busywork

Maintain **one** compact machine-readable receipt per actual run:

```json
{
  "source_sha": "observed git sha",
  "deployed_url": "actual URL or local URL",
  "browser": "actual browser/build",
  "downloaded_pdf_sha256": "sha256 of actual bytes",
  "field_roundtrip": "pass | fail | blocked | unrun",
  "mixed_annotations": "pass | fail | blocked | unrun",
  "rotated_page": "pass | fail | blocked | unrun",
  "image_only_page": "pass | fail | blocked | unrun",
  "independent_pdf_readers": "pass | fail | blocked | unrun",
  "print_completed": "pass | fail | blocked | unrun",
  "privacy_no_upload": "pass | fail | blocked | unrun",
  "negative_cases": "pass | fail | blocked | unrun",
  "known_limitations": []
}
```

Make a reproducible regression test for **every actual bug found** and add the smallest synthetic fixture required to reproduce it, rather than running a broad full suite on every edit. Required production release safety gates still apply at promotion.
