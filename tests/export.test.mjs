import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportDocument } from "../src/export.ts";
const options = { disableFontFace: true, useSystemFonts: true };
async function fixture(file) {
  const bytes = new Uint8Array(readFileSync(file)),
    pdf = await getDocument({ data: bytes.slice(), ...options }).promise,
    parsed = await PDFDocument.load(bytes);
  parsed.registerFontkit(fontkit);
  const fontBytes = new Uint8Array(
      readFileSync("public/fonts/SpaceGrotesk.ttf"),
    ),
    font = await parsed.embedFont(fontBytes);
  const viewports = [];
  for (let i = 1; i <= pdf.numPages; i++)
    viewports.push((await pdf.getPage(i)).getViewport({ scale: 1 }));
  return {
    bytes,
    pdf,
    viewports,
    fontBytes,
    font,
    initial: {
      values: {
        fullName: "Alex Example",
        date: "24 October 2026",
        notes: "Planting herbs and painting the garden signs.",
        session: "Morning",
        experience: ["First visit"],
        interests: ["Herbs"],
        updates: false,
      },
      additions: [],
    },
  };
}
function additions(page = 0) {
  return [
    {
      id: "ink",
      page,
      kind: "ink",
      x: 70,
      y: 690,
      w: 100,
      h: 10,
      color: "#193464",
      size: 2.5,
      points: [
        { x: 70, y: 690 },
        { x: 120, y: 680 },
        { x: 170, y: 690 },
      ],
    },
    {
      id: "text",
      page,
      kind: "text",
      x: 70,
      y: 710,
      w: 180,
      h: 40,
      color: "#193464",
      size: 14,
      text: "Renée — fictional",
    },
    {
      id: "tick",
      page,
      kind: "tick",
      x: 44,
      y: 645,
      w: 25,
      h: 25,
      color: "#193464",
      size: 2.5,
    },
    {
      id: "sig",
      page,
      kind: "image",
      x: 310,
      y: 720,
      w: 180,
      h: 180 / 3.5,
      color: "#193464",
      size: 2.5,
      image:
        "data:image/png;base64," +
        readFileSync("public/examples/fictional-signature.png").toString(
          "base64",
        ),
    },
  ];
}
test("native fields, Unicode, ink and transparent signature survive one save and a PDF.js reopen", async () => {
  const doc = await fixture("public/examples/garden-form.pdf");
  try {
    const state = {
      values: {
        ...doc.initial.values,
        fullName: "Renée Example",
        notes: "First line\nSecond line",
        updates: true,
        session: "Afternoon",
        experience: ["Experienced"],
        interests: ["Flowers", "Vegetables"],
      },
      additions: additions(),
    };
    const bytes = await exportDocument(doc, state),
      pdf = await PDFDocument.load(bytes),
      f = pdf.getForm();
    assert.equal(f.getTextField("fullName").getText(), "Renée Example");
    assert.equal(f.getTextField("notes").getText(), "First line\nSecond line");
    assert.equal(f.getCheckBox("updates").isChecked(), true);
    assert.equal(f.getRadioGroup("session").getSelected(), "Afternoon");
    assert.deepEqual(f.getDropdown("experience").getSelected(), [
      "Experienced",
    ]);
    assert.deepEqual(f.getOptionList("interests").getSelected(), [
      "Flowers",
      "Vegetables",
    ]);
    const reopened = await getDocument({ data: bytes.slice(), ...options })
      .promise;
    try {
      const page = await reopened.getPage(1);
      const annotations = await page.getAnnotations();
      assert.equal(
        annotations.find((a) => a.fieldName === "fullName").fieldValue,
        "Renée Example",
      );
      const text = await page.getTextContent();
      assert.match(text.items.map((i) => i.str).join(" "), /Renée.*fictional/);
      const ops = await page.getOperatorList();
      assert(ops.fnArray.length > 100);
      assert(
        (await page.getTextContent()).items.some(
          (i) => i.str === "A little time outdoors",
        ),
      );
    } finally {
      await reopened.loadingTask.destroy();
    }
  } finally {
    await doc.pdf.loadingTask.destroy();
  }
});
test("cropped / rotated mixed pages retain overlay positions and original page dimensions", async () => {
  const doc = await fixture("public/examples/rotated-form.pdf");
  try {
    const bytes = await exportDocument(doc, {
        values: doc.initial.values,
        additions: [
          ...additions(0),
          ...additions(1).map((a) => ({
            ...a,
            y: a.y - 500,
            points: a.points?.map((p) => ({ ...p, y: p.y - 500 })),
          })),
        ],
      }),
      reopened = await getDocument({ data: bytes.slice(), ...options }).promise;
    try {
      for (let i = 0; i < 2; i++) {
        const page = await reopened.getPage(i + 1),
          viewport = page.getViewport({ scale: 1 });
        assert.equal(viewport.width, doc.viewports[i].width);
        assert.equal(viewport.height, doc.viewports[i].height);
        const content = await page.getTextContent();
        const text = content.items.find((t) => t.str.includes("Renée"));
        assert(text);
        const position = viewport.convertToViewportPoint(
          text.transform[4],
          text.transform[5],
        );
        assert(Math.abs(position[0] - 70) < 1);
        assert(Math.abs(position[1] - (i === 0 ? 724 : 224)) < 1);
      }
    } finally {
      await reopened.loadingTask.destroy();
    }
  } finally {
    await doc.pdf.loadingTask.destroy();
  }
});
test("unsupported glyph export fails without mutating in-memory edits", async () => {
  const doc = await fixture("public/examples/garden-form.pdf");
  try {
    const state = {
        values: { ...doc.initial.values, fullName: "你好" },
        additions: [],
      },
      before = structuredClone(state);
    await assert.rejects(exportDocument(doc, state), /character/);
    assert.deepEqual(state, before);
  } finally {
    await doc.pdf.loadingTask.destroy();
  }
});

test("owner pack radio export names, checks, list and read-only value retain their exact native values", async () => {
  const filename =
    "tests/fixtures/paperwork-fixtures/paperwork-lab-interactive-mixed.pdf";
  const doc = await fixture(filename);
  try {
    const expected = JSON.parse(
      readFileSync(
        "tests/fixtures/paperwork-fixtures/expected-fields-example.json",
        "utf8",
      ),
    );
    const initial = JSON.parse(
      readFileSync(
        "tests/fixtures/paperwork-fixtures/fixture-manifest.json",
        "utf8",
      ),
    ).fields;
    doc.initial.values = Object.fromEntries(
      Object.entries(initial).map(([k, v]) => [k, v.initial]),
    );
    const values = {
      ...expected,
      subscribe: true,
      terms_seen: false,
      contact_method: "InPerson",
      document_type: ["Follow-up"],
      delivery_window: ["Evening"],
      immutable_id: "Should not change",
    };
    const output = await exportDocument(doc, { values, additions: [] });
    const parsed = await PDFDocument.load(output),
      form = parsed.getForm();
    assert.equal(
      form.getRadioGroup("contact_method").getSelected(),
      "InPerson",
    );
    assert.equal(form.getCheckBox("subscribe").isChecked(), true);
    assert.equal(form.getCheckBox("terms_seen").isChecked(), false);
    assert.deepEqual(form.getDropdown("document_type").getSelected(), [
      "Follow-up",
    ]);
    assert.equal(form.getTextField("immutable_id").getText(), "SYNTH-LOCK-001");
    assert.equal(form.getTextField("case_note").getText(), expected.case_note);
  } finally {
    await doc.pdf.loadingTask.destroy();
  }
});

test("export keeps named-destination arrays and unrelated A keys while removing document JavaScript", async () => {
  const doc = await fixture("public/examples/garden-form.pdf");
  try {
    const source = await PDFDocument.load(doc.bytes);
    source.catalog.set(
      PDFName.of("Names"),
      source.context.obj({ Dests: { Names: [] } }),
    );
    source.catalog.set(
      PDFName.of("OpenAction"),
      source.context.obj({
        S: "JavaScript",
        JS: PDFString.of('throw new Error("synthetic");'),
      }),
    );
    source
      .getPage(0)
      .node.set(
        PDFName.of("FixtureDictionary"),
        source.context.register(
          source.context.obj({ A: PDFString.of("preserve source key") }),
        ),
      );
    doc.bytes = await source.save();
    const completed = await PDFDocument.load(
      await exportDocument(doc, { values: doc.initial.values, additions: [] }),
    );
    assert.equal(completed.catalog.has(PDFName.of("OpenAction")), false);
    assert(completed.catalog.has(PDFName.of("Names")));
    assert.equal(
      completed
        .getPage(0)
        .node.lookup(PDFName.of("FixtureDictionary"))
        .lookup(PDFName.of("A"))
        .decodeText(),
      "preserve source key",
    );
  } finally {
    await doc.pdf.loadingTask.destroy();
  }
});

test("a translucent highlight is one continuous PDF stroke so segment joins do not darken", async () => {
  const doc = await fixture("public/examples/garden-form.pdf");
  try {
    const bytes = await exportDocument(doc, {
      values: doc.initial.values,
      additions: [
        { ...additions()[0], opacity: 0.32, size: 16, color: "#efb900" },
      ],
    });
    const { decodePDFRawStream, PDFRawStream } = await import("pdf-lib");
    const saved = await PDFDocument.load(bytes),
      contents = saved.getPage(0).node.Contents();
    const stream = saved.context.lookup(
      contents.get(contents.size() - 1),
      PDFRawStream,
    );
    const operators = new TextDecoder().decode(
      decodePDFRawStream(stream).decode(),
    );
    assert.equal(
      operators.split("\n").filter((line) => line === "S").length,
      1,
    );
    assert.equal(
      operators.split("\n").filter((line) => line.endsWith(" l")).length,
      2,
    );
  } finally {
    await doc.pdf.loadingTask.destroy();
  }
});
