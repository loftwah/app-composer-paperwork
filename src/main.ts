import { validateConfiguration } from "./config.ts";
import { exportDocument } from "./export.ts";
import { lines } from "./text.ts";
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
  tool = "select",
  selected = "",
  dirty = false,
  busy = false,
  renderGeneration = 0;
let signature: { image: string; ratio: number } | undefined,
  lastSaved = "",
  outputUrl = "",
  pendingOpen: (() => void) | undefined;
let fieldStart: Snapshot | undefined;
let focusedField = "";
let statusTimer: ReturnType<typeof setTimeout> | undefined;
const status = (text: string, error = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
  $("status").dataset.visible =
    error || !/^\d+ pages ready\./.test(text) ? "true" : "false";
  if (statusTimer) clearTimeout(statusTimer);
  if (!error)
    statusTimer = setTimeout(() => {
      $("status").dataset.visible = "false";
    }, 5000);
};
const headerActions = document.querySelector<HTMLElement>(".header-actions")!;
const documentMenu = $("document-menu");
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
for (const id of ["reuse", "clear-field"])
  button(id).addEventListener("click", () => documentMenu.hidePopover(), {
    capture: true,
  });
function syncChrome() {
  document.body.classList.toggle("has-document", !!doc);
  syncActionPlacement();
  for (const id of ["open", "start-open", "sample"]) button(id).disabled = busy;
  button("save").disabled = button("print").disabled = !doc || busy;
  button("save").textContent = busy && doc ? "Preparing…" : "Save PDF";
  const kind = busy
    ? "preparing"
    : dirty
      ? "changed"
      : lastSaved
        ? "exported"
        : "ready";
  const label = busy
    ? "Preparing PDF…"
    : dirty
      ? "Unsaved changes"
      : lastSaved
        ? "Exported"
        : "Ready to edit";
  const indicator = $("document-state");
  indicator.dataset.state = kind;
  const text = indicator.querySelector("span")!;
  if (text.textContent !== label) text.textContent = label;
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
function requestOpen(action: () => void) {
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
    selected = "";
    signature = undefined;
    pageIndex = 0;
    lastSaved = "";
    revokeOutput();
    $("welcome").hidden = true;
    $("editor").hidden = false;
    $("filename").textContent = name;
    $("filename").title = name;
    button("save").disabled = false;
    button("print").disabled = false;
    button("reuse").hidden = true;
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
        `${next.viewports.length} pages ready. Fill the fields, or choose a tool to write on the page.`,
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
  select: "Fill a field. Select an addition to move, resize or delete it.",
  pen: "Draw on the page. Choose Select to scroll; two fingers zoom.",
  highlight: "Highlight with translucent ink. Choose Select to scroll.",
  eraser:
    "Drag across your ink to erase it. Original PDF content stays intact.",
  text: "Tap the page to add text. Select existing text to change it.",
  tick: "Tap the page to place a tick.",
  image: "Tap the page to place your signature. Then drag or resize it.",
};
function setTool(value: string) {
  focusedField = "";
  button("clear-field").hidden = true;
  settleField();
  tool = value;
  $("page").dataset.tool = tool;
  for (const el of document.querySelectorAll<HTMLButtonElement>("[data-tool]"))
    if (el.tagName === "BUTTON")
      el.setAttribute("aria-pressed", String(el.dataset.tool === tool));
  $("tool-hint").textContent = hints[value];
  if (doc && !busy) status(hints[value]);
  if (value !== "select") selected = "";
  showSelection();
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
function drawAdditions(draft?: Addition) {
  if (!doc) return;
  const svg = $<HTMLElement>("additions") as unknown as SVGSVGElement,
    viewport = doc.viewports[pageIndex];
  svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
  svg.replaceChildren();
  for (const item of [...state.additions, ...(draft ? [draft] : [])].filter(
    (a) => a.page === pageIndex,
  )) {
    const group = el("g", {
      "data-object": item.id,
      tabindex: tool === "select" ? 0 : -1,
      role: "button",
      "aria-label": `${item.kind === "image" ? "Signature" : item.kind} addition. Arrow keys move; Delete removes.`,
    });
    if (item.kind === "ink") {
      const p = item.points || [];
      group.append(
        el("polyline", {
          points: p.map((p) => `${p.x},${p.y}`).join(" "),
          stroke: item.color,
          "stroke-width": item.size,
          "stroke-opacity": item.opacity ?? 1,
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
        }),
      );
    if (item.kind === "text") {
      const text = el("text", { fill: item.color, "font-size": item.size });
      lines(item.text || "", item.w, item.size, doc.font).forEach((line, i) => {
        const span = el("tspan", {
          x: item.x,
          y: item.y + item.size + i * item.size * 1.25,
        });
        span.textContent = line;
        text.append(span);
      });
      group.append(text);
    }
    if (item.kind === "tick")
      group.append(
        el("polyline", {
          points: `${item.x + item.w * 0.12},${item.y + item.h * 0.52} ${item.x + item.w * 0.4},${item.y + item.h * 0.82} ${item.x + item.w * 0.9},${item.y + item.h * 0.14}`,
          stroke: item.color,
          "stroke-width": item.size,
          fill: "none",
          "stroke-linecap": "round",
        }),
      );
    // Transparent hit area makes text, ticks and signatures easy to pick up.
    if (item.kind !== "ink")
      group.append(
        el("rect", {
          x: item.x,
          y: item.y,
          width: item.w,
          height: item.h,
          fill: "transparent",
          stroke: "none",
        }),
      );
    group.onpointerdown = (e) => beginMove(e, item);
    group.onkeydown = (e) => objectKey(e, item);
    svg.append(group);
    if (selected === item.id) {
      svg.append(
        el("rect", {
          x: item.x - 3,
          y: item.y - 3,
          width: item.w + 6,
          height: item.h + 6,
          fill: "none",
          stroke: "#c74400",
          "stroke-width": 1 / zoom,
          "stroke-dasharray": `${4 / zoom}`,
        }),
      );
      const handleSize = 16 / zoom,
        hitSize = (item.kind === "image" ? 44 : 24) / zoom,
        handle = el("g", {
          class: "handle",
          role: "button",
          tabindex: 0,
          "aria-label": "Resize selected addition. Use plus and minus keys.",
        });
      handle.append(
        el("rect", {
          x: item.x + item.w - hitSize / 2,
          y: item.y + item.h - hitSize / 2,
          width: hitSize,
          height: hitSize,
          fill: "transparent",
          stroke: "none",
        }),
        el("rect", {
          x: item.x + item.w - handleSize / 2,
          y: item.y + item.h - handleSize / 2,
          width: handleSize,
          height: handleSize,
          rx: 2 / zoom,
        }),
      );
      handle.onpointerdown = (e) => beginMove(e, item, true);
      handle.onkeydown = (e) => objectKey(e, item);
      svg.append(handle);
    }
  }
}
function showSelection() {
  $("color-label").hidden = !["pen", "highlight", "text", "tick"].includes(
    tool,
  );
  $("size-label").hidden = !["pen", "highlight", "tick"].includes(tool);
  const item = state.additions.find((a) => a.id === selected);
  button("delete").hidden = !item;
  $("text-options").hidden = item?.kind !== "text";
  if (item?.kind === "text") {
    $<HTMLTextAreaElement>("text-content").value = item.text || "";
    $<HTMLInputElement>("text-size").value = String(item.size);
  }
}
function newItem(kind: Addition["kind"], point: Point): Addition {
  return {
    id: crypto.randomUUID(),
    page: pageIndex,
    kind,
    x: point.x,
    y: point.y,
    w: kind === "text" ? 190 : 25,
    h: kind === "text" ? 50 : 25,
    color: $<HTMLSelectElement>("color").value,
    size: kind === "text" ? 14 : Number($<HTMLSelectElement>("size").value),
  };
}
function place(point: Point) {
  if (!doc || state.additions.length >= LIMITS.objects)
    return status(
      "This document has reached the limit of 3,000 additions. Save a completed copy before continuing.",
      true,
    );
  const item = newItem(
    tool === "image" ? "image" : tool === "tick" ? "tick" : "text",
    point,
  );
  if (item.kind === "image" && signature) {
    item.image = signature.image;
    item.w = Math.min(
      180,
      doc.viewports[pageIndex].width * 0.45,
      doc.viewports[pageIndex].height * 0.3 * signature.ratio,
    );
    item.h = item.w / signature.ratio;
  }
  if (item.kind === "text") item.text = "";
  const viewport = doc.viewports[pageIndex];
  item.w = Math.min(item.w, viewport.width);
  item.x = Math.max(0, Math.min(item.x, viewport.width - item.w));
  item.y = Math.max(0, Math.min(item.y, viewport.height - item.h));
  remember();
  state.additions.push(item);
  selected = item.id;
  setTool("select");
  showSelection();
  drawAdditions();
  if (item.kind === "text") $<HTMLTextAreaElement>("text-content").focus();
}
let textStart: Snapshot | undefined;
$<HTMLTextAreaElement>("text-content").onfocus = () => {
  textStart = clone(state);
};
$<HTMLTextAreaElement>("text-content").oninput = () => {
  const item = state.additions.find((a) => a.id === selected);
  if (!item || !doc) return;
  item.text = $<HTMLTextAreaElement>("text-content").value.slice(0, 10000);
  item.h = Math.max(
    30,
    lines(item.text, item.w, item.size, doc.font).length * item.size * 1.25 + 4,
  );
  dirty = true;
  revokeOutput();
  drawAdditions();
};
$<HTMLTextAreaElement>("text-content").onblur = () => {
  if (textStart && JSON.stringify(textStart) !== JSON.stringify(state))
    remember(textStart);
  textStart = undefined;
};
$<HTMLInputElement>("text-size").onchange = () => {
  const item = state.additions.find((a) => a.id === selected);
  if (!item || !doc) return;
  remember();
  item.size = Math.min(
    72,
    Math.max(6, Number($<HTMLInputElement>("text-size").value) || 14),
  );
  item.h = Math.max(
    30,
    lines(item.text || "", item.w, item.size, doc.font).length *
      item.size *
      1.25 +
      4,
  );
  drawAdditions();
};
button("finish-text").onclick = () => {
  selected = "";
  showSelection();
  drawAdditions();
  $("page").focus();
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
  if (pointers.size === 2 && ["pen", "highlight", "eraser"].includes(tool)) {
    if (gesture) state = gesture.before;
    gesture = undefined;
    const [a, b] = [...pointers.values()];
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom, ratio: 1 };
    drawAdditions();
    return;
  }
  if (tool === "select") {
    selected = "";
    showSelection();
    drawAdditions();
    return;
  }
  event.preventDefault();
  const p = point(event);
  $("page").setPointerCapture(event.pointerId);
  if (["text", "tick", "image"].includes(tool)) {
    place(p);
    return;
  }
  if (
    state.additions.length >= LIMITS.objects ||
    state.additions.reduce((n, a) => n + (a.points?.length || 0), 0) >=
      LIMITS.points
  )
    return status("Save a completed copy before adding more marks.", true);
  const item = newItem("ink", p);
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
  if (!gesture || gesture.id !== event.pointerId || !doc) return;
  const p = point(event),
    dx = p.x - gesture.start.x,
    dy = p.y - gesture.start.y;
  if (gesture.moving) {
    const original = gesture.moving,
      item = state.additions.find((a) => a.id === original.id)!;
    const viewport = doc.viewports[pageIndex];
    if (gesture.resize) {
      const ratio = original.w / original.h;
      const maxWidth = Math.min(
        viewport.width - item.x,
        item.kind === "image" || item.kind === "tick"
          ? (viewport.height - item.y) * ratio
          : viewport.width,
      );
      item.w = Math.max(
        Math.min(12, maxWidth),
        Math.min(maxWidth, original.w + dx),
      );
      item.h =
        item.kind === "image" || item.kind === "tick"
          ? item.w / ratio
          : Math.max(12, original.h + dy);
      if (item.kind === "ink")
        item.points = original.points?.map((p) => ({
          x: item.x + ((p.x - original.x) * item.w) / original.w,
          y: item.y + ((p.y - original.y) * item.h) / original.h,
        }));
    } else {
      item.x = Math.max(0, Math.min(viewport.width - item.w, original.x + dx));
      item.y = Math.max(0, Math.min(viewport.height - item.h, original.y + dy));
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
function endGesture(event: PointerEvent, cancelled = false) {
  pointers.delete(event.pointerId);
  if (pinch) {
    if (pointers.size === 0) {
      zoom = Math.max(0.2, Math.min(3, pinch.zoom * pinch.ratio));
      pinch = undefined;
      void renderPage();
    }
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
  remember();
  state.additions = state.additions.filter((a) => a.id !== selected);
  selected = "";
  showSelection();
  drawAdditions();
}
button("delete").onclick = removeSelected;
button("clear-field").onclick = () => {
  if (!focusedField) return;
  settleField();
  remember();
  const value = state.values[focusedField];
  state.values[focusedField] = Array.isArray(value)
    ? []
    : typeof value === "boolean"
      ? false
      : "";
  renderFields();
};
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
    const factor = event.key === "-" ? 0.9 : 1.1;
    item.w *= factor;
    item.h *= factor;
    if (item.points)
      item.points = item.points.map((p) => ({
        x: item.x + (p.x - item.x) * factor,
        y: item.y + (p.y - item.y) * factor,
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
button("signature").onclick = () =>
  $<HTMLInputElement>("signature-file").click();
button("reuse").onclick = () => setTool("image");
$<HTMLInputElement>("signature-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > LIMITS.signature)
    return status("Choose a PNG signature smaller than 5 MB.", true);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
      throw Error("Choose a PNG image for your signature.");
    const view = new DataView(bytes.buffer),
      w = view.getUint32(16),
      h = view.getUint32(20);
    if (!w || !h || w * h > 8_000_000 || w > 8192 || h > 8192)
      throw Error("Use a PNG signature up to 8 million pixels.");
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    const reader = new FileReader();
    const image = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(Error("The PNG could not be read."));
      reader.readAsDataURL(file);
    });
    signature = { image, ratio: w / h };
    button("reuse").hidden = false;
    setTool("image");
    status("Signature ready. Tap the page to place it, then drag or resize.");
  } catch (e) {
    status(
      e instanceof Error ? e.message : "The signature could not be opened.",
      true,
    );
  }
};
function changePage(index: number) {
  if (!doc) return;
  focusedField = "";
  button("clear-field").hidden = true;
  settleField();
  pageIndex = Math.max(0, Math.min(doc.viewports.length - 1, index));
  selected = "";
  showSelection();
  fit();
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
  zoom = Math.max(0.2, Math.min(3, value));
  void renderPage();
}
button("zoom-in").onclick = () => setZoom(zoom * 1.2);
button("zoom-out").onclick = () => setZoom(zoom / 1.2);
button("fit").onclick = () => {
  fit();
  void renderPage();
};
function revokeOutput() {
  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = "";
  }
  document.getElementById("print-frame")?.remove();
  document.getElementById("print-fallback")?.remove();
  syncChrome();
}
async function save(print = false) {
  if (!doc || busy) return;
  (document.activeElement as HTMLElement)?.blur();
  settleField();
  busy = true;
  syncChrome();
  button("save").disabled = button("print").disabled = true;
  status(
    print
      ? "Preparing your completed PDF for printing…"
      : "Preparing your completed PDF…",
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
      const fallback = document.createElement("a");
      fallback.id = "print-fallback";
      fallback.href = outputUrl;
      fallback.target = "_blank";
      fallback.textContent = "Open the completed PDF to print";
      fallback.style.cssText =
        "display:inline-flex;min-height:44px;align-items:center;margin-left:28px";
      $("status").after(fallback);
      status(
        "Your completed PDF is ready. If no print dialog appears, open it below and use your browser’s Print action.",
      );
    } else {
      a.click();
      lastSaved = JSON.stringify(snapshot);
      dirty = JSON.stringify(state) !== lastSaved;
      status("PDF downloaded. You can keep editing here.");
    }
  } catch (e) {
    revokeOutput();
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
    h: "highlight",
  };
  if (tools[event.key.toLowerCase()] && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    setTool(tools[event.key.toLowerCase()]);
  }
  if (event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey)
    button("signature").click();
  if ((event.key === "Delete" || event.key === "Backspace") && selected) {
    event.preventDefault();
    removeSelected();
  }
});
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    e.preventDefault();
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
