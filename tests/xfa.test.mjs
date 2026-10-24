import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName } from "pdf-lib";
import { hasXfaForm } from "../src/xfa.ts";

test("a synthetic XFA carrier is refused before the form is touched", async () => {
  const pdf = await PDFDocument.load(
    new Uint8Array(
      readFileSync("tests/fixtures/interop-264/xfa-form.pdf"),
    ),
  );
  assert.equal(hasXfaForm(pdf), true);
  // getForm() is where pdf-lib silently deletes the packet, so the app must
  // detect XFA first; after it runs the document no longer reports XFA at all.
  assert.equal(pdf.getForm().hasXFA(), false);
  assert.equal(hasXfaForm(pdf), false);
});

test("XFA is still found when the AcroForm dictionary is an indirect object", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const acroForm = pdf.context.obj({ Fields: [] });
  acroForm.set(PDFName.of("XFA"), pdf.context.obj({}));
  pdf.catalog.set(PDFName.of("AcroForm"), pdf.context.register(acroForm));
  assert.equal(hasXfaForm(pdf), true);
  page.drawText("plain page");
});

test("ordinary forms are not mistaken for XFA", async () => {
  for (const file of [
    "public/examples/garden-form.pdf",
    "tests/fixtures/paperwork-fixtures/paperwork-lab-interactive-mixed.pdf",
  ])
    assert.equal(
      hasXfaForm(await PDFDocument.load(new Uint8Array(readFileSync(file)))),
      false,
      file,
    );
});
