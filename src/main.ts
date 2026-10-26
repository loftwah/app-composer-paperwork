import { validateConfiguration } from "./config.ts";
import { exportDocument } from "./export.ts";
import { lines } from "./text.ts";
import { PROPERTY_KEYS, type MetadataEdit } from "./metadata.ts";
import "./style.css";
import {
  openDocument,
  clone,
  LIMITS,
  type Addition,
  type Snapshot,
  type OpenDocument,
  type Point,
} from "./document";
import {
  centeredBox,
  circleDragBox,
  circleRadius,
  clampBox,
  defaultCirclePlacement,
  hitBounds,
  imagePlacement,
  inkVisualBounds,
  resizeBox,
  textPlacement,
  tickPlacement,
  tickPoints,
  tickVisualBounds,
  visualBounds,
  type Rect,
} from "./geometry.ts";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const button = (id: string) => $<HTMLButtonElement>(id);
const svgNS = "http://www.w3.org/2000/svg";
let doc: OpenDocument | undefined,
  state: Snapshot = { additions: [], values: {} },
  history: Snapshot[] = [],
  future: Snapshot[] = [];
let pageIndex = 0,
  zoom = 1,
  zoomMode: "fit" | "manual" = "fit",
  tool = "select",
  selected = "",
  dirty = false,
  busy = false,
  failed = false,
  printReady = false,
  renderGeneration = 0;
type SignatureStamp = {
  id: string;
  name: string;
  image: string;
  ratio: number;
  bytes: number;
};
let signatures: SignatureStamp[] = [],
  selectedSignature = "",
  signatureTrayOpen = false,
  previewPoint: Point | undefined;
let lastSaved = "",
  outputUrl = "",
  pendingOpen: (() => void) | undefined;
let fieldStart: Snapshot | undefined;
let focusedField = "";
let statusTimer: ReturnType<typeof setTimeout> | undefined;
type StatusOptions = {
  persistent?: boolean;
  action?: { label: string; href: string };
};
function status(text: string, error = false, options: StatusOptions = {}) {
  const node = $("status");
  node.replaceChildren(document.createTextNode(text));
  if (options.action) {
    const link = document.createElement("a");
    link.href = options.action.href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = options.action.label;
    link.className = "status-action";
    link.id = "print-fallback";
    node.append(" ", link);
  }
  node.classList.toggle("error", error);
  node.dataset.tone = error ? "error" : options.persistent ? "info" : "success";
  node.dataset.visible = "true";
  if (error) {
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "status-dismiss";
    dismiss.textContent = "Dismiss";
    dismiss.onclick = () => {
      node.textContent = "";
      node.dataset.tone = "";
      node.dataset.visible = "false";
    };
    node.append(" ", dismiss);
  }
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = undefined;
  if (!error && !options.persistent)
    statusTimer = setTimeout(() => {
      if (node.dataset.tone === "success") node.dataset.visible = "false";
    }, 8000);
}
const headerActions = document.querySelector<HTMLElement>(".header-actions")!;
const documentMenu = $("document-menu");
const propertiesDialog = $<HTMLDialogElement>("properties-dialog");
let clearOtherProperties = false;
let propertiesDocument: OpenDocument | undefined;
const compactActions = $("compact-actions");
const compactQuery = matchMedia("(max-width: 700px)");
const movableActions = [
  button("print"),
  document.querySelector<HTMLButtonElement>("[data-open-apps]")!,
  button("theme"),
];
let appsOpenedFromMenu = false;
const themeLabel = document.createElement("span");
themeLabel.className = "menu-control-label";
themeLabel.textContent = "Dark theme";
button("theme").append(themeLabel);
function syncActionPlacement() {
  for (const action of movableActions) {
    const parent = doc && compactQuery.matches ? compactActions : headerActions;
    if (action.parentElement === parent) continue;
    if (parent === compactActions) parent.append(action);
    else parent.insertBefore(action, button("more-actions"));
  }
}
compactQuery.addEventListener("change", syncActionPlacement);
for (const action of movableActions)
  action.addEventListener(
    "click",
    () => {
      if (!documentMenu.matches(":popover-open")) return;
      if (action.hasAttribute("data-open-apps") && compactQuery.matches)
        appsOpenedFromMenu = true;
      documentMenu.hidePopover();
    },
    { capture: true },
  );
$("app-navigation").addEventListener("close", () => {
  if (appsOpenedFromMenu) {
    appsOpenedFromMenu = false;
    button("more-actions").focus({ preventScroll: true });
  }
});
button("clear-field").addEventListener(
  "click",
  () => documentMenu.hidePopover(),
  { capture: true },
);
function syncChrome() {
  document.body.classList.toggle("has-document", !!doc);
  syncActionPlacement();
  for (const id of ["open", "start-open", "sample"]) button(id).disabled = busy;
  button("save").disabled = button("print").disabled = !doc || busy;
  button("properties").disabled = !doc || busy;
  button("save").textContent = busy && doc ? "Preparing…" : "Save PDF";
  const kind = busy
    ? "preparing"
    : failed
      ? "failed"
      : printReady
        ? "print"
        : dirty
          ? "changed"
          : lastSaved
            ? "downloaded"
            : "ready";
  const label = busy
    ? "Creating PDF…"
    : failed
      ? "Couldn’t finish — edits safe"
      : printReady
        ? "PDF ready to print"
        : dirty
          ? "Changes not downloaded"
          : lastSaved
            ? "PDF downloaded"
            : "Ready";
  const indicator = $("document-state");
  indicator.dataset.state = kind;
  const text = indicator.querySelector("span")!;
  if (text.textContent !== label) text.textContent = label;
  indicator.title =
    kind === "changed"
      ? "Your changes are still in this tab. Save PDF to download a copy."
      : kind === "downloaded"
        ? "A copy was downloaded. Later changes need another download."
        : kind === "print"
          ? "The completed PDF is prepared. A print dialog may still need your confirmation."
          : kind === "failed"
            ? "Your edits are still in this tab. Read the message below, then retry or save."
            : "";
}
const toolNames: Record<string, string> = {
  select: "Select",
  pen: "Pen",
  highlight: "Highlighter",
  eraser: "Eraser",
  text: "Text",
  tick: "Tick",
  circle: "Circle",
  image: "Signature stamp",
};
function syncToolChrome() {
  $("page").dataset.tool = tool;
  $("context-bar").hidden = tool === "select" && !selected && !focusedField;
  $("active-tool").textContent = toolNames[tool] || "Select";
  for (const el of document.querySelectorAll<HTMLButtonElement>("[data-tool]"))
    if (el.tagName === "BUTTON")
      el.setAttribute("aria-pressed", String(el.dataset.tool === tool));
  $("tool-hint").textContent = hints[tool] || hints.select;
  const stamp = signatures.find((s) => s.id === selectedSignature);
  $("stamp-state").hidden = tool !== "image" || !stamp;
  if (stamp) {
    $<HTMLImageElement>("stamp-thumb").src = stamp.image;
    $("stamp-name").textContent = stamp.name;
  }
}
function hasUnexportedEdits() {
  return (
    !!doc &&
    JSON.stringify(state) !== (lastSaved || JSON.stringify(doc.initial))
  );
}
function remember(snapshot = state) {
  history.push(clone(snapshot));
  if (history.length > 45) history.shift();
  future = [];
  dirty = true;
  revokeOutput();
  updateHistory();
}
function updateHistory() {
  const pendingField = !!fieldStart && dirty;
  for (const id of ["undo", "undo-mobile"]) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.disabled = !history.length && !pendingField;
  }
  for (const id of ["redo", "redo-mobile"]) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.disabled = !future.length || pendingField;
  }
}
function settleField() {
  if (!fieldStart) return;
  if (fieldStart && JSON.stringify(fieldStart) !== JSON.stringify(state))
    remember(fieldStart);
  fieldStart = undefined;
  dirty = hasUnexportedEdits();
  syncChrome();
  updateHistory();
}
function showPropertyDetails() {
  if (!doc) return;
  const details = $("property-details");
  details.replaceChildren();
  const rows = clearOtherProperties
    ? []
    : doc.metadata.details.filter(
        (row) => !state.metadata || !row.name.startsWith("XMP "),
      );
  for (const row of rows.slice(0, 100)) {
    const term = document.createElement("dt"),
      value = document.createElement("dd");
    term.textContent = row.name;
    value.textContent =
      row.value.length > 1024 ? row.value.slice(0, 1024) + "…" : row.value;
    details.append(term, value);
  }
  if (!rows.length) {
    const value = document.createElement("dd");
    value.textContent = clearOtherProperties
      ? "These properties will be cleared."
      : "No additional document properties.";
    details.append(value);
  }
  if (rows.length > 100) {
    const value = document.createElement("dd");
    value.textContent = `${rows.length - 100} additional properties. Clear properties removes these too.`;
    details.append(value);
  }
  $("property-xmp").textContent =
    doc.metadata.xmp && !state.metadata && !clearOtherProperties
      ? "Embedded XMP packet present. Applying changes removes it."
      : "No embedded XMP packet in the next export.";
}
function sizePropertyInput(input: HTMLTextAreaElement) {
  input.style.height = "auto";
  input.style.height = `${Math.min(132, Math.max(44, input.scrollHeight + 2))}px`;
}
for (const key of Object.keys(PROPERTY_KEYS)) {
  const input = $<HTMLTextAreaElement>(`property-${key}`);
  input.addEventListener("input", () => sizePropertyInput(input));
}
button("properties").onclick = () => {
  if (!doc || busy) return;
  settleField();
  documentMenu.hidePopover();
  const properties = state.metadata || doc.metadata.properties;
  clearOtherProperties = state.metadata?.clearOther ?? false;
  for (const key of Object.keys(
    PROPERTY_KEYS,
  ) as (keyof typeof PROPERTY_KEYS)[])
    $<HTMLTextAreaElement>(`property-${key}`).value = properties[key];
  $("properties-feedback").textContent = "";
  showPropertyDetails();
  propertiesDocument = doc;
  propertiesDialog.showModal();
  for (const key of Object.keys(PROPERTY_KEYS))
    sizePropertyInput($<HTMLTextAreaElement>(`property-${key}`));
};
button("clear-properties").onclick = () => {
  for (const key of Object.keys(PROPERTY_KEYS))
    $<HTMLTextAreaElement>(`property-${key}`).value = "";
  clearOtherProperties = true;
  showPropertyDetails();
  $("properties-feedback").textContent =
    "Creator, producer, dates and custom properties will also be cleared. Apply to confirm; Cancel keeps them. Page content and attachments stay unchanged.";
  for (const key of Object.keys(PROPERTY_KEYS))
    sizePropertyInput($<HTMLTextAreaElement>(`property-${key}`));
};
button("cancel-properties").onclick = () => propertiesDialog.close();
propertiesDialog.addEventListener("close", () => {
  propertiesDocument = undefined;
  button("more-actions").focus({ preventScroll: true });
});
$("properties-form").onsubmit = (event) => {
  event.preventDefault();
  if (!doc || doc !== propertiesDocument) {
    $("properties-feedback").textContent =
      "The document changed. Close properties and reopen them for the current file.";
    return;
  }
  const next = { clearOther: clearOtherProperties } as MetadataEdit;
  for (const key of Object.keys(
    PROPERTY_KEYS,
  ) as (keyof typeof PROPERTY_KEYS)[])
    next[key] = $<HTMLTextAreaElement>(`property-${key}`).value;
  const original = { ...doc.metadata.properties, clearOther: false };
  const unchanged =
    !next.clearOther &&
    Object.keys(PROPERTY_KEYS).every(
      (key) =>
        next[key as keyof typeof PROPERTY_KEYS] ===
        original[key as keyof typeof PROPERTY_KEYS],
    );
  const metadata = unchanged ? undefined : next;
  if (JSON.stringify(metadata) !== JSON.stringify(state.metadata)) {
    remember();
    if (metadata) state.metadata = metadata;
    else delete state.metadata;
    dirty = hasUnexportedEdits();
    syncChrome();
    updateHistory();
    status(
      "Document properties updated. Save PDF to include them. Undo restores the previous properties.",
    );
  }
  propertiesDialog.close();
};
function requestOpen(action: () => void) {
  if (propertiesDialog.open) {
    $("properties-feedback").textContent =
      "Apply or cancel document properties before opening another PDF.";
    return;
  }
  settleField();
  if (dirty) {
    pendingOpen = action;
    $<HTMLDialogElement>("replace-dialog").showModal();
  } else action();
}
button("cancel-replace").onclick = () =>
  $<HTMLDialogElement>("replace-dialog").close();
button("confirm-replace").onclick = () => {
  $<HTMLDialogElement>("replace-dialog").close();
  pendingOpen?.();
  pendingOpen = undefined;
};
for (const id of ["open", "start-open"])
  button(id).onclick = () =>
    requestOpen(() => $<HTMLInputElement>("pdf-file").click());
button("sample").onclick = () =>
  requestOpen(() => {
    void loadSample();
  });
$<HTMLInputElement>("pdf-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (file) await loadFile(file);
  input.value = "";
};
async function loadSample(lab = false) {
  try {
    const bytes = new Uint8Array(
      await (
        await fetch(
          lab ? "/examples/paperwork-lab.pdf" : "/examples/garden-form.pdf",
        )
      ).arrayBuffer(),
    );
    await load(bytes, lab ? "Paperwork Lab.pdf" : "Garden form.pdf");
  } catch {
    status("The sample could not load. Try opening a local PDF.", true);
  }
}
async function loadFile(file: File) {
  if (file.size > LIMITS.bytes)
    return status(
      "Choose a PDF smaller than 30 MB. Your current work is still here.",
      true,
    );
  await load(new Uint8Array(await file.arrayBuffer()), file.name);
}
async function load(bytes: Uint8Array, name: string) {
  if (busy) return;
  busy = true;
  syncChrome();
  status("Opening your PDF…");
  try {
    const next = await openDocument(bytes, name);
    const old = doc;
    doc = next;
    state = clone(next.initial);
    history = [];
    future = [];
    dirty = false;
    failed = false;
    selected = "";
    pageIndex = 0;
    lastSaved = "";
    zoomMode = "fit";
    revokeOutput();
    hidePreview();
    $("welcome").hidden = true;
    $("editor").hidden = false;
    $("filename").textContent = name;
    $("filename").title = name;
    button("save").disabled = false;
    button("print").disabled = false;
    $<HTMLSelectElement>("page-number").replaceChildren(
      ...next.viewports.map((_, i) => new Option(String(i + 1), String(i))),
    );
    $("page-count").textContent = `of ${next.viewports.length}`;
    fit();
    setTool("select");
    updateHistory();
    await renderPage();
    await old?.pdf.loadingTask.destroy();
    status(
      next.note ||
        `${next.viewports.length} pages ready. Fill a field or choose a tool.`,
    );
  } catch (e) {
    status(
      e instanceof Error
        ? e.message
        : "This PDF could not be opened. Your current work is still here.",
      true,
    );
  } finally {
    busy = false;
    syncChrome();
  }
}
function fit() {
  if (!doc) return;
  const viewport = doc.viewports[pageIndex];
  zoom = Math.min(
    1.5,
    Math.max(
      0.15,
      ($("workspace").clientWidth - (innerWidth < 700 ? 22 : 60)) /
        viewport.width,
    ),
  );
}
async function renderPage() {
  if (!doc) return;
  $("page").setAttribute("aria-busy", "true");
  $("page").inert = true;
  const generation = ++renderGeneration,
    source = doc,
    index = pageIndex,
    viewport = source.viewports[index],
    scale = zoom;
  $("page").style.width = `${viewport.width * scale}px`;
  $("page").style.height = `${viewport.height * scale}px`;
  $("page").setAttribute(
    "aria-label",
    `PDF page ${index + 1} of ${source.viewports.length}`,
  );
  $("zoom-label").textContent = `${Math.round(scale * 100)}%`;
  $<HTMLSelectElement>("page-number").value = String(index);
  button("previous").disabled = index === 0;
  button("next").disabled = index === source.viewports.length - 1;
  const pdfPage = await source.pdf.getPage(index + 1);
  if (generation !== renderGeneration) return;
  const density = Math.min(
    devicePixelRatio || 1,
    2,
    Math.sqrt(
      LIMITS.pixels / (viewport.width * viewport.height * scale * scale),
    ),
  );
  const canvas = document.createElement("canvas");
  const renderViewport = pdfPage.getViewport({ scale: scale * density });
  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);
  try {
    await pdfPage.render({
      canvas,
      viewport: renderViewport,
      annotationMode: 2,
    }).promise;
    if (generation !== renderGeneration) return;
    canvas.id = "canvas";
    $("canvas").replaceWith(canvas);
    renderFields();
    drawAdditions();
    $("page").inert = false;
    $("page").setAttribute("aria-busy", "false");
    $("page").dataset.rendered = String(index);
  } catch (e) {
    if (generation === renderGeneration)
      status(
        "This page could not render. Your edits are retained. Try another page or document.",
        true,
      );
  }
}
function renderFields() {
  const layer = $("fields");
  layer.replaceChildren();
  if (!doc) return;
  const viewport = doc.viewports[pageIndex];
  for (const widget of doc.widgets[pageIndex]) {
    const [x1, y1] = viewport.convertToViewportPoint(
        widget.rect[0],
        widget.rect[1],
      ),
      [x2, y2] = viewport.convertToViewportPoint(
        widget.rect[2],
        widget.rect[3],
      ),
      left = Math.min(x1, x2),
      top = Math.min(y1, y2),
      width = Math.abs(x2 - x1),
      height = Math.abs(y2 - y1);
    let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (widget.fieldType === "Ch") {
      const select = document.createElement("select");
      select.multiple = !!widget.multiSelect;
      if (!widget.combo) select.size = Math.max(2, Math.floor(height / 16));
      const values = state.values[widget.fieldName],
        current = Array.isArray(values) ? values : [String(values ?? "")];
      if (widget.combo && !current.length)
        select.add(new Option("Choose…", "", true, true));
      for (const option of widget.options || []) {
        const el = new Option(option.displayValue, option.exportValue);
        el.selected = current.includes(option.exportValue);
        select.add(el);
      }
      input = select;
    } else if (widget.fieldType === "Tx" && widget.multiLine) {
      input = document.createElement("textarea");
      input.value = String(state.values[widget.fieldName] || "");
      if (widget.maxLen) input.maxLength = widget.maxLen;
    } else {
      const el = document.createElement("input");
      el.type = widget.checkBox
        ? "checkbox"
        : widget.radioButton
          ? "radio"
          : "text";
      if (widget.checkBox) el.checked = !!state.values[widget.fieldName];
      else if (widget.radioButton) {
        el.name = widget.fieldName;
        el.value = widget.buttonValue || widget.exportValue || "";
        el.checked = state.values[widget.fieldName] === el.value;
      } else {
        el.value = String(state.values[widget.fieldName] || "");
        if (widget.maxLen) el.maxLength = widget.maxLen;
      }
      input = el;
    }
    const rotation =
        (((viewport.rotation + (widget.rotation || 0)) % 360) + 360) % 360,
      turned = rotation % 180 !== 0;
    const w = turned ? height : width,
      h = turned ? width : height;
    const transforms: Record<number, string> = {
      0: "",
      90: `translate(${width}px,0) rotate(90deg)`,
      180: `translate(${width}px,${height}px) rotate(180deg)`,
      270: `translate(0,${height}px) rotate(270deg)`,
    };
    Object.assign(input.style, {
      left: `${left * zoom}px`,
      top: `${top * zoom}px`,
      width: `${w}px`,
      height: `${h}px`,
      fontSize: `${widget.defaultAppearanceData?.fontSize || 12}px`,
      transformOrigin: "0 0",
      transform: `scale(${zoom}) ${transforms[rotation] || ""}`,
    });
    input.setAttribute(
      "aria-label",
      widget.fieldName.replace(/([A-Z])/g, " $1"),
    );
    input.dataset.field = widget.fieldName;
    input.disabled = !!widget.readOnly;
    if (widget.readOnly) input.style.background = "#fff";
    input.required = !!widget.required;
    input.onfocus = () => {
      focusedField = widget.fieldName;
      button("clear-field").hidden = !!widget.readOnly;
      button("clear-field-inline").hidden = !!widget.readOnly;
      button("clear-field-inline").dataset.clearField = widget.fieldName;
      if (!fieldStart) fieldStart = clone(state);
      selected = "";
      showSelection();
    };
    input.oninput = () => {
      if (!fieldStart) fieldStart = clone(state);
      if (input instanceof HTMLSelectElement)
        state.values[widget.fieldName] = Array.from(input.selectedOptions).map(
          (o) => o.value,
        );
      else if (widget.checkBox)
        state.values[widget.fieldName] = (input as HTMLInputElement).checked;
      else state.values[widget.fieldName] = input.value;
      dirty = true;
      revokeOutput();
      updateHistory();
      if (widget.radioButton || widget.checkBox)
        for (const peer of layer.querySelectorAll<HTMLInputElement>("input"))
          if (peer !== input && peer.dataset.field === widget.fieldName)
            peer.checked = widget.radioButton
              ? peer.value === input.value
              : (input as HTMLInputElement).checked;
    };
    input.onchange = () => {
      settleField();
    };
    input.onblur = () => {
      settleField();
    };
    layer.append(input);
  }
}
const hints: Record<string, string> = {
  select: "Fill a field. Select an addition to move, resize or restyle it.",
  pen: "Draw on the page. Select or Escape exits; two fingers zoom.",
  highlight: "Highlight with translucent ink. Select or Escape exits.",
  eraser:
    "Drag across your ink to erase it. Original PDF content stays intact.",
  text: "Click the page to add text. Done keeps Text active for the next one.",
  tick: "Click or press-drag-release to place a tick. Tick stays active.",
  circle:
    "Drag a clean circle, or click for a default ring. Circle stays active.",
  image:
    "Click or press-drag-release to stamp the chosen signature. Select to resize.",
};
function setTool(value: string) {
  finishText();
  focusedField = "";
  button("clear-field").hidden = true;
  button("clear-field-inline").hidden = true;
  settleField();
  hidePreview();
  tool = value;
  if (value !== "select") selected = "";
  if (value !== "image") closeSignatureTray();
  showSelection();
  syncToolChrome();
  drawAdditions();
}
for (const el of document.querySelectorAll<HTMLButtonElement>(
  "button[data-tool]",
))
  el.onclick = () => setTool(el.dataset.tool!);
function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, String(value));
  return node;
}
function itemRows(item: Addition): string[] {
  return item.kind === "text" && doc
    ? lines(item.text || "", item.w, item.size, doc.font)
    : [];
}
function itemBounds(item: Addition): Rect {
  return visualBounds(
    item,
    item.kind === "text" ? itemRows(item) : undefined,
    (text, size) => (doc ? doc.font.widthOfTextAtSize(text, size) : text.length * size * 0.5),
  );
}
function textHeight(item: Addition): number {
  return doc
    ? Math.max(
        item.size * 1.25,
        lines(item.text || "", item.w, item.size, doc.font).length *
          item.size *
          1.25,
      )
    : Math.max(item.size * 1.25, 18);
}
function drawAdditions(draft?: Addition) {
  if (!doc) return;
  const svg = $<HTMLElement>("additions") as unknown as SVGSVGElement,
    viewport = doc.viewports[pageIndex];
  svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
  svg.replaceChildren();
  for (const item of [...state.additions, ...(draft ? [draft] : [])].filter(
    (a) => a.page === pageIndex,
  )) {
    const kindName =
      item.kind === "image"
        ? "Signature"
        : item.kind === "circle"
          ? "Circle"
          : item.kind[0].toUpperCase() + item.kind.slice(1);
    const group = el("g", {
      "data-object": item.id,
      "data-kind": item.kind,
      tabindex: tool === "select" ? 0 : -1,
      role: "button",
      "aria-label": `${kindName} addition. Arrow keys move; Delete removes.`,
    });
    if (item.kind === "ink") {
      const p = item.points || [],
        points = p.map((point) => `${point.x},${point.y}`).join(" ");
      group.append(
        el("polyline", {
          points,
          stroke: item.color,
          "stroke-width": item.size,
          "stroke-opacity": item.opacity ?? 1,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          fill: "none",
        }),
        el("polyline", {
          points,
          stroke: "transparent",
          "stroke-width": Math.max(item.size, 28 / zoom),
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          fill: "none",
        }),
      );
    }
    if (item.kind === "image")
      group.append(
        el("image", {
          href: item.image || "",
          x: item.x,
          y: item.y,
          width: item.w,
          height: item.h,
          preserveAspectRatio: "none",
        }),
      );
    if (item.kind === "text" && item.text) {
      const text = el("text", { fill: item.color, "font-size": item.size });
      itemRows(item).forEach((line, i) => {
        const span = el("tspan", {
          x: item.x,
          y: item.y + item.size + i * item.size * 1.25,
        });
        span.textContent = line;
        text.append(span);
      });
      group.append(text);
    }
    if (item.kind === "tick") {
      group.append(
        el("polyline", {
          points: tickPoints(item)
            .map((point) => `${point.x},${point.y}`)
            .join(" "),
          stroke: item.color,
          "stroke-width": item.size,
          fill: "none",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      );
    }
    if (item.kind === "circle") {
      group.append(
        el("circle", {
          cx: item.x + item.w / 2,
          cy: item.y + item.h / 2,
          r: circleRadius(item),
          fill: "none",
          stroke: item.color,
          "stroke-width": item.size,
        }),
      );
    }
    // The visible outline is tight. Picking uses a separate, generous box.
    if (item.kind !== "ink") {
      const hit = hitBounds(itemBounds(item), 44 / zoom, 5 / zoom);
      group.append(
        el("rect", {
          x: hit.x,
          y: hit.y,
          width: hit.w,
          height: hit.h,
          fill: "transparent",
          stroke: "none",
        }),
      );
    }
    group.onpointerdown = (e) => beginMove(e, item);
    group.onkeydown = (e) => objectKey(e, item);
    group.ondblclick = (e) => {
      if (tool !== "select" || item.kind !== "text") return;
      e.preventDefault();
      selected = item.id;
      showSelection();
      drawAdditions();
      $<HTMLTextAreaElement>("text-content").focus();
    };
    svg.append(group);
    if (selected === item.id) {
      const b = itemBounds(item),
        pad = 4 / zoom,
        handleSize = 12 / zoom,
        hitSize = 44 / zoom,
        handle = el("g", {
          class: "handle",
          role: "button",
          tabindex: 0,
          "aria-label": "Resize selected addition. Use plus and minus keys.",
        });
      svg.append(
        el("rect", {
          class: "selection-outline",
          "data-page-space": JSON.stringify(b),
          x: b.x - pad,
          y: b.y - pad,
          width: b.w + pad * 2,
          height: b.h + pad * 2,
          fill: "none",
          stroke: "#c74400",
          "stroke-width": 1 / zoom,
          "stroke-dasharray": `${4 / zoom}`,
        }),
      );
      handle.append(
        el("rect", {
          x: b.x + b.w - hitSize / 2,
          y: b.y + b.h - hitSize / 2,
          width: hitSize,
          height: hitSize,
          fill: "transparent",
          stroke: "none",
        }),
        el("rect", {
          x: b.x + b.w - handleSize / 2,
          y: b.y + b.h - handleSize / 2,
          width: handleSize,
          height: handleSize,
          rx: 2 / zoom,
        }),
      );
      handle.onpointerdown = (e) => beginMove(e, item, true);
      handle.onkeydown = (e) => objectKey(e, item);
      if (item.kind !== "text") svg.append(handle);
    }
  }
  drawPreview();
}
function showSelection() {
  const item = state.additions.find((a) => a.id === selected),
    styleable =
      !!item &&
      item.kind !== "image" &&
      item.kind !== "text",
    textColor = item?.kind === "text";
  $("color-label").hidden = !(
    ["pen", "highlight", "tick", "circle"].includes(tool) ||
    styleable ||
    textColor
  );
  $("size-label").hidden = !(
    ["pen", "highlight", "tick", "circle"].includes(tool) || styleable
  );
  button("delete").hidden = !item;
  $("text-options").hidden = item?.kind !== "text";
  $("selection-hint").hidden = !item;
  if (item) {
    $<HTMLSelectElement>("color").value = item.color;
    if (item.kind !== "text")
      $<HTMLSelectElement>("size").value = String(item.size);
    $("selection-hint").textContent =
      item.kind === "text"
        ? "Type below. Wrap width controls line breaks; the outline follows the words. Delete removes it."
        : item.kind === "image"
          ? "Drag to move. Corner handle resizes proportionally. Delete removes it."
          : "Drag to move. Corner handle resizes. Delete removes it.";
  }
  if (item?.kind === "text") {
    $<HTMLTextAreaElement>("text-content").value = item.text || "";
    $<HTMLInputElement>("text-size").value = String(item.size);
    $<HTMLInputElement>("text-width").value = String(Math.round(item.w));
  }
  syncToolChrome();
}
function newItem(kind: Addition["kind"]): Addition {
  return {
    id: crypto.randomUUID(),
    page: pageIndex,
    kind,
    x: 0,
    y: 0,
    w: 25,
    h: 25,
    color: $<HTMLSelectElement>("color").value,
    size: kind === "text" ? 14 : Number($<HTMLSelectElement>("size").value),
  };
}
function placementFor(kind: Addition["kind"], point: Point): Addition | null {
  if (!doc) return null;
  const viewport = doc.viewports[pageIndex],
    item = newItem(kind);
  if (kind === "tick") {
    const box = tickPlacement(point, viewport.width, viewport.height);
    Object.assign(item, box);
  } else if (kind === "circle") {
    Object.assign(
      item,
      defaultCirclePlacement(point, viewport.width, viewport.height),
    );
  } else if (kind === "image") {
    const stamp = signatures.find((s) => s.id === selectedSignature);
    if (!stamp) return null;
    item.image = stamp.image;
    Object.assign(
      item,
      imagePlacement(point, stamp.ratio, viewport.width, viewport.height),
    );
  } else if (kind === "text") {
    Object.assign(
      item,
      textPlacement(point, viewport.width, viewport.height, item.size),
    );
    item.text = "";
  }
  return item;
}
function place(point: Point) {
  if (!doc || state.additions.length >= LIMITS.objects)
    return status(
      "This document has reached the limit of 3,000 additions. Save a completed copy before continuing.",
      true,
    );
  const kind = tool === "image" ? "image" : tool === "tick" ? "tick" : "text";
  if (kind === "image" && !signatures.some((s) => s.id === selectedSignature))
    return openSignatureTray();
  const item = placementFor(kind, point);
  if (!item) return;
  hidePreview();
  if (kind === "text") {
    const before = clone(state);
    state.additions.push(item);
    textDraft = { before, id: item.id };
    selected = item.id;
    showSelection();
    drawAdditions();
    $<HTMLTextAreaElement>("text-content").focus();
    return;
  }
  remember();
  state.additions.push(item);
  selected = "";
  showSelection();
  drawAdditions();
}
let textStart: Snapshot | undefined,
  textDraft: { before: Snapshot; id: string } | undefined;
function updateTextItem(item: Addition) {
  item.h = textHeight(item);
  if (doc) {
    const viewport = doc.viewports[pageIndex];
    if (item.w > viewport.width - item.x) item.w = viewport.width - item.x;
    if (item.h > viewport.height - item.y) item.h = viewport.height - item.y;
  }
}
function finishText() {
  const item = textDraft
    ? state.additions.find((a) => a.id === textDraft!.id)
    : state.additions.find((a) => a.id === selected);
  if (textDraft) {
    if (!item || !(item.text || "").trim()) {
      if (item) state.additions = state.additions.filter((a) => a !== item);
      if (selected === textDraft.id) selected = "";
      textDraft = undefined;
      textStart = undefined;
      dirty = hasUnexportedEdits();
      syncChrome();
      updateHistory();
      showSelection();
      drawAdditions();
      return;
    }
    const before = textDraft.before;
    textDraft = undefined;
    textStart = undefined;
    remember(before);
    updateTextItem(item);
  } else if (textStart) {
    if (JSON.stringify(textStart) !== JSON.stringify(state))
      remember(textStart);
    textStart = undefined;
    if (item?.kind === "text") updateTextItem(item);
  }
  selected = "";
  showSelection();
  drawAdditions();
}
$<HTMLTextAreaElement>("text-content").onfocus = () => {
  if (!textDraft && !textStart) textStart = clone(state);
};
$<HTMLTextAreaElement>("text-content").oninput = () => {
  const item = state.additions.find((a) => a.id === selected);
  if (!item || !doc) return;
  item.text = $<HTMLTextAreaElement>("text-content").value.slice(0, 10000);
  updateTextItem(item);
  if (item.text.trim()) {
    dirty = true;
    revokeOutput();
  }
  drawAdditions();
};
$<HTMLTextAreaElement>("text-content").onblur = () => {
  // Done and tool switches commit explicitly; blur is the fallback for a click
  // on the page or another control.
  if (textDraft || textStart) finishText();
};
$<HTMLInputElement>("text-size").onchange = () => {
  const item = state.additions.find((a) => a.id === selected);
  if (!item || !doc) return;
  remember();
  item.size = Math.min(
    72,
    Math.max(6, Number($<HTMLInputElement>("text-size").value) || 14),
  );
  updateTextItem(item);
  drawAdditions();
};
$<HTMLInputElement>("text-width").onchange = () => {
  const item = state.additions.find((a) => a.id === selected);
  if (!item || !doc || item.kind !== "text") return;
  remember();
  item.w = Math.min(
    doc.viewports[pageIndex].width - item.x,
    Math.max(40, Number($<HTMLInputElement>("text-width").value) || 190),
  );
  updateTextItem(item);
  drawAdditions();
};
button("finish-text").onclick = () => {
  finishText();
  $("page").focus();
};
$<HTMLTextAreaElement>("text-content").onkeydown = (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    finishText();
    setTool("select");
    $("page").focus();
  } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    finishText();
    $("page").focus();
  }
};
$<HTMLSelectElement>("color").onchange = () => {
  const item = state.additions.find((a) => a.id === selected);
  if (!item || item.kind === "image") return;
  remember();
  item.color = $<HTMLSelectElement>("color").value;
  drawAdditions();
};
$<HTMLSelectElement>("size").onchange = () => {
  const item = state.additions.find((a) => a.id === selected);
  if (!item || item.kind === "image") return;
  remember();
  item.size = Number($<HTMLSelectElement>("size").value);
  if (item.kind === "text") {
    updateTextItem(item);
    $<HTMLInputElement>("text-size").value = String(item.size);
  }
  drawAdditions();
};
function point(event: PointerEvent): Point {
  const rect = $("page").getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(
        (event.clientX - rect.left) / zoom,
        doc!.viewports[pageIndex].width,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        (event.clientY - rect.top) / zoom,
        doc!.viewports[pageIndex].height,
      ),
    ),
  };
}
let aiming:
    | { id: number; start: Point; tool: string; circle?: Rect }
    | undefined,
  previewCircle: Rect | undefined;
function hidePreview() {
  previewPoint = undefined;
  previewCircle = undefined;
  aiming = undefined;
  const svg = $<HTMLElement>("tool-preview") as unknown as SVGSVGElement;
  svg.replaceChildren();
}
function drawPreview() {
  if (!doc) return;
  const svg = $<HTMLElement>("tool-preview") as unknown as SVGSVGElement,
    viewport = doc.viewports[pageIndex];
  svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
  svg.replaceChildren();
  if (!previewPoint || busy || tool === "select" || textDraft) return;
  const p = previewPoint,
    ghost = el("g", {
      class: "preview-ghost",
      "aria-hidden": "true",
    });
  if (tool === "text") {
    const item = placementFor("text", p);
    if (!item) return;
    ghost.append(
      el("rect", {
        x: item.x,
        y: item.y,
        width: item.w,
        height: Math.max(item.size * 1.25, 20),
        fill: "none",
        stroke: item.color,
        "stroke-width": 1 / zoom,
        "stroke-dasharray": `${3 / zoom}`,
      }),
      el("line", {
        x1: item.x,
        y1: item.y + 1,
        x2: item.x,
        y2: item.y + item.size + 2,
        stroke: item.color,
        "stroke-width": 1.5 / zoom,
      }),
      el("text", {
        x: item.x + 5,
        y: item.y + item.size,
        fill: item.color,
        "font-size": item.size,
        "font-family": "Space, sans-serif",
      }),
    );
    ghost.lastElementChild!.textContent = "Text";
  } else if (tool === "tick") {
    const item = placementFor("tick", p);
    if (!item) return;
    ghost.append(
      el("polyline", {
        points: tickPoints(item)
          .map((point) => `${point.x},${point.y}`)
          .join(" "),
        stroke: item.color,
        "stroke-width": item.size,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );
  } else if (tool === "image") {
    const item = placementFor("image", p);
    if (!item) return;
    ghost.append(
      el("image", {
        href: item.image || "",
        x: item.x,
        y: item.y,
        width: item.w,
        height: item.h,
        preserveAspectRatio: "none",
      }),
    );
  } else if (tool === "circle") {
    const box =
      previewCircle ||
      defaultCirclePlacement(p, viewport.width, viewport.height);
    ghost.append(
      el("circle", {
        cx: box.x + box.w / 2,
        cy: box.y + box.h / 2,
        r: circleRadius({
          ...box,
          size: Number($<HTMLSelectElement>("size").value),
        }),
        fill: "none",
        stroke: $<HTMLSelectElement>("color").value,
        "stroke-width": $<HTMLSelectElement>("size").value,
      }),
    );
  } else if (["pen", "highlight", "eraser"].includes(tool)) {
    const eraser = tool === "eraser",
      size = eraser
        ? Math.max(14 / zoom, 8)
        : tool === "highlight"
          ? 16
          : Number($<HTMLSelectElement>("size").value),
      color = eraser
        ? "#68707c"
        : tool === "highlight"
          ? "#efb900"
          : $<HTMLSelectElement>("color").value;
    ghost.append(
      el("circle", {
        cx: p.x,
        cy: p.y,
        r: Math.max(2, size / 2),
        fill: eraser ? "none" : color,
        stroke: eraser ? color : "none",
        "stroke-width": eraser ? 1.5 / zoom : 0,
        "fill-opacity": tool === "highlight" ? 0.32 : 0.55,
        "stroke-dasharray": eraser ? `${3 / zoom}` : "",
      }),
    );
  }
  svg.append(ghost);
}
let gesture:
  | {
      id: number;
      start: Point;
      item?: Addition;
      before: Snapshot;
      resize?: boolean;
      moving?: Addition;
      moved?: boolean;
    }
  | undefined;
const pointers = new Map<number, Point>();
let pinch: { distance: number; zoom: number; ratio: number } | undefined;
function beginMove(event: PointerEvent, item: Addition, resize = false) {
  if (tool !== "select") return;
  event.preventDefault();
  event.stopPropagation();
  finishText();
  settleField();
  selected = item.id;
  showSelection();
  drawAdditions();
  gesture = {
    id: event.pointerId,
    start: point(event),
    moving: clone(item),
    before: clone(state),
    resize,
  };
  $("page").setPointerCapture(event.pointerId);
}
function bounds(item: Addition) {
  const p = item.points || [];
  if (p.length) {
    item.x = Math.min(...p.map((p) => p.x));
    item.y = Math.min(...p.map((p) => p.y));
    item.w = Math.max(3, Math.max(...p.map((p) => p.x)) - item.x);
    item.h = Math.max(3, Math.max(...p.map((p) => p.y)) - item.y);
  }
}
function erase(p: Point) {
  state.additions = state.additions.filter((item) => {
    if (item.page !== pageIndex || item.kind !== "ink") return true;
    const ps = item.points || [],
      radius = Math.max(7 / zoom, item.size / 2);
    return !ps.some((a, i) => {
      const b = ps[Math.max(0, i - 1)],
        dx = a.x - b.x,
        dy = a.y - b.y,
        length = dx * dx + dy * dy,
        t = length
          ? Math.max(
              0,
              Math.min(1, ((p.x - b.x) * dx + (p.y - b.y) * dy) / length),
            )
          : 0;
      return Math.hypot(p.x - b.x - dx * t, p.y - b.y - dy * t) < radius;
    });
  });
  drawAdditions();
}
$("page").onpointerdown = (event) => {
  if (!doc || busy) return;
  if (
    event.target instanceof HTMLElement &&
    /INPUT|TEXTAREA|SELECT|OPTION/.test(event.target.tagName)
  )
    return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2 && tool !== "select") {
    if (gesture) state = gesture.before;
    gesture = undefined;
    hidePreview();
    const [a, b] = [...pointers.values()];
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom, ratio: 1 };
    drawAdditions();
    return;
  }
  if (tool === "select") {
    selected = "";
    hidePreview();
    showSelection();
    drawAdditions();
    return;
  }
  event.preventDefault();
  const p = point(event);
  $("page").setPointerCapture(event.pointerId);
  if (["text", "tick", "image", "circle"].includes(tool)) {
    if (tool === "image" && !signatures.some((s) => s.id === selectedSignature))
      return openSignatureTray();
    aiming = { id: event.pointerId, start: p, tool };
    previewPoint = p;
    previewCircle =
      tool === "circle"
        ? defaultCirclePlacement(p, doc.viewports[pageIndex].width, doc.viewports[pageIndex].height)
        : undefined;
    drawPreview();
    return;
  }
  if (
    state.additions.length >= LIMITS.objects ||
    state.additions.reduce((n, a) => n + (a.points?.length || 0), 0) >=
      LIMITS.points
  )
    return status("Save a completed copy before adding more marks.", true);
  const item = newItem("ink");
  item.x = p.x;
  item.y = p.y;
  item.points = [p];
  if (tool === "highlight") {
    item.size = 16;
    item.color = "#efb900";
    item.opacity = 0.32;
  }
  gesture = {
    id: event.pointerId,
    start: p,
    item: tool === "eraser" ? undefined : item,
    before: clone(state),
  };
  if (tool === "eraser") erase(p);
};
$("page").onpointermove = (event) => {
  if (pointers.has(event.pointerId))
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch.ratio =
      Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.distance);
    return;
  }
  if (!doc) return;
  const p = point(event);
  if (aiming && aiming.id === event.pointerId) {
    previewPoint = p;
    if (aiming.tool === "circle") {
      const viewport = doc.viewports[pageIndex];
      previewCircle = circleDragBox(
        aiming.start,
        p,
        viewport.width,
        viewport.height,
      ) || undefined;
    }
    drawPreview();
    return;
  }
  if (!gesture) {
    if (tool !== "select" && event.pointerType !== "touch") {
      previewPoint = p;
      previewCircle = undefined;
      drawPreview();
    }
    return;
  }
  if (gesture.id !== event.pointerId) return;
  const dx = p.x - gesture.start.x,
    dy = p.y - gesture.start.y;
  if (gesture.moving) {
    const original = gesture.moving,
      item = state.additions.find((a) => a.id === original.id)!,
      viewport = doc.viewports[pageIndex];
    if (gesture.resize) {
      const box = resizeBox(
        item.kind,
        original,
        dx,
        dy,
        viewport.width,
        viewport.height,
      );
      item.w = box.w;
      item.h = box.h;
      if (item.kind === "text") updateTextItem(item);
      if (item.kind === "ink")
        item.points = original.points?.map((p) => ({
          x: item.x + ((p.x - original.x) * item.w) / original.w,
          y: item.y + ((p.y - original.y) * item.h) / original.h,
        }));
    } else {
      const bounds = item.kind === "text" ? itemBounds(item) : item;
      item.x = Math.max(
        0,
        Math.min(viewport.width - bounds.w, original.x + dx),
      );
      item.y = Math.max(
        0,
        Math.min(viewport.height - bounds.h, original.y + dy),
      );
      if (item.kind === "ink")
        item.points = original.points?.map((p) => ({
          x: p.x + item.x - original.x,
          y: p.y + item.y - original.y,
        }));
    }
    gesture.moved = true;
    drawAdditions();
  } else if (gesture.item) {
    const events = event.getCoalescedEvents?.() || [event];
    for (const e of events.length ? events : [event]) {
      const next = point(e),
        points = gesture.item.points!;
      if (
        points.length < 20000 &&
        Math.hypot(
          next.x - points[points.length - 1].x,
          next.y - points[points.length - 1].y,
        ) > 0.3
      )
        points.push(next);
    }
    bounds(gesture.item);
    drawAdditions(gesture.item);
  } else erase(p);
};
$("page").onpointerleave = () => {
  if (!aiming && !gesture) hidePreview();
};
function endGesture(event: PointerEvent, cancelled = false) {
  pointers.delete(event.pointerId);
  if (pinch) {
    if (pointers.size === 0) {
      zoom = Math.max(0.2, Math.min(3, pinch.zoom * pinch.ratio));
      zoomMode = "manual";
      pinch = undefined;
      hidePreview();
      void renderPage();
    }
    return;
  }
  if (aiming && aiming.id === event.pointerId) {
    const completed = aiming,
      p = previewPoint || completed.start;
    aiming = undefined;
    if (cancelled) {
      previewCircle = undefined;
      if (event.pointerType === "touch") hidePreview();
      else drawPreview();
      return;
    }
    if (completed.tool === "circle" && doc) {
      const viewport = doc.viewports[pageIndex],
        box =
          previewCircle ||
          defaultCirclePlacement(p, viewport.width, viewport.height),
        item = newItem("circle");
      Object.assign(item, box);
      previewCircle = undefined;
      remember();
      state.additions.push(item);
      selected = "";
      showSelection();
      hidePreview();
      drawAdditions();
      return;
    }
    previewCircle = undefined;
    place(p);
    hidePreview();
    drawAdditions();
    return;
  }
  if (!gesture || gesture.id !== event.pointerId) return;
  const completed = gesture;
  gesture = undefined;
  if (cancelled) state = completed.before;
  else if (completed.item) {
    if (completed.item.points!.length === 1)
      completed.item.points!.push({
        x: completed.item.x + 0.1,
        y: completed.item.y,
      });
    bounds(completed.item);
    remember(completed.before);
    state.additions.push(completed.item);
  } else if (JSON.stringify(completed.before) !== JSON.stringify(state))
    remember(completed.before);
  drawAdditions();
}
$("page").onpointerup = (e) => endGesture(e);
$("page").onpointercancel = (e) => endGesture(e, true);
function removeSelected() {
  if (!selected) return;
  if (textDraft && textDraft.id === selected) {
    state.additions = state.additions.filter((a) => a.id !== selected);
    textDraft = undefined;
    textStart = undefined;
    selected = "";
    dirty = hasUnexportedEdits();
    syncChrome();
    updateHistory();
    showSelection();
    drawAdditions();
    return;
  }
  remember();
  state.additions = state.additions.filter((a) => a.id !== selected);
  selected = "";
  showSelection();
  drawAdditions();
}
button("delete").onclick = removeSelected;
function clearField(field = focusedField) {
  if (!field || !doc) return;
  settleField();
  remember();
  const value = state.values[field];
  state.values[field] = Array.isArray(value)
    ? []
    : typeof value === "boolean"
      ? false
      : "";
  renderFields();
  const input = document.querySelector<HTMLElement>(
    `[data-field="${CSS.escape(field)}"]`,
  );
  input?.focus();
  status("Field cleared. Save PDF to include the change.");
}
button("clear-field").onclick = () => clearField();
button("clear-field-inline").onclick = () =>
  clearField(button("clear-field-inline").dataset.clearField || focusedField);
function objectKey(event: KeyboardEvent, item: Addition) {
  if (tool !== "select") return;
  selected = item.id;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeSelected();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    showSelection();
    if (item.kind === "text") $<HTMLTextAreaElement>("text-content").focus();
    return;
  }
  const movement: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (movement[event.key]) {
    event.preventDefault();
    remember();
    const [dx, dy] = movement[event.key],
      n = event.shiftKey ? 10 : 1,
      oldX = item.x,
      oldY = item.y,
      viewport = doc!.viewports[pageIndex];
    item.x = Math.max(0, Math.min(viewport.width - item.w, item.x + dx * n));
    item.y = Math.max(0, Math.min(viewport.height - item.h, item.y + dy * n));
    if (item.points)
      item.points = item.points.map((p) => ({
        x: p.x + item.x - oldX,
        y: p.y + item.y - oldY,
      }));
  }
  if (["+", "-", "="].includes(event.key)) {
    event.preventDefault();
    remember();
    const factor = event.key === "-" ? 0.9 : 1.1,
      viewport = doc!.viewports[pageIndex],
      box = resizeBox(
        item.kind,
        item,
        item.w * (factor - 1),
        item.h * (factor - 1),
        viewport.width,
        viewport.height,
      );
    const sx = box.w / item.w,
      sy = box.h / item.h;
    item.w = box.w;
    item.h = box.h;
    if (item.kind === "text") updateTextItem(item);
    if (item.points)
      item.points = item.points.map((p) => ({
        x: item.x + (p.x - item.x) * sx,
        y: item.y + (p.y - item.y) * sy,
      }));
  }
  showSelection();
  drawAdditions();
  document
    .querySelector<SVGGElement>(`[data-object="${CSS.escape(item.id)}"]`)
    ?.focus();
}
$("page").onkeydown = (event) => {
  if (
    event.target === $("page") &&
    event.key === "Enter" &&
    ["text", "tick", "image"].includes(tool) &&
    doc
  ) {
    event.preventDefault();
    const viewport = doc.viewports[pageIndex];
    place({ x: viewport.width * 0.3, y: viewport.height * 0.3 });
  }
};
function undo() {
  settleField();
  const previous = history.pop();
  if (!previous) return;
  future.push(clone(state));
  state = previous;
  dirty = hasUnexportedEdits();
  revokeOutput();
  selected = "";
  renderFields();
  drawAdditions();
  showSelection();
  updateHistory();
}
function redo() {
  settleField();
  const next = future.pop();
  if (!next) return;
  history.push(clone(state));
  state = next;
  dirty = hasUnexportedEdits();
  revokeOutput();
  selected = "";
  renderFields();
  drawAdditions();
  showSelection();
  updateHistory();
}
button("undo").onclick = undo;
button("redo").onclick = redo;
// Keep history visible beside Open/Save on narrow screens, without another row.
const mobileHistory = document.createElement("div");
mobileHistory.className = "mobile-history";
for (const [id, action] of [
  ["undo", undo],
  ["redo", redo],
] as const) {
  const copy = button(id).cloneNode(true) as HTMLButtonElement;
  copy.id = `${id}-mobile`;
  copy.onclick = action;
  mobileHistory.append(copy);
}
headerActions.insertBefore(mobileHistory, button("more-actions"));
const MAX_SIGNATURES = 6,
  MAX_SIGNATURE_MEMORY = 20 * 1024 * 1024;
function closeSignatureTray() {
  signatureTrayOpen = false;
  $("signature-tray").hidden = true;
  button("signature").setAttribute("aria-expanded", "false");
}
function renderSignatureTray() {
  const list = $("signature-list");
  list.replaceChildren();
  signatures.forEach((stamp, index) => {
    const item = document.createElement("li"),
      choose = document.createElement("button"),
      remove = document.createElement("button");
    choose.type = "button";
    choose.className = "stamp-option";
    choose.setAttribute(
      "aria-pressed",
      String(stamp.id === selectedSignature),
    );
    choose.title = `${stamp.name} — click to stamp`;
    choose.onclick = () => {
      selectedSignature = stamp.id;
      renderSignatureTray();
      setTool("image");
      syncToolChrome();
      status(
        `${stamp.name} selected. Click or press-drag-release on the page to stamp; choose Select to resize.`,
      );
    };
    const image = document.createElement("img");
    image.src = stamp.image;
    image.alt = "";
    const label = document.createElement("span");
    label.textContent = stamp.name;
    choose.append(image, label);
    remove.type = "button";
    remove.className = "stamp-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${stamp.name} from the tray`);
    remove.onclick = () => {
      if (selectedSignature === stamp.id)
        selectedSignature = signatures[index + 1]?.id || signatures[index - 1]?.id || "";
      signatures = signatures.filter((s) => s.id !== stamp.id);
      renderSignatureTray();
      if (!signatures.length && tool === "image") setTool("select");
      syncToolChrome();
      status(
        "Removed from the tray. Stamps already placed on the page are unchanged.",
      );
    };
    item.append(choose, remove);
    list.append(item);
  });
  const empty = $("signature-empty");
  empty.hidden = signatures.length > 0;
  $("signature-count").textContent = `${signatures.length} of ${MAX_SIGNATURES}`;
}
function openSignatureTray() {
  if (!signatures.length) {
    $<HTMLInputElement>("signature-file").click();
    return;
  }
  if (!selectedSignature) selectedSignature = signatures[0].id;
  setTool("image");
  signatureTrayOpen = true;
  $("signature-tray").hidden = false;
  button("signature").setAttribute("aria-expanded", "true");
  renderSignatureTray();
  syncToolChrome();
  document.querySelector<HTMLButtonElement>(".stamp-option")?.focus();
}
button("signature").onclick = () => {
  if (signatureTrayOpen) closeSignatureTray();
  else openSignatureTray();
};
button("add-signature").onclick = () =>
  $<HTMLInputElement>("signature-file").click();
button("close-signature-tray").onclick = () => {
  closeSignatureTray();
  button("signature").focus();
};
function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error("The PNG could not be read."));
    reader.readAsDataURL(blob);
  });
}
async function trimmedSignature(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("This browser could not read the PNG.");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let left = bitmap.width,
      top = bitmap.height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < bitmap.height; y++)
      for (let x = 0; x < bitmap.width; x++)
        if (data[(y * bitmap.width + x) * 4 + 3] > 0) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
    if (right < left || bottom < top)
      throw Error("That PNG is fully transparent. Choose a visible signature.");
    const width = right - left + 1,
      height = bottom - top + 1;
    if (width === bitmap.width && height === bitmap.height)
      return { image: await readAsDataUrl(file), ratio: width / height };
    const cropped = document.createElement("canvas");
    cropped.width = width;
    cropped.height = height;
    cropped
      .getContext("2d")
      ?.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      cropped.toBlob(resolve, "image/png"),
    );
    if (!blob) throw Error("The PNG could not be prepared.");
    return { image: await readAsDataUrl(blob), ratio: width / height };
  } finally {
    bitmap.close();
  }
}
$<HTMLInputElement>("signature-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > LIMITS.signature)
    return status("Choose a PNG signature smaller than 5 MB.", true);
  if (signatures.length >= MAX_SIGNATURES)
    return status(
      `The tray holds ${MAX_SIGNATURES} signatures. Remove one before adding another.`,
      true,
    );
  if (
    signatures.reduce((total, stamp) => total + stamp.bytes, 0) + file.size >
    MAX_SIGNATURE_MEMORY
  )
    return status(
      "The signature tray is full. Remove a signature before adding another.",
      true,
    );
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
      throw Error("Choose a PNG image for your signature.");
    const view = new DataView(bytes.buffer),
      w = view.getUint32(16),
      h = view.getUint32(20);
    if (!w || !h || w * h > 8_000_000 || w > 8192 || h > 8192)
      throw Error("Use a PNG signature up to 8 million pixels.");
    const trimmed = await trimmedSignature(file);
    const stamp: SignatureStamp = {
      id: crypto.randomUUID(),
      name: `Signature ${signatures.length + 1}`,
      image: trimmed.image,
      ratio: trimmed.ratio,
      bytes: file.size,
    };
    signatures.push(stamp);
    selectedSignature = stamp.id;
    renderSignatureTray();
    setTool("image");
    signatureTrayOpen = true;
    $("signature-tray").hidden = false;
    button("signature").setAttribute("aria-expanded", "true");
    syncToolChrome();
    status(
      "Signature added. Click or press-drag-release on the page to stamp it; the tray keeps it for this tab only.",
    );
  } catch (e) {
    status(
      e instanceof Error ? e.message : "The signature could not be opened.",
      true,
    );
  }
};
function changePage(index: number) {
  if (!doc) return;
  finishText();
  focusedField = "";
  button("clear-field").hidden = true;
  button("clear-field-inline").hidden = true;
  settleField();
  pageIndex = Math.max(0, Math.min(doc.viewports.length - 1, index));
  selected = "";
  hidePreview();
  showSelection();
  if (zoomMode === "fit") fit();
  void renderPage();
  $("workspace").scrollTo(0, 0);
}
button("previous").onclick = () => changePage(pageIndex - 1);
button("next").onclick = () => changePage(pageIndex + 1);
$<HTMLSelectElement>("page-number").onchange = () =>
  changePage(Number($<HTMLSelectElement>("page-number").value));
function setZoom(value: number) {
  if (!doc) return;
  settleField();
  zoomMode = "manual";
  zoom = Math.max(0.15, Math.min(3, value));
  hidePreview();
  void renderPage();
}
button("zoom-in").onclick = () => setZoom(zoom * 1.2);
button("zoom-out").onclick = () => setZoom(zoom / 1.2);
button("fit").onclick = () => {
  zoomMode = "fit";
  fit();
  hidePreview();
  void renderPage();
};
function revokeOutput() {
  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = "";
  }
  document.getElementById("print-frame")?.remove();
  if (printReady) {
    printReady = false;
    const node = $("status");
    if (node.dataset.tone === "info") {
      node.textContent = "";
      node.dataset.tone = "";
      node.dataset.visible = "false";
    }
  }
  syncChrome();
}
async function save(print = false) {
  if (!doc || busy) return;
  finishText();
  (document.activeElement as HTMLElement)?.blur();
  settleField();
  busy = true;
  failed = false;
  syncChrome();
  button("save").disabled = button("print").disabled = true;
  status(
    print
      ? "Creating the completed PDF for printing…"
      : "Creating your completed PDF…",
    false,
    { persistent: true },
  );
  try {
    const exportingDocument = doc,
      snapshot = clone(state),
      bytes = await exportDocument(exportingDocument, snapshot);
    if (
      doc !== exportingDocument ||
      JSON.stringify(state) !== JSON.stringify(snapshot)
    )
      throw Error(
        "Your edits changed while the PDF was being prepared. Save or print again to include the latest changes. Your edits are still here.",
      );
    revokeOutput();
    outputUrl = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: "application/pdf" }),
    );
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = doc.name.replace(/\.pdf$/i, "") + "-completed.pdf";
    if (print) {
      const frame = document.createElement("iframe");
      frame.id = "print-frame";
      frame.title = "Completed PDF for printing";
      frame.style.cssText =
        "position:fixed;width:1px;height:1px;right:0;bottom:0;border:0";
      frame.onload = () => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {}
      };
      frame.src = outputUrl;
      document.body.append(frame);
      printReady = true;
      dirty = hasUnexportedEdits();
      status(
        "Completed PDF prepared for printing. If no print dialog appears, open it and use your browser’s Print action. Paperwork cannot confirm that a printer produced a page.",
        false,
        {
          persistent: true,
          action: outputUrl
            ? { label: "Open completed PDF to print", href: outputUrl }
            : undefined,
        },
      );
    } else {
      a.click();
      lastSaved = JSON.stringify(snapshot);
      dirty = JSON.stringify(state) !== lastSaved;
      printReady = false;
      status(
        "PDF downloaded. Your edits remain in this tab; later changes need another download.",
      );
    }
  } catch (e) {
    revokeOutput();
    failed = true;
    status(
      e instanceof Error
        ? e.message
        : "The completed PDF could not be saved. Your edits are still here.",
      true,
    );
  } finally {
    busy = false;
    button("save").disabled = button("print").disabled = false;
    syncChrome();
  }
}
button("save").onclick = () => {
  void save();
};
button("print").onclick = () => {
  void save(true);
};
button("theme").onclick = () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  button("theme").setAttribute("aria-pressed", String(dark));
};
window.onbeforeunload = (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
};
window.addEventListener("keydown", (event) => {
  if (propertiesDialog.open) {
    if (
      (event.ctrlKey || event.metaKey) &&
      ["s", "p"].includes(event.key.toLowerCase())
    )
      event.preventDefault();
    return;
  }
  if (
    document.querySelector<HTMLDialogElement>("#app-navigation")?.open ||
    (event.target instanceof Element && event.target.closest("#app-navigation"))
  )
    return;
  const target = event.target as HTMLElement,
    editing = /INPUT|TEXTAREA|SELECT/.test(target.tagName);
  const shortcuts = $("shortcuts");
  if (event.key === "?" && !editing && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    shortcuts.togglePopover();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void save();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
    event.preventDefault();
    void save(true);
    return;
  }
  if (
    (shortcuts.matches(":popover-open") &&
      (event.key === "Escape" || shortcuts.contains(target))) ||
    (documentMenu.matches(":popover-open") &&
      (event.key === "Escape" || documentMenu.contains(target)))
  )
    return;
  if (editing) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (event.key === "Escape") {
    if (signatureTrayOpen) {
      closeSignatureTray();
      button("signature").focus();
      return;
    }
    selected = "";
    setTool("select");
    return;
  }
  if (!doc) return;
  const tools: Record<string, string> = {
    v: "select",
    p: "pen",
    e: "eraser",
    t: "text",
    k: "tick",
    c: "circle",
    h: "highlight",
  };
  if (tools[event.key.toLowerCase()] && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    setTool(tools[event.key.toLowerCase()]);
  }
  if (event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey)
    openSignatureTray();
  if ((event.key === "Delete" || event.key === "Backspace") && selected) {
    event.preventDefault();
    removeSelected();
  }
});
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    e.preventDefault();
    if (propertiesDialog.open) return;
    dragDepth++;
    document.body.classList.add("dragging");
  }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) document.body.classList.remove("dragging");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const file = e.dataTransfer?.files[0];
  if (file)
    requestOpen(() => {
      void loadFile(file);
    });
});
async function boot() {
  try {
    const response = await fetch("/paperwork.json");
    if (!response.ok) throw Error("configuration unavailable");
    const text = await response.text();
    if (text.length > 2048) throw Error("configuration too large");
    const config = validateConfiguration(JSON.parse(text));
    const mark = document.querySelector<HTMLAnchorElement>(".wordmark")!;
    $("app-title").textContent = config.title;
    mark.title = config.title;
    mark.setAttribute("aria-label", `${config.title} home`);
    document.title =
      config.title + " — Fill, sign and edit PDFs in your browser";
    document.querySelector(".start > p")!.textContent = config.intro;
    document.documentElement.dataset.theme =
      config.theme === "daylight" ? "light" : "dark";
    button("theme").setAttribute(
      "aria-pressed",
      String(config.theme === "midnight"),
    );
  } catch {
    status("Using the default editor settings.");
  }
  const sample = new URL(location.href).searchParams.get("sample");
  if (["garden", "lab"].includes(sample || ""))
    void loadSample(sample === "lab");
}
void boot();
