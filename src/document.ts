import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFName,
  PDFDict,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export const LIMITS = {
  bytes: 30 * 1024 * 1024,
  pages: 100,
  edge: 14400,
  pixels: 12_000_000,
  objects: 3000,
  points: 200000,
  signature: 5 * 1024 * 1024,
};
export type Point = { x: number; y: number };
export type Addition = {
  id: string;
  page: number;
  kind: "ink" | "text" | "tick" | "image";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  size: number;
  points?: Point[];
  text?: string;
  image?: string;
  opacity?: number;
};
export type FieldValue = string | string[] | boolean;
export type Snapshot = {
  additions: Addition[];
  values: Record<string, FieldValue>;
};
export type Widget = {
  id: string;
  fieldName: string;
  fieldType: string;
  rect: number[];
  fieldValue?: FieldValue;
  readOnly?: boolean;
  required?: boolean;
  maxLen?: number;
  multiLine?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  exportValue?: string;
  buttonValue?: string;
  combo?: boolean;
  multiSelect?: boolean;
  options?: { displayValue: string; exportValue: string }[];
  rotation?: number;
  defaultAppearanceData?: { fontSize?: number };
};
export type OpenDocument = {
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  viewports: PageViewport[];
  widgets: Widget[][];
  initial: Snapshot;
  name: string;
  fontBytes: Uint8Array;
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  note: string;
};
export const clone = <T>(value: T): T => structuredClone(value);
export async function openDocument(
  bytes: Uint8Array,
  name: string,
): Promise<OpenDocument> {
  if (
    bytes.length > LIMITS.bytes ||
    !new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-")
  )
    throw Error("Choose a PDF smaller than 30 MB.");
  let parsed: PDFDocument;
  try {
    parsed = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
  } catch {
    throw Error(
      "This PDF is damaged or password-protected. Open an unprotected copy; your current work is still here.",
    );
  }
  const form = parsed.getForm();
  if (form.hasXFA())
    throw Error(
      "This PDF uses XFA forms, which Paperwork cannot safely save. Use a standard PDF copy from its publisher. Your current work is still here.",
    );
  if (
    form
      .getFields()
      .some(
        (f) =>
          f.acroField.dict.get(PDFName.of("FT")) === PDFName.of("Sig") &&
          f.acroField.dict.has(PDFName.of("V")),
      )
  )
    throw Error(
      "This PDF already has a certificate signature. Editing could invalidate it. Use an unsigned copy.",
    );
  if (parsed.getPageCount() > LIMITS.pages || !parsed.getPageCount())
    throw Error("Choose a document with 1–100 pages.");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    enableXfa: false,
    maxImageSize: 16_000_000,
    useSystemFonts: false,
    stopAtErrors: true,
    cMapUrl: "/pdf-assets/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdf-assets/standard_fonts/",
    wasmUrl: "/pdf-assets/wasm/",
  });
  let pdf: PDFDocumentProxy | undefined;
  try {
    pdf = await task.promise;
    const viewports: PageViewport[] = [],
      widgets: Widget[][] = [];
    const values: Record<string, FieldValue> = Object.create(null);
    let unsupported = false;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i),
        viewport = page.getViewport({ scale: 1 });
      if (viewport.width > LIMITS.edge || viewport.height > LIMITS.edge)
        throw Error(
          "A page is too large to edit safely. Use a smaller PDF copy.",
        );
      viewports.push(viewport);
      const annotations = await page.getAnnotations({ intent: "display" });
      const fields = annotations.filter(
        (a) => a.subtype === "Widget",
      ) as Widget[];
      widgets.push(
        fields.filter(
          (w) =>
            ["Tx", "Ch"].includes(w.fieldType) || w.checkBox || w.radioButton,
        ),
      );
      unsupported ||= fields.some(
        (w) =>
          !["Tx", "Ch"].includes(w.fieldType) && !w.checkBox && !w.radioButton,
      );
      for (const field of form.getFields()) {
        const key = field.getName();
        if (field instanceof PDFTextField) values[key] = field.getText() || "";
        else if (field instanceof PDFCheckBox) values[key] = field.isChecked();
        else if (field instanceof PDFRadioGroup)
          values[key] = field.getSelected() || "";
        else if (field instanceof PDFDropdown || field instanceof PDFOptionList)
          values[key] = field.getSelected();
      }
    }
    if (widgets.reduce((n, ws) => n + ws.length, 0) > 2000)
      throw Error("This form has too many fields. Use a smaller PDF copy.");
    const fontBytes = new Uint8Array(
      await (await fetch("/fonts/SpaceGrotesk.ttf")).arrayBuffer(),
    );
    parsed.registerFontkit(fontkit);
    const font = await parsed.embedFont(fontBytes, { subset: true });
    return {
      bytes,
      pdf,
      viewports,
      widgets,
      initial: { additions: [], values },
      name,
      fontBytes,
      font,
      note: unsupported
        ? "Some boxes cannot be edited directly. Use Text or Tick to fill them on the page."
        : "",
    };
  } catch (error) {
    await task.destroy();
    throw error;
  }
}
