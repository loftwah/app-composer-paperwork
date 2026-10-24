import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFBool,
  PDFRef,
  PDFArray,
  PDFStream,
  PDFString,
} from "pdf-lib";

export const PROPERTY_KEYS = {
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
} as const;
export type Properties = Record<keyof typeof PROPERTY_KEYS, string>;
export type MetadataEdit = Properties & { clearOther: boolean };
export type DocumentMetadata = {
  properties: Properties;
  details: { name: string; value: string }[];
  xmp: boolean;
};

function text(value: unknown): string {
  try {
    return value instanceof PDFString || value instanceof PDFHexString
      ? value.decodeText()
      : "";
  } catch {
    return "";
  }
}

export function readMetadata(pdf: PDFDocument): DocumentMetadata {
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info);
  const properties = Object.fromEntries(
    Object.entries(PROPERTY_KEYS).map(([field, key]) => [
      field,
      info instanceof PDFDict ? text(info.lookup(PDFName.of(key))) : "",
    ]),
  ) as Properties;
  const labels: Record<string, string> = {
    Creator: "Created with",
    Producer: "PDF producer",
    CreationDate: "Created",
    ModDate: "Modified",
  };
  const details =
    info instanceof PDFDict
      ? info
          .entries()
          .filter(
            ([key]) =>
              !Object.values(PROPERTY_KEYS).some(
                (value) => value === key.decodeText(),
              ),
          )
          .map(([key, raw]) => {
            const value = pdf.context.lookup(raw);
            let display = text(value);
            if (
              key.decodeText() === "CreationDate" ||
              key.decodeText() === "ModDate"
            ) {
              try {
                if (value instanceof PDFString || value instanceof PDFHexString)
                  display = value.decodeDate().toISOString();
              } catch {
                /* Keep the original value if its date is malformed. */
              }
            }
            if (!display)
              display =
                value instanceof PDFName ||
                value instanceof PDFNumber ||
                value instanceof PDFBool
                  ? String(value)
                  : value == null
                    ? ""
                    : "Embedded value";
            return {
              name: labels[key.decodeText()] || key.decodeText(),
              value: display,
            };
          })
      : [];
  return { properties, details, xmp: pdf.catalog.has(PDFName.of("Metadata")) };
}

export function includeXmp(
  metadata: DocumentMetadata,
  entries: Iterable<[string, unknown]>,
) {
  const fields: Record<string, keyof Properties> = {
    "dc:title": "title",
    "dc:creator": "author",
    "dc:description": "subject",
    "pdf:keywords": "keywords",
    "dc:subject": "keywords",
  };
  for (const [name, raw] of entries) {
    const value =
      typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? raw.filter((item) => typeof item === "string").join("; ")
          : "";
    if (!value) continue;
    const field = fields[name];
    if (field && !metadata.properties[field])
      metadata.properties[field] = value;
    metadata.details.push({ name: `XMP ${name}`, value });
  }
}

export function writeMetadata(pdf: PDFDocument, edit: MetadataEdit) {
  const previous = readMetadata(pdf).properties;
  for (const key of Object.keys(PROPERTY_KEYS) as (keyof Properties)[]) {
    if (
      typeof edit[key] !== "string" ||
      (edit[key] !== previous[key] && edit[key].length > 4096)
    )
      throw Error(
        "Keep each document property under 4,096 characters. Your edits are still here.",
      );
  }
  let info = pdf.context.lookup(pdf.context.trailerInfo.Info);
  if (!(info instanceof PDFDict)) {
    info = pdf.context.obj({});
    pdf.context.trailerInfo.Info = pdf.context.register(info);
  }
  const dictionary = info as PDFDict;
  const discarded = edit.clearOther
    ? dictionary.entries().map(([, value]) => value)
    : Object.values(PROPERTY_KEYS).map((key) =>
        dictionary.get(PDFName.of(key)),
      );
  discarded.push(pdf.catalog.get(PDFName.of("Metadata")));
  const candidates = metadataReferences(pdf, discarded);
  if (edit.clearOther)
    for (const key of dictionary.keys()) dictionary.delete(key);
  for (const [field, key] of Object.entries(PROPERTY_KEYS)) {
    const value = edit[field as keyof Properties];
    if (value) dictionary.set(PDFName.of(key), PDFHexString.fromText(value));
    else dictionary.delete(PDFName.of(key));
  }
  // Readers may prefer XMP over Info. Drop the document's conflicting packet.
  pdf.catalog.delete(PDFName.of("Metadata"));
  // pdf-lib also serializes orphan objects. Remove only discarded metadata
  // objects that are no longer reachable; shared page/content objects survive.
  const retained = metadataReferences(
    pdf,
    Object.values(pdf.context.trailerInfo),
  );
  for (const [key, ref] of candidates)
    if (!retained.has(key)) pdf.context.delete(ref);
}

function metadataReferences(pdf: PDFDocument, roots: unknown[]) {
  const references = new Map<string, PDFRef>(),
    seen = new WeakSet<object>();
  const pending = [...roots];
  while (pending.length) {
    const value = pending.pop();
    if (value instanceof PDFRef) {
      const key = value.toString();
      if (references.has(key)) continue;
      references.set(key, value);
      pending.push(pdf.context.lookup(value));
    } else if (value && typeof value === "object" && !seen.has(value)) {
      seen.add(value);
      if (value instanceof PDFStream) pending.push(value.dict);
      else if (value instanceof PDFDict)
        for (const [, child] of value.entries()) pending.push(child);
      else if (value instanceof PDFArray)
        for (const child of value.asArray()) pending.push(child);
    }
  }
  return references;
}
