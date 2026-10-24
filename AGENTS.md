# Paperwork agent entry

Read README.md and the owner acceptance corpus in tests/fixtures/paperwork-fixtures/. App Composer #264 owns scope; #11 is the canonical release receipt. Follow App Composer's product/privacy constraints. Keep the app independently useful, source-owned and static. No account, backend PDF processing, telemetry, automatic file/signature persistence, paid SDK, GitHub Actions or expanded permissions.

Use the one in-memory edit model and pdf-lib export path; PDF.js renders and locates native widgets. Never execute PDF document scripts/actions. Preserve source pages, actual native values/appearances and crop/rotation geometry. Failed open/export must retain current work. Use fictional data/signatures exclusively. Keep source readable.

Use focused tests while iterating. Before release run pnpm check, pnpm build and audit, then the clean pushed-main deploy guard. Verify the downloaded browser-completed acceptance PDF with the supplied verifier and independent reader. Do not claim physical-device, OS print-dialog, all-script Unicode, XFA, certificate signing or unfamiliar-human acceptance from automation. Preserve owner and unrelated work.
