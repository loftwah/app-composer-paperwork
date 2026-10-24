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

test("export refuses additions that would be clipped instead of silently losing part of an edit", async () => {
  const doc = await fixture("public/examples/garden-form.pdf");
  try {
    for (const item of [
      { ...additions()[3], y: 820 },
      { ...additions()[1], y: 820, text: "A note that must remain visible." },
    ]) {
      const state = { values: doc.initial.values, additions: [item] },
        before = structuredClone(state);
      await assert.rejects(exportDocument(doc, state), /outside|fit/);
      assert.deepEqual(state, before);
    }
  } finally {
    await doc.pdf.loadingTask.destroy();
  }
});

test("escaped source appearances retain native font size, colour and top-aligned multiline text", async () => {
  const doc = await fixture(
    "tests/fixtures/paperwork-fixtures/paperwork-lab-interactive-mixed.pdf",
  );
  try {
    const initial = JSON.parse(
      readFileSync(
        "tests/fixtures/paperwork-fixtures/fixture-manifest.json",
        "utf8",
      ),
    ).fields;
    doc.initial.values = Object.fromEntries(
      Object.entries(initial).map(([key, value]) => [key, value.initial]),
    );
    const comments = "First line of a fictional note.\nSecond line after edit.";
    const saved = await PDFDocument.load(
      await exportDocument(doc, {
        values: {
          ...doc.initial.values,
          comments,
          document_type: ["Follow-up"],
        },
        additions: [],
      }),
    );
    const form = saved.getForm();
    assert.equal(form.getTextField("comments").getText(), comments);
    assert.match(
      form.getTextField("comments").acroField.getDefaultAppearance(),
      /\s11 Tf/,
    );
    assert.match(
      form.getDropdown("document_type").acroField.getDefaultAppearance(),
      /\s10 Tf/,
    );
    const { decodePDFRawStream } = await import("pdf-lib");
    const widget = form.getTextField("comments").acroField.getWidgets()[0];
    const appearance = new TextDecoder().decode(
      decodePDFRawStream(widget.getAppearances().normal).decode(),
    );
    assert.match(appearance, /0\.082353 0\.156863 0\.239216 rg/);
    const baseline = Number(appearance.match(/1 0 0 1 [\d.]+ ([\d.]+) Tm/)[1]);
    assert(
      baseline > widget.getRectangle().height - 25,
      "the first line starts near the top, without a line-sized blank gap",
    );
  } finally {
    await doc.pdf.loadingTask.destroy();
  }
});

test("document property edits preserve the form and unrelated properties, with consistent Unicode metadata and no stale XMP", async () => {
  const doc = await fixture("public/examples/garden-form.pdf");
  try {
    const source = await PDFDocument.load(doc.bytes, { updateMetadata: false });
    source.setTitle("Original fictional title");
    source.setAuthor("Original fictional author");
    source.setCreator("Fictional Fixture Maker");
    source.setProducer("Fixture Writer");
    source.context
      .lookup(source.context.trailerInfo.Info)
      .set(
        PDFName.of("FictionalCustom"),
        PDFString.of("retain this custom property"),
      );
    const packet = source.context.register(
      source.context.stream("<x:xmpmeta>FICTIONAL_STALE_XMP_489</x:xmpmeta>"),
    );
    source.catalog.set(PDFName.of("Metadata"), packet);
    doc.bytes = await source.save();
    const original = await PDFDocument.load(
      await exportDocument(doc, doc.initial),
      { updateMetadata: false },
    );
    assert.equal(original.getAuthor(), "Original fictional author");
    assert.equal(
      original.catalog.lookup(PDFName.of("Metadata")).getContentsString(),
      "<x:xmpmeta>FICTIONAL_STALE_XMP_489</x:xmpmeta>",
    );
    const metadata = {
      title: "Résumé 日本語 ✨",
      author: "Alex Example",
      subject: "Fictional note\nSecond line",
      keywords: "synthetic, demo; café",
      clearOther: false,
    };
    const bytes = await exportDocument(doc, { ...doc.initial, metadata });
    const edited = await PDFDocument.load(bytes, { updateMetadata: false });
    assert.equal(edited.getTitle(), metadata.title);
    assert.equal(edited.getAuthor(), metadata.author);
    assert.equal(edited.getSubject(), metadata.subject);
    assert.equal(edited.getKeywords(), metadata.keywords);
    assert.equal(edited.getCreator(), "Fictional Fixture Maker");
    assert.equal(edited.getProducer(), "Fixture Writer");
    assert.equal(
      edited.context
        .lookup(edited.context.trailerInfo.Info)
        .lookup(PDFName.of("FictionalCustom"))
        .decodeText(),
      "retain this custom property",
    );
    assert.equal(edited.catalog.has(PDFName.of("Metadata")), false);
    assert(
      !Buffer.from(bytes).includes(Buffer.from("FICTIONAL_STALE_XMP_489")),
    );
    assert.equal(
      edited.getForm().getTextField("fullName").getText(),
      doc.initial.values.fullName,
    );
    assert.equal(edited.getPageCount(), doc.viewports.length);
    const cleared = await PDFDocument.load(
      await exportDocument(doc, {
        ...doc.initial,
        metadata: {
          title: "",
          author: "",
          subject: "",
          keywords: "",
          clearOther: true,
        },
      }),
      { updateMetadata: false },
    );
    assert.equal(
      cleared.context.lookup(cleared.context.trailerInfo.Info).keys().length,
      0,
    );
    assert.equal(cleared.catalog.has(PDFName.of("Metadata")), false);
    assert.equal(
      cleared.getForm().getTextField("fullName").getText(),
      doc.initial.values.fullName,
    );
  } finally {
    await doc.pdf.loadingTask.destroy();
  }
});

test("removed indirect metadata is purged, while metadata objects shared by a page remain intact", async () => {
  const doc = await fixture("public/examples/garden-form.pdf");
  try {
    for (const shared of [false, true]) {
      const source = await PDFDocument.load(doc.bytes, {
        updateMetadata: false,
      });
      const author = source.context.register(
        PDFString.of("FICTIONAL_OLD_INDIRECT_AUTHOR"),
      );
      const secret = source.context.register(
        PDFString.of("FICTIONAL_OLD_INDIRECT_CUSTOM"),
      );
      const custom = source.context.register(
        source.context.obj({ Value: secret }),
      );
      const info = source.context.lookup(source.context.trailerInfo.Info);
      info.set(PDFName.of("Author"), author);
      info.set(PDFName.of("FictionalCustom"), custom);
      const packet = source.context.register(
        source.context.stream("<x:xmpmeta>FICTIONAL_SHARED_PACKET</x:xmpmeta>"),
      );
      source.catalog.set(PDFName.of("Metadata"), packet);
      if (shared) {
        source.getPage(0).node.set(PDFName.of("Metadata"), packet);
        source.getPage(0).node.set(PDFName.of("FictionalAudit"), author);
      }
      const altered = { ...doc, bytes: await source.save() };
      const result = await PDFDocument.load(
        await exportDocument(altered, {
          ...doc.initial,
          metadata: {
            title: "",
            author: "",
            subject: "",
            keywords: "",
            clearOther: true,
          },
        }),
        { updateMetadata: false },
      );
      assert.equal(
        result.context.lookup(result.context.trailerInfo.Info).keys().length,
        0,
      );
      assert(!result.catalog.has(PDFName.of("Metadata")));
      assert.equal(result.context.lookup(custom), undefined);
      assert.equal(result.context.lookup(secret), undefined);
      if (shared) {
        assert.equal(
          result
            .getPage(0)
            .node.lookup(PDFName.of("Metadata"))
            .getContentsString(),
          "<x:xmpmeta>FICTIONAL_SHARED_PACKET</x:xmpmeta>",
        );
        assert.equal(
          result.context.lookup(author).decodeText(),
          "FICTIONAL_OLD_INDIRECT_AUTHOR",
        );
      } else {
        assert.equal(result.context.lookup(packet), undefined);
        assert.equal(result.context.lookup(author), undefined);
      }
    }
  } finally {
    await doc.pdf.loadingTask.destroy();
  }
});
