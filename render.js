// Draws a Daftari screen from its saved design and runs it: the same rules as the Android app's
// preview (component properties, data actions, search). It knows nothing about Firebase: data
// goes through a "store" with headers, rows(), append(), update(), delete().

// ---- Property defaults (mirror of PropertySchema in the Android app) ----

const COMMON = {
  backgroundColor: "#FFFFFFFF", borderColor: "#FF82978B", borderWidth: "1", cornerRadius: "8",
  opacity: "100", padding: "8", elevation: "0", shadowColor: "#66000000", borderStyle: "solid",
  gradient: "false", backgroundColor2: "#FF1E7145", gradientDirection: "vertical", rotation: "0",
  fontSize: "14", textColor: "#FF183328", fontWeight: "normal", textAlign: "start",
  fontFamily: "default", italic: "false", underline: "false", letterSpacing: "0", lineHeight: "0",
  textShadow: "none", visible: "true", enabled: "true", column: "", action: "",
};

const BY_TYPE = {
  BUTTON: { textColor: "#FFFFFFFF", textAlign: "center", backgroundColor: "#FF20B879", borderWidth: "0" },
  TEXT_FIELD: { hint: "اكتب هنا", hintColor: "#FF8A9A92", inputType: "text", maxLength: "0", readOnly: "false", required: "false" },
  LABEL: { fontSize: "16", backgroundColor: "#00FFFFFF", borderWidth: "0", maxLines: "0" },
  DROPDOWN: { items: "خيار 1\nخيار 2\nخيار 3", selectedIndex: "-1", hint: "اختر" },
  TABLE: {
    fontSize: "12", columns: "العمود 1,العمود 2,العمود 3", rows: "3", headerColor: "#FF20B879",
    headerTextColor: "#FFFFFFFF", showGrid: "true", gridColor: "#FFC8D3CD", striped: "false",
    tableOrientation: "horizontal", cellAlign: "center", rowHeight: "0", minColumnWidth: "0",
    rowNumbers: "false", dataSource: "",
  },
  DATE_PICKER: { dateFormat: "yyyy/MM/dd", calendar: "gregorian", defaultToday: "true" },
  CHECKBOX: { backgroundColor: "#00FFFFFF", borderWidth: "0", checked: "false", checkColor: "#FF20B879", boxPosition: "start" },
};

const INPUT_TYPES = new Set(["TEXT_FIELD", "DROPDOWN", "DATE_PICKER", "CHECKBOX"]);
const TRUTHY = new Set(["true", "yes", "نعم", "1", "✓", "✔", "صح"]);

export function prop(c, key) {
  if (key === "text") return c.text || "";
  const p = c.properties || {};
  if (key in p) return p[key];
  const typed = BY_TYPE[c.type] || {};
  if (key in typed) return typed[key];
  return COMMON[key] ?? "";
}
const num = (c, k) => parseFloat(prop(c, k)) || 0;
const bool = (c, k) => prop(c, k) === "true";

/** "#AARRGGBB" or "#RRGGBB" to a CSS color. */
export function cssColor(hex) {
  const h = (hex || "").replace("#", "");
  if (h.length === 6) return "#" + h;
  if (h.length !== 8) return "transparent";
  const a = parseInt(h.slice(0, 2), 16) / 255;
  const r = parseInt(h.slice(2, 4), 16), g = parseInt(h.slice(4, 6), 16), b = parseInt(h.slice(6, 8), 16);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/** Lower case, trimmed, single spaces, Arabic-Indic digits as Western ones (same as the app). */
export function normalize(text) {
  return String(text ?? "").trim().toLowerCase()
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\s+/g, " ");
}

/** First data row number (Excel numbering, after `after`) matching every filled criterion. */
export function search(rows, criteria, after = 1) {
  const wanted = Object.entries(criteria).filter(([, v]) => String(v).trim() !== "").map(([k, v]) => [Number(k), normalize(v)]);
  if (!wanted.length) return null;
  for (let n = after + 1; n <= rows.length; n++) {
    const row = rows[n - 1] || [];
    if (!row.length) continue;
    if (wanted.every(([col, v]) => normalize(row[col] ?? "") === v)) return n;
  }
  return null;
}

// ---- Calculations (same rules as Formula.kt): + - * / ( ), 15%, names bare or in [brackets] ----

const toWestern = s => String(s ?? "").replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0)).replace(/\u066B/g, ".");

export function evaluateFormula(expression, valueOf) {
  const src = toWestern(expression).replace(/×/g, "*").replace(/÷/g, "/").replace(/٪/g, "%");
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++; const n = Number(src.slice(i, j)); if (Number.isNaN(n)) return null; tokens.push({ n }); i = j; continue; }
    if (c === "[") { const j = src.indexOf("]", i); if (j < 0) return null; tokens.push({ name: src.slice(i + 1, j).trim() }); i = j + 1; continue; }
    if (/[\p{L}_]/u.test(c)) { let j = i; while (j < src.length && /[\p{L}\p{Nd}_]/u.test(src[j])) j++; tokens.push({ name: src.slice(i, j) }); i = j; continue; }
    if ("+-*/()%".includes(c)) { tokens.push({ op: c }); i++; continue; }
    return null;
  }
  if (!tokens.length) return null;
  let pos = 0;
  const peek = () => tokens[pos]?.op;
  const num = v => { const n = parseFloat(toWestern(v)); return Number.isFinite(n) ? n : 0; };
  function expr() { let v = term(); for (;;) { if (peek() === "+") { pos++; v += term(); } else if (peek() === "-") { pos++; v -= term(); } else return v; } }
  function term() { let v = factor(); for (;;) { if (peek() === "*") { pos++; v *= factor(); } else if (peek() === "/") { pos++; v /= factor(); } else return v; } }
  function factor() {
    const tk = tokens[pos++];
    if (!tk) throw 0;
    let v;
    if ("n" in tk) v = tk.n;
    else if ("name" in tk) v = num(valueOf(tk.name));
    else if (tk.op === "-") v = -factor();
    else if (tk.op === "+") v = factor();
    else if (tk.op === "(") { v = expr(); if (peek() !== ")") throw 0; pos++; }
    else throw 0;
    if (peek() === "%") { pos++; v /= 100; }
    return v;
  }
  try { const v = expr(); return pos === tokens.length && Number.isFinite(v) ? v : null; } catch (e) { return null; }
}

export function formatNumber(v) {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Results of a screen's formulas by component id (formulas may use other formulas). */
export function computeFormulas(screen, valueOf) {
  const formulas = screen.components.filter(c => (c.type === "TEXT_FIELD" || c.type === "LABEL") && prop(c, "formula").trim());
  const byName = Object.fromEntries(screen.components.map(c => [normalize(c.name), c]));
  const results = {};
  for (let pass = 0; pass < Math.min(formulas.length, 5); pass++) {
    for (const c of formulas) {
      const v = evaluateFormula(prop(c, "formula"), name => {
        const other = byName[normalize(name)];
        return other ? (results[other.id] ?? valueOf(other)) : "";
      });
      results[c.id] = v == null ? "؟" : formatNumber(v);
    }
  }
  return results;
}

/** Column index of each input bound to a header, like FormLogic.bindings. */
export function bindings(screen, headers) {
  const out = [];
  for (const c of screen.components) {
    if (!INPUT_TYPES.has(c.type)) continue;
    const column = prop(c, "column");
    const index = headers.findIndex(h => normalize(h) === normalize(column));
    if (column && index >= 0) out.push([c, index]);
  }
  return out;
}

// ---- Dates (Gregorian or Umm al-Qura Hijri) ----

export function formatDate(c, date, lang) {
  const pattern = prop(c, "dateFormat");
  const hijri = prop(c, "calendar") === "hijri";
  const locale = (lang === "en" ? "en" : "ar") + "-u-" + (hijri ? "ca-islamic-umalqura-" : "") + "nu-latn";
  const parts = {};
  try {
    for (const p of new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).formatToParts(date)) parts[p.type] = p.value;
    parts.monthName = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(date);
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
  const year = (parts.year || "").replace(/\D/g, "");
  const month = parts.month, day = parts.day;
  switch (pattern) {
    case "dd/MM/yyyy": return `${day}/${month}/${year}`;
    case "MM/dd/yyyy": return `${month}/${day}/${year}`;
    case "d MMMM yyyy": return `${Number(day)} ${parts.monthName} ${year}`;
    default: return `${year}/${month}/${day}`;
  }
}

function today() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function startValue(c, lang) {
  switch (c.type) {
    case "TEXT_FIELD": return c.text || "";
    case "DROPDOWN": {
      const items = prop(c, "items").split("\n").filter(s => s.trim());
      return items[Math.trunc(num(c, "selectedIndex"))] ?? "";
    }
    case "DATE_PICKER": return bool(c, "defaultToday") ? formatDate(c, today(), lang) : "";
    case "CHECKBOX": return prop(c, "checked");
    default: return "";
  }
}

// ---- Styling ----

const WEIGHTS = { light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, black: 900 };
const FAMILIES = { sans: "sans-serif", serif: "serif", mono: "monospace", cursive: "cursive" };

function textStyle(c) {
  const size = num(c, "fontSize");
  const legacyBold = (c.properties || {}).bold === "true" && !("fontWeight" in (c.properties || {}));
  const lineHeight = num(c, "lineHeight");
  const shadow = { soft: "0 2px 4px rgba(0,0,0,.33)", strong: "1px 3px 6px rgba(0,0,0,.66)" }[prop(c, "textShadow")];
  return {
    color: cssColor(prop(c, "textColor")),
    fontSize: size + "px",
    fontWeight: legacyBold ? 700 : (WEIGHTS[prop(c, "fontWeight")] || 400),
    fontStyle: bool(c, "italic") ? "italic" : "normal",
    fontFamily: FAMILIES[prop(c, "fontFamily")] || "inherit",
    letterSpacing: num(c, "letterSpacing") + "px",
    lineHeight: lineHeight > 0 ? String(lineHeight) : "normal",
    textDecoration: bool(c, "underline") ? "underline" : "none",
    textAlign: { center: "center", end: "end" }[prop(c, "textAlign")] || "start",
    textShadow: shadow || "none",
  };
}

function chrome(c) {
  const first = cssColor(prop(c, "backgroundColor"));
  let background = first;
  if (bool(c, "gradient")) {
    const second = cssColor(prop(c, "backgroundColor2"));
    const dir = { horizontal: "to right", diagonal: "to bottom right" }[prop(c, "gradientDirection")] || "to bottom";
    background = `linear-gradient(${dir}, ${first}, ${second})`;
  }
  const bw = num(c, "borderWidth"), elevation = num(c, "elevation");
  const opacity = num(c, "opacity") / 100 * (bool(c, "enabled") ? 1 : 0.5);
  return {
    background,
    border: bw > 0 ? `${bw}px ${prop(c, "borderStyle") || "solid"} ${cssColor(prop(c, "borderColor"))}` : "none",
    borderRadius: num(c, "cornerRadius") + "px",
    boxShadow: elevation > 0 ? `0 ${elevation / 2}px ${elevation}px ${cssColor(prop(c, "shadowColor"))}` : "none",
    opacity: String(opacity),
    padding: num(c, "padding") + "px",
    boxSizing: "border-box",
    overflow: "hidden",
  };
}

function h(tag, style = {}, attrs = {}, ...children) {
  const el = document.createElement(tag);
  Object.assign(el.style, style);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) if (child != null) el.append(child);
  return el;
}

const justify = align => ({ center: "center", end: "flex-end" }[align] || "flex-start");

// ---- Runner ----

/**
 * Renders `screen` of `project` into `root` and wires its buttons to `store`.
 * opts: { lang, t(ar,en), toast(msg), confirm(msg) -> Promise<bool> }
 */
export function runScreen(root, project, screen, store, opts) {
  const { lang, t, toast } = opts;
  const headers = store ? store.headers : [];
  const binds = bindings(screen, headers);
  // Typed values are shared by all screens of the app, so they survive moving between screens.
  const values = opts.values || {};
  for (const c of screen.components) if (INPUT_TYPES.has(c.type) && !(c.id in values)) values[c.id] = startValue(c, lang);
  let computed = {};
  const formulaShown = {}; // component id -> function(text) for calculated fields
  const recompute = () => {
    computed = computeFormulas(screen, c => (c.type === "LABEL" ? c.text : values[c.id] ?? ""));
    for (const [id, show] of Object.entries(formulaShown)) show(computed[id] ?? "");
  };
  const state = { currentRow: null, lastCriteria: null, filledSnapshot: null, sheetRows: null, working: false };
  const inputs = {}; // component id -> function(value) updating its element
  const tables = [];

  const toExcel = c => {
    const v = computed[c.id] ?? values[c.id] ?? "";
    return c.type === "CHECKBOX" ? (v === "true" ? t("نعم", "Yes") : t("لا", "No")) : v;
  };
  const formValues = () => Object.fromEntries(binds.map(([c, col]) => [col, toExcel(c)]));
  const sameForm = (a, b) => a && b && JSON.stringify(a) === JSON.stringify(b);
  const setValue = (c, v) => { values[c.id] = v; inputs[c.id]?.(v); recompute(); };
  const fill = row => {
    for (const [c, col] of binds) {
      const cell = row[col] ?? "";
      setValue(c, c.type === "CHECKBOX" ? String(TRUTHY.has(normalize(cell))) : cell);
    }
  };
  const clearForm = () => {
    for (const c of screen.components) if (INPUT_TYPES.has(c.type)) setValue(c, startValue(c, lang));
    state.currentRow = null; state.filledSnapshot = null;
  };
  const missingRequired = () => binds
    .filter(([c]) => c.type === "TEXT_FIELD" && bool(c, "required") && !(values[c.id] || "").trim())
    .map(([c, col]) => headers[col] || c.name);

  async function reloadTables() {
    if (!store || !tables.length) return;
    try { state.sheetRows = await store.rows(); tables.forEach(draw => draw()); } catch (e) { toast(opts.errorText(e)); }
  }

  async function perform(action, target) {
    if (!action) return;
    if (action === "clear") return clearForm();
    if (action === "openScreen") return opts.openScreen ? opts.openScreen(target) : null;
    if (action === "back") return opts.back ? opts.back() : null;
    if (!store) return toast(t("هذا التطبيق غير مرتبط ببيانات.", "This app has no data source."));
    if (!binds.length) return toast(t("لا يوجد حقل مرتبط بعمود.", "No field is linked to a column."));
    if (state.working) return;
    state.working = true;
    try {
      if (action === "addRow") {
        const missing = missingRequired();
        if (missing.length) return toast(t("املأ الحقول المطلوبة: ", "Fill in the required fields: ") + missing.join("، "));
        const form = formValues();
        if (Object.values(form).every(v => !String(v).trim())) return toast(t("الحقول فارغة.", "The fields are empty."));
        const row = await store.append(form);
        clearForm();
        toast(t(`تمت إضافة الصف رقم ${row} ✓`, `Row ${row} added ✓`));
      } else if (action === "search") {
        const form = formValues();
        const again = state.currentRow != null && sameForm(form, state.filledSnapshot) && state.lastCriteria;
        const criteria = again ? state.lastCriteria : Object.fromEntries(Object.entries(form).filter(([, v]) => String(v).trim()));
        if (!Object.keys(criteria).length) return toast(t("اكتب قيمة في حقل أو أكثر ثم اضغط بحث.", "Type a value in one or more fields, then search."));
        const rows = await store.rows();
        state.sheetRows = rows;
        const found = search(rows, criteria, again ? state.currentRow : 1) ?? (again ? search(rows, criteria) : null);
        if (found == null) toast(t("لا توجد نتيجة مطابقة.", "No matching row."));
        else {
          fill(rows[found - 1]);
          state.currentRow = found; state.lastCriteria = criteria; state.filledSnapshot = formValues();
          toast(t(`وُجد في الصف ${found}. اضغط بحث مرة أخرى للنتيجة التالية.`, `Found in row ${found}. Search again for the next match.`));
        }
      } else if (action === "updateRow") {
        const row = state.currentRow;
        if (row == null) return toast(t("ابحث عن الصف أولًا ثم عدّله.", "Search for the row first, then edit it."));
        const missing = missingRequired();
        if (missing.length) return toast(t("املأ الحقول المطلوبة: ", "Fill in the required fields: ") + missing.join("، "));
        await store.update(row, formValues());
        state.filledSnapshot = formValues();
        toast(t(`تم حفظ التعديل على الصف ${row} ✓`, `Row ${row} updated ✓`));
      } else if (action === "deleteRow") {
        const row = state.currentRow;
        if (row == null) return toast(t("ابحث عن الصف أولًا ثم احذفه.", "Search for the row first, then delete it."));
        if (!(await opts.confirm(t(`حذف الصف ${row}؟ تصعد الصفوف التي بعده.`, `Delete row ${row}? The rows below move up.`)))) return;
        await store.delete(row);
        clearForm();
        toast(t(`تم حذف الصف ${row}`, `Row ${row} deleted`));
      }
      await reloadTables();
    } catch (e) {
      toast(opts.errorText(e));
    } finally {
      state.working = false;
    }
  }

  // Page size: the project frame, turned for landscape screens.
  const f = project.frame || { width: 360, height: 800 };
  const landscape = (screen.properties || {}).orientation === "landscape";
  const pageW = landscape ? Math.max(f.width, f.height) : Math.min(f.width, f.height);
  const pageH = landscape ? Math.min(f.width, f.height) : Math.max(f.width, f.height);

  // Positions are physical (left/top) in both languages, so the page itself is laid out left-to-right.
  const page = h("div", { position: "absolute", left: "0", top: "0", width: pageW + "px", height: pageH + "px", transformOrigin: "top left" }, { dir: "ltr" });
  const holder = h("div", { position: "relative", margin: "0 auto" }, { dir: "ltr" }, page);
  root.replaceChildren(holder);
  const fit = () => {
    // Shrink to fit narrow screens; grow at most 15% on wide ones, like the app.
    const scale = Math.min(root.clientWidth / pageW, 1.15);
    page.style.transform = `scale(${scale})`;
    holder.style.width = pageW * scale + "px";
    holder.style.height = pageH * scale + "px";
  };
  fit();
  window.addEventListener("resize", fit);

  for (const c of [...screen.components].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))) {
    if (!bool(c, "visible")) continue;
    // Inside a component, text and controls follow the reading direction (right-to-left in Arabic).
    const box = h("div", {
      position: "absolute", left: c.x + "px", top: c.y + "px", width: c.width + "px", height: c.height + "px",
      transform: `rotate(${num(c, "rotation")}deg)`,
    }, { dir: lang === "en" ? "ltr" : "rtl" });
    box.append(drawComponent(c));
    page.append(box);
  }

  function drawComponent(c) {
    const style = textStyle(c);
    const enabled = bool(c, "enabled");
    const frame = (extra = {}) => h("div", { ...chrome(c), width: "100%", height: "100%", display: "flex", alignItems: "center", ...extra });
    switch (c.type) {
      case "LABEL": {
        const max = Math.trunc(num(c, "maxLines"));
        const el = frame({ justifyContent: justify(prop(c, "textAlign")) });
        const text = h("div", { ...style, width: "100%", whiteSpace: "pre-wrap", ...(max > 0 ? { display: "-webkit-box", WebkitLineClamp: String(max), WebkitBoxOrient: "vertical", overflow: "hidden" } : {}) }, { dir: "auto" }, c.text);
        if (prop(c, "formula").trim()) formulaShown[c.id] = v => { text.textContent = v; };
        el.append(text);
        return el;
      }
      case "BUTTON": {
        const el = h("button", { ...chrome(c), ...style, width: "100%", height: "100%", cursor: enabled ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: justify(prop(c, "textAlign")) },
          { disabled: !enabled, onclick: () => perform(prop(c, "action"), prop(c, "targetScreen")) }, c.text);
        return el;
      }
      case "TEXT_FIELD": {
        const type = prop(c, "inputType");
        const multiline = type === "multiline";
        const required = bool(c, "required");
        const attrs = {
          placeholder: prop(c, "hint") + (required ? " *" : ""),
          maxlength: num(c, "maxLength") > 0 ? Math.trunc(num(c, "maxLength")) : null,
          readonly: bool(c, "readOnly") || !!prop(c, "formula").trim(), disabled: !enabled,
          type: { password: "password", email: "email", phone: "tel" }[type] || "text",
          inputmode: { number: "numeric", decimal: "decimal", phone: "tel", email: "email" }[type] || null,
          oninput: e => { values[c.id] = e.target.value; recompute(); },
        };
        const input = h(multiline ? "textarea" : "input",
          { ...style, width: "100%", height: "100%", border: "none", outline: "none", background: "transparent", resize: "none", padding: "0", fontFamily: style.fontFamily },
          attrs);
        input.value = values[c.id];
        inputs[c.id] = v => { input.value = v; };
        if (prop(c, "formula").trim()) formulaShown[c.id] = v => { input.value = v; };
        const el = frame({ alignItems: multiline ? "flex-start" : "center" });
        el.style.setProperty("--hint", cssColor(prop(c, "hintColor")));
        input.classList.add("hinted");
        el.append(input);
        return el;
      }
      case "DROPDOWN": {
        const items = prop(c, "items").split("\n").filter(s => s.trim());
        const select = h("select", { ...style, width: "100%", height: "100%", border: "none", background: "transparent", outline: "none" },
          { disabled: !enabled, onchange: e => { values[c.id] = e.target.value; recompute(); } },
          h("option", {}, { value: "" }, prop(c, "hint")),
          items.map(item => h("option", {}, { value: item }, item)));
        const sync = v => {
          if (v && !items.includes(v)) select.append(h("option", {}, { value: v }, v));
          select.value = v;
        };
        sync(values[c.id]);
        inputs[c.id] = sync;
        const el = frame();
        el.append(select);
        return el;
      }
      case "DATE_PICKER": {
        const label = h("span", { ...style, flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, { dir: "auto" });
        const show = v => { label.textContent = v || prop(c, "dateFormat"); label.style.opacity = v ? "1" : ".55"; };
        show(values[c.id]);
        inputs[c.id] = show;
        const picker = h("input", { position: "absolute", inset: "0", opacity: "0", width: "100%", height: "100%", cursor: "pointer" }, {
          type: "date", disabled: !enabled,
          onchange: e => {
            if (!e.target.value) return;
            const [y, m, d] = e.target.value.split("-").map(Number);
            values[c.id] = formatDate(c, new Date(Date.UTC(y, m - 1, d)), lang);
            show(values[c.id]);
          },
        });
        const el = frame({ position: "relative", gap: "6px" });
        el.append(label, h("span", { ...style, flex: "0" }, {}, "📅"), picker);
        return el;
      }
      case "CHECKBOX": {
        const box = h("input", { width: "20px", height: "20px", accentColor: cssColor(prop(c, "checkColor")), flex: "0 0 auto", margin: "0" },
          { type: "checkbox", disabled: !enabled, onchange: e => { values[c.id] = String(e.target.checked); recompute(); } });
        box.checked = values[c.id] === "true";
        inputs[c.id] = v => { box.checked = v === "true"; };
        const text = h("span", { ...style, flex: "1" }, { dir: "auto" }, c.text);
        const el = h("label", { ...chrome(c), width: "100%", height: "100%", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" });
        if (prop(c, "boxPosition") === "end") el.append(text, box); else el.append(box, text);
        return el;
      }
      case "TABLE": {
        const el = h("div", { ...chrome(c), width: "100%", height: "100%", overflow: "auto" });
        const fromSheet = prop(c, "dataSource") === "sheet" && store;
        const draw = () => {
          let grid;
          if (fromSheet) grid = (state.sheetRows || [store.headers]).slice(0, 501);
          else {
            const cols = prop(c, "columns").split(",").map(s => s.trim()).filter(Boolean);
            grid = [cols.length ? cols : [""], ...Array.from({ length: Math.max(1, Math.trunc(num(c, "rows"))) }, () => cols.map(() => ""))];
          }
          el.replaceChildren(drawTable(c, style, grid, fromSheet ? state.currentRow : null, fromSheet ? line => {
            const row = state.sheetRows?.[line];
            if (!row) return;
            fill(row);
            state.currentRow = line + 1; state.lastCriteria = null; state.filledSnapshot = formValues();
            draw();
          } : null));
        };
        draw();
        if (fromSheet) tables.push(draw);
        return el;
      }
      default:
        return h("div");
    }
  }

  recompute();
  reloadTables();
  return () => window.removeEventListener("resize", fit);
}

/**
 * Runs a whole app: starts on the first screen; "open screen" buttons move forward and "back"
 * returns. Typed values are kept while moving between screens.
 */
export function runApp(root, project, store, opts) {
  const values = {};
  const stack = [];
  let current = project.screens[0];
  let cleanup = null;
  const show = () => {
    cleanup?.();
    root.scrollTop = 0;
    cleanup = runScreen(root, project, current, store, {
      ...opts, values,
      openScreen: name => {
        const next = project.screens.find(s => s.name === name);
        if (!next) return opts.toast(opts.t("اختر الشاشة التي يفتحها هذا الزر من خصائصه.", "Choose the screen this button opens in its properties."));
        stack.push(current); current = next; show();
      },
      back: () => { if (stack.length) { current = stack.pop(); show(); } },
    });
    opts.onScreen?.(current);
  };
  show();
  return { cleanup: () => cleanup?.(), back: () => (stack.length ? (current = stack.pop(), show(), true) : false) };
}

/** Table from grid (line 0 = headers). Vertical orientation shows one column per record. */
function drawTable(c, style, grid, currentRow, onPick) {
  const headers = grid[0] || [];
  const records = grid.slice(1);
  const fields = Math.max(headers.length, ...records.map(r => r.length), 1);
  const vertical = prop(c, "tableOrientation") === "vertical";
  const grid_ = bool(c, "showGrid") ? `0.5px solid ${cssColor(prop(c, "gridColor"))}` : "none";
  const rowH = num(c, "rowHeight") > 0 ? num(c, "rowHeight") : Math.max(num(c, "fontSize") * 2, 22);
  const minW = num(c, "minColumnWidth");
  const numbers = bool(c, "rowNumbers");
  const align = { start: "start", end: "end" }[prop(c, "cellAlign")] || "center";
  const headBg = cssColor(prop(c, "headerColor"));
  const headStyle = { ...style, color: cssColor(prop(c, "headerTextColor")), fontWeight: 700, background: headBg };
  const striped = bool(c, "striped");
  const cell = (text, head, extra = {}) => h(head ? "th" : "td", {
    ...(head ? headStyle : style), border: grid_, height: rowH + "px", padding: "0 4px", textAlign: align,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "1px", ...(minW > 0 ? { minWidth: minW + "px" } : {}), ...extra,
  }, { dir: "auto" }, text);
  const recordBg = i => i + 1 === currentRow - 1 ? "rgba(32,184,121,.3)" : (striped && i % 2 === 1 ? cssColor(prop(c, "gridColor")) : "transparent");
  const table = h("table", { borderCollapse: "collapse", width: minW > 0 ? "auto" : "100%", tableLayout: minW > 0 ? "auto" : "fixed" });
  if (!vertical) {
    table.append(h("tr", {}, {}, numbers ? cell("#", true, { width: "34px", maxWidth: "none" }) : null, Array.from({ length: fields }, (_, i) => cell(headers[i] ?? "", true))));
    records.forEach((r, i) => table.append(h("tr", { background: recordBg(i), cursor: onPick ? "pointer" : "default" },
      { onclick: () => onPick && r.length && onPick(i + 1) },
      numbers ? cell(String(i + 1), false, { width: "34px", maxWidth: "none" }) : null,
      Array.from({ length: fields }, (_, k) => cell(r[k] ?? "", false)))));
  } else {
    if (numbers) table.append(h("tr", {}, {}, cell("#", true), records.map((_, i) => cell(String(i + 1), true))));
    for (let k = 0; k < fields; k++) {
      table.append(h("tr", {}, {}, cell(headers[k] ?? "", true),
        records.map((r, i) => cell(r[k] ?? "", false, { background: recordBg(i), cursor: onPick ? "pointer" : "default" }))));
    }
    if (onPick) table.querySelectorAll("tr").forEach(tr => [...tr.children].slice(1).forEach((td, i) => td.addEventListener("click", () => records[i]?.length && onPick(i + 1))));
  }
  return table;
}
