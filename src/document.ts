import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFName, PDFDict, PDFArray, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export const LIMITS = { bytes: 30 * 1024 * 1024, pages: 100, edge: 14400, pixels: 12_000_000, objects: 3000, points: 200000, signature: 5 * 1024 * 1024 };
export type Point = { x: number; y: number };
export type Addition = { id: string; page: number; kind: 'ink' | 'text' | 'tick' | 'image'; x: number; y: number; w: number; h: number; color: string; size: number; points?: Point[]; text?: string; image?: string; opacity?: number };
export type FieldValue = string | string[] | boolean;
export type Snapshot = { additions: Addition[]; values: Record<string, FieldValue> };
export type Widget = { id: string; fieldName: string; fieldType: string; rect: number[]; fieldValue?: FieldValue; readOnly?: boolean; required?: boolean; maxLen?: number; multiLine?: boolean; checkBox?: boolean; radioButton?: boolean; exportValue?: string; buttonValue?: string; combo?: boolean; multiSelect?: boolean; options?: { displayValue: string; exportValue: string }[]; rotation?: number; defaultAppearanceData?: { fontSize?: number } };
export type OpenDocument = { bytes: Uint8Array; pdf: PDFDocumentProxy; viewports: PageViewport[]; widgets: Widget[][]; initial: Snapshot; name: string; fontBytes: Uint8Array; font: Awaited<ReturnType<PDFDocument['embedFont']>>; note: string };
export const clone = <T>(value: T): T => structuredClone(value);
export function safeText(text: string, font: OpenDocument['font']) {
  const characters = new Set(font.getCharacterSet());
  if ([...text].some(c => c !== '\n' && c !== '\r' && c !== '\t' && !characters.has(c.codePointAt(0)!))) throw Error('This text includes a character our bundled font cannot save. Change that character; your edits are still here.');
}
export function lines(text: string, width: number, size: number, font: OpenDocument['font']): string[] {
  const result: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const c of paragraph) {
      if (line && font.widthOfTextAtSize(line + c, size) > width) { result.push(line); line = ''; }
      line += c;
    }
    result.push(line);
  }
  return result;
}
export async function openDocument(bytes: Uint8Array, name: string): Promise<OpenDocument> {
  if (bytes.length > LIMITS.bytes || !new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw Error('Choose a PDF smaller than 30 MB.');
  let parsed: PDFDocument;
  try { parsed = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); } catch { throw Error('This PDF is damaged or password-protected. Open an unprotected copy; your current work is still here.'); }
  const form = parsed.getForm();
  if (form.hasXFA()) throw Error('This PDF uses XFA forms, which Paperwork cannot safely save. Use a standard PDF copy from its publisher. Your current work is still here.');
  if (form.getFields().some(f => f.acroField.dict.get(PDFName.of('FT')) === PDFName.of('Sig') && f.acroField.dict.has(PDFName.of('V')))) throw Error('This PDF already has a certificate signature. Editing could invalidate it. Use an unsigned copy.');
  if (parsed.getPageCount() > LIMITS.pages || !parsed.getPageCount()) throw Error('Choose a document with 1–100 pages.');
  const task = pdfjs.getDocument({ data: bytes.slice(), enableXfa: false, maxImageSize: 16_000_000, useSystemFonts: false, stopAtErrors: true, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/', });
  let pdf: PDFDocumentProxy | undefined;
  try {
    pdf = await task.promise;
    const viewports: PageViewport[] = [], widgets: Widget[][] = [];
    const values: Record<string, FieldValue> = Object.create(null);
    let unsupported = false;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), viewport = page.getViewport({ scale: 1 });
      if (viewport.width > LIMITS.edge || viewport.height > LIMITS.edge) throw Error('A page is too large to edit safely. Use a smaller PDF copy.');
      viewports.push(viewport);
      const annotations = await page.getAnnotations({ intent: 'display' });
      const fields = annotations.filter(a => a.subtype === 'Widget') as Widget[];
      widgets.push(fields.filter(w => ['Tx', 'Ch'].includes(w.fieldType) || w.checkBox || w.radioButton));
      unsupported ||= fields.some(w => !['Tx', 'Ch'].includes(w.fieldType) && !w.checkBox && !w.radioButton);
      for (const field of form.getFields()) {
        const key = field.getName();
        if (field instanceof PDFTextField) values[key] = field.getText() || '';
        else if (field instanceof PDFCheckBox) values[key] = field.isChecked();
        else if (field instanceof PDFRadioGroup) values[key] = field.getSelected() || '';
        else if (field instanceof PDFDropdown || field instanceof PDFOptionList) values[key] = field.getSelected();
      }
    }
    const fontBytes = new Uint8Array(await (await fetch('/fonts/SpaceGrotesk.ttf')).arrayBuffer());
    parsed.registerFontkit(fontkit);
    const font = await parsed.embedFont(fontBytes, { subset: true });
    return { bytes, pdf, viewports, widgets, initial: { additions: [], values }, name, fontBytes, font, note: unsupported ? 'Some boxes cannot be edited directly. Use Text or Tick to fill them on the page.' : '' };
  } catch (error) { await task.destroy(); throw error; }
}
function color(hex: string) { return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255); }
// Remove document actions from the exported copy too. The renderer never executes them.
function removeActions(pdf: PDFDocument) {
  for (const [, value] of pdf.context.enumerateIndirectObjects()) {
    if (!(value instanceof PDFDict)) continue;
    value.delete(PDFName.of('AA'));
    value.delete(PDFName.of('OpenAction'));
    const action = value.lookupMaybe(PDFName.of('A'), PDFDict);
    if (action) value.delete(PDFName.of('A'));
    const names = value.lookupMaybe(PDFName.of('Names'), PDFDict);
    names?.delete(PDFName.of('JavaScript'));
  }
}
export async function exportDocument(doc: OpenDocument, state: Snapshot): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(doc.bytes, { updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(doc.fontBytes, { subset: true });
  const form = pdf.getForm();
  for (const field of form.getFields()) {
    const key = field.getName(), value = state.values[key];
    if (JSON.stringify(value) === JSON.stringify(doc.initial.values[key])) continue;
    if (field instanceof PDFTextField) { safeText(String(value ?? ''), font); field.setText(String(value ?? '')); field.updateAppearances(font); }
    else if (field instanceof PDFCheckBox) { value ? field.check() : field.uncheck(); }
    else if (field instanceof PDFRadioGroup) { value ? field.select(String(value)) : field.clear(); }
    else if (field instanceof PDFDropdown || field instanceof PDFOptionList) { const selected = Array.isArray(value) ? value : value ? [String(value)] : []; selected.forEach(t => safeText(t, font)); selected.length ? field.select(selected) : field.clear(); field.updateAppearances(font); }
  }
  for (const item of state.additions) {
    const page = pdf.getPage(item.page), viewport = doc.viewports[item.page];
    if (item.kind === 'ink') {
      const points = item.points || [];
      for (let i = 1; i < points.length; i++) {
        const a = viewport.convertToPdfPoint(points[i - 1].x, points[i - 1].y), b = viewport.convertToPdfPoint(points[i].x, points[i].y);
        page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: item.size, color: color(item.color), opacity: item.opacity ?? 1, lineCap: 1 });
      }
      continue;
    }
    // A local upright coordinate system maps identically through crop, rotation and zoom.
    const origin = viewport.convertToPdfPoint(item.x, item.y + item.h), right = viewport.convertToPdfPoint(item.x + 1, item.y + item.h), up = viewport.convertToPdfPoint(item.x, item.y + item.h - 1);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(right[0] - origin[0], right[1] - origin[1], up[0] - origin[0], up[1] - origin[1], origin[0], origin[1]));
    if (item.kind === 'image' && item.image) { const image = await pdf.embedPng(item.image); page.drawImage(image, { x: 0, y: 0, width: item.w, height: item.h }); }
    if (item.kind === 'tick') {
      page.drawLine({ start: { x: item.w * .12, y: item.h * .48 }, end: { x: item.w * .4, y: item.h * .18 }, thickness: item.size, color: color(item.color), lineCap: 1 });
      page.drawLine({ start: { x: item.w * .4, y: item.h * .18 }, end: { x: item.w * .9, y: item.h * .86 }, thickness: item.size, color: color(item.color), lineCap: 1 });
    }
    if (item.kind === 'text') {
      safeText(item.text || '', font);
      lines(item.text || '', item.w, item.size, font).forEach((line, i) => page.drawText(line, { x: 0, y: item.h - item.size - i * item.size * 1.25, font, size: item.size, color: color(item.color) }));
    }
    page.pushOperators(popGraphicsState());
  }
  removeActions(pdf);
  form.updateFieldAppearances(font);
  const result = await pdf.save({ updateFieldAppearances: false });
  // A failed validation never replaces the in-memory edits or reports success.
  const reopened = await PDFDocument.load(result);
  if (reopened.getPageCount() !== doc.viewports.length) throw Error('The completed PDF did not pass its save check. Your edits are still here.');
  return result;
}
