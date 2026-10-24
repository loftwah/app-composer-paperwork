import type { OpenDocument } from "./document.ts";
export function safeText(text: string, font: OpenDocument["font"]) {
  const characters = new Set(font.getCharacterSet());
  if (
    [...text].some(
      (c) =>
        c !== "\n" &&
        c !== "\r" &&
        c !== "\t" &&
        !characters.has(c.codePointAt(0)!),
    )
  )
    throw Error(
      "This text includes a character our bundled font cannot save. Change that character; your edits are still here.",
    );
}
export function lines(
  text: string,
  width: number,
  size: number,
  font: OpenDocument["font"],
): string[] {
  const result: string[] = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const c of paragraph) {
      if (line && font.widthOfTextAtSize(line + c, size) > width) {
        result.push(line);
        line = "";
      }
      line += c;
    }
    result.push(line);
  }
  return result;
}
