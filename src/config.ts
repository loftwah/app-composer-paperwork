export const defaults = {
  version: 1 as const,
  title: "Paperwork",
  intro: "Fill the fields. Write on the page. Add your signature.",
  theme: "midnight" as "midnight" | "daylight",
};
export function validateConfiguration(value: unknown): typeof defaults {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Choose a Paperwork configuration object.");
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 ||
    Object.keys(v).some(
      (k) => !["version", "title", "intro", "theme"].includes(k),
    )
  )
    throw Error("Unsupported Paperwork configuration version or field.");
  if (
    typeof v.title !== "string" ||
    !v.title.trim() ||
    v.title.length > 80 ||
    typeof v.intro !== "string" ||
    v.intro.length > 240 ||
    /[\x00-\x1f\x7f]/.test(v.title + v.intro) ||
    !["midnight", "daylight"].includes(String(v.theme))
  )
    throw Error(
      "Use a title up to 80 characters, introduction up to 240 and a supported theme.",
    );
  return {
    version: 1,
    title: v.title.trim(),
    intro: v.intro,
    theme: v.theme as "midnight" | "daylight",
  };
}
