import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFHexString,
  setLineJoin,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { OpenDocument, Snapshot } from "./document.ts";
import { safeText, lines } from "./text.ts";
import { writeMetadata } from "./metadata.ts";
function color(hex: string) {
  return rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
}
// Remove document actions from the exported copy too. The renderer never executes them.
function removeActions(pdf: PDFDocument) {
  pdf.catalog.delete(PDFName.of("OpenAction"));
  pdf.catalog.delete(PDFName.of("AA"));
  const names = pdf.catalog.lookup(PDFName.of("Names"));
  if (names instanceof PDFDict) names.delete(PDFName.of("JavaScript"));
  const actions = new Set([
    "JavaScript",
    "Launch",
    "URI",
    "SubmitForm",
    "ImportData",
    "GoToR",
    "GoToE",
    "Rendition",
    "Sound",
    "Movie",
  ]);
  const seen = new WeakSet<object>();
  function visit(value: unknown) {
    if (
      !(value instanceof PDFDict || value instanceof PDFArray) ||
      seen.has(value)
    )
      return;
    seen.add(value);
    if (value instanceof PDFDict) {
      const kind = value.get(PDFName.of("S"));
      if (kind instanceof PDFName && actions.has(kind.decodeText())) {
        for (const key of value.keys()) value.delete(key);
        return;
      }
      for (const [, child] of value.entries()) visit(child);
    } else {
      for (let index = 0; index < value.size(); index++)
        visit(value.get(index));
    }
  }
  for (const [, value] of pdf.context.enumerateIndirectObjects()) visit(value);
}
export async function exportDocument(
  doc: OpenDocument,
  state: Snapshot,
): Promise<Uint8Array> {
  for (const item of state.additions) {
    if (item.kind === "ink") continue;
    const viewport = doc.viewports[item.page];
    const height =
      item.kind === "text"
        ? Math.max(
            item.h,
            lines(item.text || "", item.w, item.size, doc.font).length *
              item.size *
              1.25 +
              4,
          )
        : item.h;
    if (
      !viewport ||
      item.x < 0 ||
      item.y < 0 ||
      item.x + item.w > viewport.width + 0.1 ||
      item.y + height > viewport.height + 0.1
    )
      throw Error(
        `An addition on page ${item.page + 1} extends outside the page. Move it or reduce its size before saving. Your edits are still here.`,
      );
  }
  const pdf = await PDFDocument.load(doc.bytes, { updateMetadata: false });
  if (state.metadata) writeMetadata(pdf, state.metadata);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(doc.fontBytes, { subset: true });
  const form = pdf.getForm();
  for (const field of form.getFields()) {
    if (field.isReadOnly()) continue;
    const key = field.getName(),
      value = state.values[key];
    if (JSON.stringify(value) === JSON.stringify(doc.initial.values[key]))
      continue;
    // pdf-lib reads literal /DA strings without decoding PDF octal escapes.
    // Preserve the decoded bytes as hex so its appearance provider retains the
    // source font size and colour instead of silently auto-sizing the text.
    for (const target of [field.acroField, ...field.acroField.getWidgets()]) {
      const appearance = target.DA();
      if (appearance instanceof PDFString)
        target.dict.set(
          PDFName.of("DA"),
          PDFHexString.of(
            Array.from(appearance.asBytes(), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join(""),
          ),
        );
    }
    if (field instanceof PDFTextField) {
      safeText(String(value ?? ""), font);
      field.setText(String(value ?? ""));
      field.updateAppearances(font);
    } else if (field instanceof PDFCheckBox) {
      value ? field.check() : field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      value ? field.select(String(value)) : field.clear();
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const selected = Array.isArray(value)
        ? value
        : value
          ? [String(value)]
          : [];
      selected.forEach((t) => safeText(t, font));
      selected.length ? field.select(selected) : field.clear();
      field.updateAppearances(font);
    }
  }
  for (const item of state.additions) {
    const page = pdf.getPage(item.page),
      viewport = doc.viewports[item.page];
    if (item.kind === "ink") {
      const points = (item.points || []).map((point) =>
        viewport.convertToPdfPoint(point.x, point.y),
      );
      const path = points
        .map(([x, y], index) => `${index ? "L" : "M"} ${x} ${-y}`)
        .join(" ");
      page.pushOperators(pushGraphicsState(), setLineJoin(1));
      page.drawSvgPath(path, {
        x: 0,
        y: 0,
        borderColor: color(item.color),
        borderWidth: item.size,
        borderOpacity: item.opacity ?? 1,
        borderLineCap: 1,
      });
      page.pushOperators(popGraphicsState());
      continue;
    }
    // A local upright coordinate system maps identically through crop, rotation and zoom.
    const origin = viewport.convertToPdfPoint(item.x, item.y + item.h),
      right = viewport.convertToPdfPoint(item.x + 1, item.y + item.h),
      up = viewport.convertToPdfPoint(item.x, item.y + item.h - 1);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(
        right[0] - origin[0],
        right[1] - origin[1],
        up[0] - origin[0],
        up[1] - origin[1],
        origin[0],
        origin[1],
      ),
    );
    if (item.kind === "image" && item.image) {
      const image = await pdf.embedPng(item.image);
      page.drawImage(image, { x: 0, y: 0, width: item.w, height: item.h });
    }
    if (item.kind === "tick") {
      page.drawLine({
        start: { x: item.w * 0.12, y: item.h * 0.48 },
        end: { x: item.w * 0.4, y: item.h * 0.18 },
        thickness: item.size,
        color: color(item.color),
        lineCap: 1,
      });
      page.drawLine({
        start: { x: item.w * 0.4, y: item.h * 0.18 },
        end: { x: item.w * 0.9, y: item.h * 0.86 },
        thickness: item.size,
        color: color(item.color),
        lineCap: 1,
      });
    }
    if (item.kind === "text") {
      safeText(item.text || "", font);
      lines(item.text || "", item.w, item.size, font).forEach((line, i) =>
        page.drawText(line, {
          x: 0,
          y: item.h - item.size - i * item.size * 1.25,
          font,
          size: item.size,
          color: color(item.color),
        }),
      );
    }
    page.pushOperators(popGraphicsState());
  }
  removeActions(pdf);
  form.updateFieldAppearances(font);
  const result = await pdf.save({ updateFieldAppearances: false });
  // A failed validation never replaces the in-memory edits or reports success.
  const reopened = await PDFDocument.load(result);
  if (reopened.getPageCount() !== doc.viewports.length)
    throw Error(
      "The completed PDF did not pass its save check. Your edits are still here.",
    );
  return result;
}
