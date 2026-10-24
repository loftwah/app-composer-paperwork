import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

// pdf-lib strips XFA data the first time getForm() runs and warns only in the
// console, so a document must be checked before the form is touched. Denying
// XFA here keeps the editor from saving a file whose form data was removed.
export const hasXfaForm = (pdf: PDFDocument) =>
  !!pdf.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)?.has(
    PDFName.of("XFA"),
  );
