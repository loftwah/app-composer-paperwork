import {
  PDFDropdown,
  PDFField,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFString,
  PDFTextField,
} from "pdf-lib";

// pdf-lib keeps the point size declared by the source /DA and measures text with
// the bundled font. That font has taller metrics than most form fonts, so a size
// that fits the source font can overflow the widget: option-list rows clip and
// single-line text leaves the box. Only *changed* fields are touched, and only
// when the declared size no longer fits.
const TF = /(\/[^\s/]+\s+)(\d*\.?\d+)(\s+Tf)/g;
const MIN_SIZE = 4;

type AppearanceTarget = {
  getDefaultAppearance(): string | undefined;
  dict: PDFField["acroField"]["dict"];
};

function lastFontCommand(appearance: string) {
  TF.lastIndex = 0;
  let match: RegExpExecArray | null,
    found: RegExpExecArray | undefined;
  while ((match = TF.exec(appearance))) found = match;
  return found;
}

function lastFontSize(appearance: string | undefined) {
  const found = appearance && lastFontCommand(appearance),
    size = Number(found?.[2]);
  return found && isFinite(size) ? size : undefined;
}

function setFontSize(target: AppearanceTarget, size: number) {
  const appearance = target.getDefaultAppearance(),
    found = appearance && lastFontCommand(appearance);
  if (!appearance || !found) return;
  const start = found.index + found[1].length,
    updated =
      appearance.slice(0, start) +
      String(Math.floor(size * 100) / 100) +
      appearance.slice(start + found[2].length);
  let bytes: Uint8Array;
  try {
    bytes = PDFString.of(updated).asBytes();
  } catch {
    // An unusual /DA encoding is left exactly as the source declared it.
    return;
  }
  target.dict.set(
    PDFName.of("DA"),
    PDFHexString.of(
      Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );
}

// Mirrors pdf-lib's word wrapping so the fitted size matches what it draws.
function rowCount(
  lines: string[],
  size: number,
  width: number,
  font: PDFFont,
  wrap: boolean,
) {
  if (!wrap) return lines.length;
  let rows = 0;
  for (const line of lines) {
    rows += 1;
    let remaining = width;
    const words = line.split(" ");
    for (const [index, word] of words.entries()) {
      const measured = font.widthOfTextAtSize(
        index === words.length - 1 ? word : word + " ",
        size,
      );
      remaining -= measured;
      if (remaining <= 0) {
        rows += 1;
        remaining = width - measured;
      }
    }
  }
  return rows;
}

function fittedSize(
  lines: string[],
  base: number,
  widget: ReturnType<PDFField["acroField"]["getWidgets"]>[number],
  font: PDFFont,
  leading: number,
  wrap: boolean,
) {
  const rectangle = widget.getRectangle(),
    border = widget.getBorderStyle()?.getWidth() ?? 0,
    rotation =
      (((widget.getAppearanceCharacteristics()?.getRotation() ?? 0) % 360) +
        360) %
      360,
    turned = rotation === 90 || rotation === 270,
    inset = (border + 1) * 2,
    width = (turned ? rectangle.height : rectangle.width) - inset,
    height = (turned ? rectangle.width : rectangle.height) - inset;
  if (base <= MIN_SIZE) return base;
  const fits = (size: number) =>
    rowCount(lines, size, width, font, wrap) *
      font.heightAtSize(size) *
      leading <=
    height;
  if (fits(base)) return base;
  for (let size = base; size > MIN_SIZE; size -= 0.25)
    if (fits(size)) return size;
  // More rows than the widget can ever show: keep the declared size and let
  // the reader scroll, instead of shrinking the visible rows to nothing.
  return base;
}

// The text pdf-lib draws into the appearance, or undefined for fields whose
// appearance is not text (check boxes and radio buttons keep their source art).
function drawnRows(field: PDFField) {
  if (field instanceof PDFTextField)
    return String(field.getText() ?? "")
      .replace(/\r/g, "")
      .split("\n");
  if (field instanceof PDFDropdown) return [field.getSelected()[0] ?? ""];
  if (field instanceof PDFOptionList) {
    const options = field.getOptions();
    if (field.isSorted()) options.sort();
    return options;
  }
}

export function fitFieldAppearance(field: PDFField, font: PDFFont) {
  const rows = drawnRows(field);
  if (!rows) return;
  const widgets = field.acroField.getWidgets(),
    fieldSize = lastFontSize(field.acroField.getDefaultAppearance()),
    // pdf-lib adds 20% line leading for wrapped rows only; a single line is
    // positioned by the font's own ascent and descent.
    wrapped =
      field instanceof PDFOptionList ||
      (field instanceof PDFTextField && field.isMultiline()),
    leading = wrapped ? 1.2 : 1;
  let shared: number | undefined;
  for (const widget of widgets) {
    const own = lastFontSize(widget.getDefaultAppearance()),
      base = own ?? fieldSize;
    if (!base) continue;
    const fit = fittedSize(rows, base, widget, font, leading, wrapped);
    if (fit >= base) continue;
    if (own !== undefined) setFontSize(widget, fit);
    else shared = Math.min(shared ?? fit, fit);
  }
  if (shared !== undefined) setFontSize(field.acroField, shared);
}

// A widget without the Print flag is omitted when the document is printed, so a
// value the user just completed would silently miss the paper copy. Edits are
// pinned to what the screen shows; untouched widgets keep their source flags.
export function markFieldPrintable(field: PDFField) {
  for (const widget of field.acroField.getWidgets()) {
    const flags =
      widget.dict.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
    if (!(flags & 4)) widget.dict.set(PDFName.of("F"), PDFNumber.of(flags | 4));
  }
}
