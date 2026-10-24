// Generates the synthetic interoperability fixtures used by tests/export.test.mjs.
// Fictional values only. Run: node tests/fixtures/interop-264/generate.mjs
import { PDFDocument, PDFName, PDFNumber, StandardFonts, rgb, degrees } from "pdf-lib";
import { writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const ink = rgb(0.082, 0.157, 0.239);
const gray = rgb(0.45, 0.5, 0.55);

function label(page, text, x, y, size = 9) {
  page.drawText(text, { x, y, size, color: gray });
}
function rule(page, y) {
  page.drawLine({
    start: { x: 60, y },
    end: { x: 552, y },
    thickness: 0.5,
    color: rgb(0.85, 0.87, 0.89),
  });
}

const pdf = await PDFDocument.create();
pdf.setTitle("Synthetic awkward widget fixture");
pdf.setAuthor("Paperwork synthetic fixtures");
pdf.setSubject("Not a real person's document");
const font = await pdf.embedFont(StandardFonts.Helvetica);

const page = pdf.addPage([612, 792]);
page.drawText("AWKWARD WIDGETS / SYNTHETIC", {
  x: 60,
  y: 748,
  size: 18,
  color: ink,
  font,
});
page.drawText(
  "Fictional print flags, declared sizes, rotation and custom art",
  { x: 60, y: 728, size: 9.5, color: gray, font },
);
rule(page, 712);

label(page, "VALUE ON A WIDGET WITHOUT THE PRINT FLAG", 60, 676);
const unprintable = pdf.getForm().createTextField("unprintable_value");
unprintable.setText("Completed but not printable");
unprintable.addToPage(page, {
  x: 60,
  y: 630,
  width: 200,
  height: 30,
  borderWidth: 1,
  borderColor: gray,
  textColor: ink,
  font,
  fontSize: 11,
});
for (const widget of unprintable.acroField.getWidgets())
  widget.dict.delete(PDFName.of("F"));

label(page, "ORDINARY PRINTABLE WIDGET", 340, 676);
const printable = pdf.getForm().createTextField("printable_value");
printable.setText("Prints normally");
printable.addToPage(page, {
  x: 340,
  y: 630,
  width: 200,
  height: 30,
  borderWidth: 1,
  borderColor: gray,
  textColor: ink,
  font,
  fontSize: 11,
});

label(page, "OPTION LIST: 23pt DECLARED IN A 78pt BOX", 60, 596);
const list = pdf.getForm().createOptionList("tight_list");
list.addOptions(["Herbs", "Flowers", "Vegetables"]);
list.enableMultiselect();
list.select(["Herbs"]);
list.addToPage(page, {
  x: 60,
  y: 508,
  width: 200,
  height: 78,
  borderWidth: 1,
  borderColor: gray,
  textColor: ink,
  font,
  fontSize: 23,
});
label(page, "DROPDOWN: 24pt DECLARED IN A 31pt BOX", 340, 596);
const combo = pdf.getForm().createDropdown("tight_combo");
combo.addOptions(["First visit", "Some gardening", "Experienced"]);
combo.select("First visit");
combo.addToPage(page, {
  x: 340,
  y: 555,
  width: 200,
  height: 31,
  borderWidth: 1,
  borderColor: gray,
  textColor: ink,
  font,
  fontSize: 24,
});

label(page, "90 DEGREE WIDGET ROTATION (/MK /R)", 60, 480);
const turned = pdf.getForm().createTextField("turned_label");
turned.setText("SIDEWAYS");
turned.addToPage(page, {
  x: 60,
  y: 340,
  width: 40,
  height: 120,
  borderWidth: 1,
  borderColor: gray,
  textColor: ink,
  font,
  fontSize: 12,
});
turned.acroField
  .getWidgets()[0]
  .getOrCreateAppearanceCharacteristics()
  .setRotation(degrees(90).angle);

label(page, "CHECK BOX WITH CUSTOM APPEARANCE ART", 340, 480);
const custom = pdf.getForm().createCheckBox("custom_tick");
custom.addToPage(page, {
  x: 340,
  y: 430,
  width: 22,
  height: 22,
  borderWidth: 1,
  borderColor: gray,
});
const context = pdf.context;
const drawArt = (stroke) =>
  context.register(
    context.stream(
      [
        "q 1 1 1 rg 0 0 22 22 re f Q",
        "q 0.082 0.157 0.239 RG 1.6 w 4 4 m 18 18 l S Q",
        stroke
          ? "q 0.082 0.157 0.239 RG 1.6 w 18 4 m 4 18 l S Q"
          : "",
      ].join("\n"),
      {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 22, 22],
        Resources: {},
      },
    ),
  );
custom.acroField.getWidgets()[0].dict.set(
  PDFName.of("AP"),
  context.obj({ N: { Off: drawArt(false), Yes: drawArt(true) } }),
);

label(page, "READ-ONLY VALUE AND A CHECK BOX WITHOUT PRINT", 340, 400);
const locked = pdf.getForm().createTextField("locked_value");
locked.setText("LOCKED-001");
locked.enableReadOnly();
locked.addToPage(page, {
  x: 340,
  y: 350,
  width: 120,
  height: 26,
  borderWidth: 1,
  borderColor: gray,
  textColor: ink,
  font,
  fontSize: 11,
});
const silentTick = pdf.getForm().createCheckBox("silent_tick");
silentTick.addToPage(page, {
  x: 480,
  y: 352,
  width: 22,
  height: 22,
  borderWidth: 1,
  borderColor: gray,
});
for (const widget of silentTick.acroField.getWidgets())
  widget.dict.delete(PDFName.of("F"));

label(page, "LIST WITH MORE ROWS THAN THE BOX CAN EVER SHOW", 60, 300);
const many = pdf.getForm().createOptionList("long_list");
many.addOptions(
  Array.from({ length: 40 }, (_, index) => `Fictional option ${index + 1}`),
);
many.select(["Fictional option 3"]);
many.addToPage(page, {
  x: 60,
  y: 200,
  width: 200,
  height: 80,
  borderWidth: 1,
  borderColor: gray,
  textColor: ink,
  font,
  fontSize: 12,
});
// pdf-lib shrinks a new list to fit on creation; keep the declared size the
// source author wanted so the editor has to decide what to do with it.
many.acroField.setDefaultAppearance("0.082 0.157 0.239 rg /Helvetica 12 Tf");

page.drawText(
  "SYNTHETIC FIXTURE — NO REAL PERSON, SIGNATURE OR PRIVATE DATA",
  { x: 60, y: 60, size: 8, color: gray, font },
);

// Ask every reader to rebuild appearances: the source deliberately has stale ones.
pdf
  .getForm()
  .acroForm.dict.set(PDFName.of("NeedAppearances"), PDFNumber.of(1));

writeFileSync(path.join(here, "awkward-widgets.pdf"), await pdf.save());

// Minimal hybrid XFA carrier: a form dictionary that claims an XFA packet.
const xfa = await PDFDocument.create();
xfa.addPage([595, 842]).drawText("XFA SYNTHETIC FIXTURE", {
  x: 60,
  y: 760,
  size: 16,
});
xfa.getForm().acroForm.dict.set(
  PDFName.of("XFA"),
  xfa.context.obj({
    template: xfa.context.stream("<xdp:xdp>fictional</xdp:xdp>"),
  }),
);
writeFileSync(path.join(here, "xfa-form.pdf"), await xfa.save());
console.log("wrote awkward-widgets.pdf and xfa-form.pdf");
