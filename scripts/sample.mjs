import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { writeFileSync, mkdirSync } from "node:fs";
import { PNG } from "pngjs";
mkdirSync("public/examples", { recursive: true });
const doc = await PDFDocument.create(),
  font = await doc.embedFont(StandardFonts.Helvetica),
  bold = await doc.embedFont(StandardFonts.HelveticaBold),
  form = doc.getForm();
const orange = rgb(0.78, 0.23, 0),
  gray = rgb(0.35, 0.38, 0.42);
function text(page, value, x, y, size = 11, strong = false) {
  page.drawText(value, { x, y, size, font: strong ? bold : font, color: gray });
}
function header(page, title, sub) {
  text(page, "PAPERWORK / FICTIONAL SAMPLE", 44, 790, 10, true);
  text(page, title, 44, 750, 27, true);
  text(page, sub, 44, 722);
  page.drawLine({
    start: { x: 44, y: 700 },
    end: { x: 550, y: 700 },
    thickness: 2,
    color: orange,
  });
}
function field(name, label, x, y, w = 225, h = 29, value = "") {
  const p = doc.getPage(0);
  text(p, label, x, y + h + 9);
  const f = form.createTextField(name);
  f.setText(value);
  f.addToPage(p, { x, y, width: w, height: h, fontSize: 12, borderWidth: 1 });
  return f;
}
const p = doc.addPage([595, 842]);
header(
  p,
  "A little time outdoors",
  "Riverbank Community Garden - volunteer day registration",
);
text(
  p,
  "This is a fictional form. Try changing an answer, drawing and signing.",
  44,
  672,
);
field("fullName", "Full name", 44, 590, 235, 30, "Alex Example");
field("date", "Date", 310, 590, 235, 30, "24 October 2026");
const notes = field(
  "notes",
  "What would you like to help with?",
  44,
  474,
  501,
  69,
  "Planting herbs and painting the garden signs.",
);
notes.enableMultiline();
text(p, "Preferred session", 44, 437);
const radio = form.createRadioGroup("session");
radio.addOptionToPage("Morning", p, { x: 45, y: 402, width: 18, height: 18 });
text(p, "Morning", 72, 406);
radio.addOptionToPage("Afternoon", p, {
  x: 220,
  y: 402,
  width: 18,
  height: 18,
});
text(p, "Afternoon", 248, 406);
radio.select("Morning");
text(p, "Experience", 44, 368);
const drop = form.createDropdown("experience");
drop.addOptions(["First visit", "Some gardening", "Experienced"]);
drop.select("First visit");
drop.addToPage(p, { x: 44, y: 323, width: 235, height: 30, fontSize: 12 });
text(p, "Interests (choose any)", 310, 368);
const list = form.createOptionList("interests");
list.addOptions(["Herbs", "Flowers", "Vegetables"]);
list.enableMultiselect();
list.select(["Herbs"]);
list.addToPage(p, { x: 310, y: 272, width: 235, height: 81, fontSize: 12 });
const check = form.createCheckBox("updates");
check.addToPage(p, { x: 44, y: 258, width: 19, height: 19 });
text(p, "Send me the next fictional garden newsletter.", 74, 263);
text(p, "A paper-only box: use Tick here", 44, 213);
p.drawRectangle({
  x: 44,
  y: 177,
  width: 19,
  height: 19,
  borderWidth: 1,
  borderColor: gray,
});
text(p, "I will bring a hat.", 74, 181);
text(
  p,
  "Add a note, circle something or draw a visual signature below.",
  44,
  140,
);
p.drawLine({
  start: { x: 44, y: 65 },
  end: { x: 545, y: 65 },
  thickness: 1,
  color: gray,
});
text(p, "Page 1 of 2 - no personal data required", 44, 32, 9);
const q = doc.addPage([595, 842]);
header(
  q,
  "One more thing",
  "A flat page for handwritten notes and your fictional signature",
);
text(q, "Your plan for the day", 44, 666, 16, true);
for (let y = 620; y > 330; y -= 44)
  q.drawLine({
    start: { x: 44, y },
    end: { x: 545, y },
    thickness: 0.5,
    color: rgb(0.75, 0.77, 0.8),
  });
text(q, "Signature", 44, 270, 16, true);
text(
  q,
  "Draw with Pen, or import the fictional transparent PNG from Help.",
  44,
  242,
);
q.drawRectangle({
  x: 44,
  y: 105,
  width: 500,
  height: 108,
  borderWidth: 1,
  borderColor: gray,
});
text(q, "Page 2 of 2 - a visual signature only", 44, 32, 9);
form.updateFieldAppearances(font);
writeFileSync("public/examples/garden-form.pdf", await doc.save());
const flat = await PDFDocument.create();
await flat
  .copyPages(doc, [0, 1])
  .then((pages) => pages.forEach((page) => flat.addPage(page)));
flat.getForm().flatten();
writeFileSync("public/examples/flat-form.pdf", await flat.save());
const rotated = await PDFDocument.load(await doc.save());
rotated.getPage(1).setRotation(degrees(90));
rotated.getPage(0).setCropBox(20, 20, 555, 802);
writeFileSync("public/examples/rotated-form.pdf", await rotated.save());
const png = new PNG({ width: 420, height: 120 });
const strokes = [
  [
    [12, 90],
    [30, 25],
    [49, 89],
    [64, 59],
    [85, 62],
    [68, 84],
    [112, 65],
    [131, 32],
    [110, 84],
    [154, 57],
    [169, 81],
    [191, 55],
    [182, 85],
    [223, 61],
    [239, 80],
    [270, 56],
    [291, 79],
    [324, 45],
    [310, 91],
    [390, 73],
  ],
  [
    [36, 104],
    [388, 98],
  ],
];
for (const s of strokes)
  for (let j = 1; j < s.length; j++) {
    const [a, b] = [s[j - 1], s[j]],
      n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n),
        y = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const k = ((y + dy) * png.width + x + dx) * 4;
          png.data[k] = 25;
          png.data[k + 1] = 52;
          png.data[k + 2] = 100;
          png.data[k + 3] = 255;
        }
    }
  }
writeFileSync("public/examples/fictional-signature.png", PNG.sync.write(png));
