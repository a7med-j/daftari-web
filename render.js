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
  TEXT_FIELD: { hint: "اكتب هنا", hintColor: "#FF8A9A92", inputType: "text", maxLength: "0", readOnly: "false", required: "false", suggestAfter: "1", minValue: "", maxValue: "" },
  LABEL: { fontSize: "16", backgroundColor: "#00FFFFFF", borderWidth: "0", maxLines: "0" },
  DROPDOWN: { items: "خيار 1\nخيار 2\nخيار 3", selectedIndex: "-1", hint: "اختر" },
  TABLE: {
    fontSize: "12", columns: "العمود 1,العمود 2,العمود 3", rows: "3", headerColor: "#FF20B879",
    headerTextColor: "#FFFFFFFF", showGrid: "true", gridColor: "#FFC8D3CD", striped: "false",
    tableOrientation: "horizontal", cellAlign: "center", rowHeight: "0", minColumnWidth: "0",
    rowNumbers: "false", dataSource: "", pickRows: "false", resizeColumns: "true",
  },
  DATE_PICKER: { dateFormat: "yyyy/MM/dd", calendar: "gregorian", defaultToday: "true" },
  CHECKBOX: { backgroundColor: "#00FFFFFF", borderWidth: "0", checked: "false", checkColor: "#FF20B879", boxPosition: "start" },
  PHOTO: { hint: "اضغط لالتقاط صورة", imageFit: "contain", required: "false", textColor: "#FF607D8B", textAlign: "center", fontSize: "13", backgroundColor: "#FFFFFFFF", borderWidth: "1" },
  IMAGE: { imageData: "", imageFit: "contain", backgroundColor: "#00FFFFFF", borderWidth: "0" },
  RADIO: { items: "خيار 1\nخيار 2", selectedIndex: "-1", radioLayout: "horizontal", checkColor: "#FF20B879", required: "false", backgroundColor: "#00FFFFFF", borderWidth: "0" },
  TIME_PICKER: { timeFormat: "HH:mm", defaultNow: "false", backgroundColor: "#FFFFFFFF", borderWidth: "1" },
  SIGNATURE: { hint: "اضغط للتوقيع", required: "false", textColor: "#FF607D8B", textAlign: "center", fontSize: "13", backgroundColor: "#FFFFFFFF", borderWidth: "1" },
  CHART: {
    chartType: "column", chartTitle: "", chartFile: "", chartGroup: "", chartValue: "count", chartValueColumn: "", chartSort: "desc", chartLimit: "0",
    chartLabels: "value", chartLegend: "auto", chartAxes: "true", chartGrid: "true", chartTrend: "false", chartHole: "55",
    chartMulticolor: "false", chartColor: "#FF20B879", fontSize: "12", backgroundColor: "#FFFFFFFF", borderWidth: "1",
  },
  LOCATION: { hint: "📍 تحديد الموقع", required: "false", textAlign: "center", backgroundColor: "#FFFFFFFF", borderWidth: "1" },
};

const INPUT_TYPES = new Set(["TEXT_FIELD", "DROPDOWN", "DATE_PICKER", "CHECKBOX", "PHOTO", "RADIO", "TIME_PICKER", "SIGNATURE", "LOCATION"]);
const PICTURE_TYPES = new Set(["PHOTO", "SIGNATURE"]);

/** A list's options (see FormLogic.options): typed lines ("parent: option" when it depends on another list) or an Excel column. */
export function listOptions(items, rows, column, parentColumn, parentValue) {
  if (column != null) {
    const data = (rows || []).slice(1);
    const matching = parentValue == null || parentColumn == null ? data : data.filter(r => normalize(r[parentColumn] ?? "") === normalize(parentValue));
    const seen = new Set();
    return matching.map(r => String(r[column] ?? "").trim()).filter(v => v && !seen.has(normalize(v)) && seen.add(normalize(v)));
  }
  const lines = String(items || "").split("\n").map(s => s.trim()).filter(Boolean);
  if (parentValue == null) return lines;
  return lines.flatMap(line => {
    const i = line.search(/[:：]/);
    if (i < 0) return [line];
    const option = line.slice(i + 1).trim();
    return normalize(line.slice(0, i)) === normalize(parentValue) && option ? [option] : [];
  });
}

/** The next serial number in a column (see FormLogic.nextNumber). */
/** Fields whose value is worked out (a formula, or filled from a file). */
const isLookup = c => !!(prop(c, "lookupField") && prop(c, "lookupColumn"));
/** Fields shown worked out and not typed into: formulas, and labels filled from a file. Filled fields stay editable. */
const isCalculated = c => !!prop(c, "formula").trim() || (c.type === "LABEL" && isLookup(c));

/** Fields filled from a file by another field's value, like FormLogic.lookups (VLOOKUP). */
export function lookups(screen, valueOf, rowsOf) {
  const out = {};
  for (const c of screen.components) {
    const keyName = prop(c, "lookupField"), column = prop(c, "lookupColumn");
    if (!keyName || !column) continue;
    const key = screen.components.find(o => normalize(o.name) === normalize(keyName));
    if (!key) continue;
    const value = normalize(valueOf(key));
    if (!value) { out[c.id] = ""; continue; }
    const rows = rowsOf(prop(c, "lookupFile"));
    if (!rows) continue;
    const index = name => { if (!name) return null; const i = (rows[0] || []).findIndex(x => normalize(x) === normalize(name)); return i < 0 ? null : i; };
    const keyCol = index(prop(key, "optionsColumn")) ?? index(prop(key, "column")), valueCol = index(column);
    if (keyCol == null || valueCol == null) continue;
    const row = rows.slice(1).find(r => normalize(r[keyCol] ?? "") === value);
    out[c.id] = row ? String(row[valueCol] ?? "") : "";
  }
  return out;
}

/** The first record other than `except` whose column holds the value (see FormLogic.duplicateRow), or null. */
export function duplicateRow(rows, column, value, except = null) {
  const wanted = normalize(value ?? "");
  if (!wanted) return null;
  for (let n = 2; n <= rows.length; n++) if (n !== except && normalize((rows[n - 1] || [])[column] ?? "") === wanted) return n;
  return null;
}

/** The choices in a multiple-choice value ("A, B" or "A، B"), see FormLogic.choicesOf. */
export const choicesOf = value => String(value ?? "").split(/[,،]/).map(x => x.trim()).filter(Boolean);
/** Picked choices in the options' order (others at the end), joined with commas as saved in Excel. */
export const joinChoices = (options, picked) => [...options.filter(o => picked.has(o)), ...[...picked].filter(p => !options.includes(p))].join(", ");

/** A number typed with Arabic or Western digits ("٢٥", "1,250.5"), or null (see FormLogic.numberOf). */
export function numberOf(text) {
  const v = String(text ?? "").trim().replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/٫/g, ".").replace(/[,،]/g, "");
  const n = v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Why a value breaks the lowest / highest number, or null when fine (see FormLogic.rangeProblem). */
export function rangeProblem(value, min, max, english) {
  const low = numberOf(min), high = numberOf(max);
  if (!String(value ?? "").trim() || (low == null && high == null)) return null;
  const range = low != null && high != null ? (english ? `between ${low} and ${high}` : `بين ${low} و ${high}`)
    : low != null ? (english ? `at least ${low}` : `لا يقل عن ${low}`) : (english ? `at most ${high}` : `لا يزيد عن ${high}`);
  const n = numberOf(value);
  return n == null || (low != null && n < low) || (high != null && n > high) ? range : null;
}

/** Row numbers ordered by a column: numbers by value, text alphabetically, empty cells last (see FormLogic.sortRows). */
export function sortRows(rows, numbers, column, descending) {
  const cell = n => String(rows[n - 1]?.[column] ?? "").trim();
  const asNumber = v => { const x = Number(v.replace(/,/g, "")); return v !== "" && Number.isFinite(x) ? x : null; };
  return [...numbers].sort((a, b) => {
    const x = cell(a), y = cell(b);
    if (!x || !y) return x ? -1 : y ? 1 : a - b;
    const nx = asNumber(x), ny = asNumber(y);
    const order = nx != null && ny != null ? nx - ny : x.localeCompare(y, ["ar", "en"], { numeric: true, sensitivity: "base" });
    return (descending ? -order : order) || a - b;
  });
}

/** A table's filter (see FormLogic.rowsMatching): part of a cell with contains, every column with anyColumn. */
export function rowsMatching(rows, column, wanted, contains, anyColumn) {
  const values = String(wanted || "").split(/[,،]/).map(normalize).filter(Boolean);
  const hit = cell => { const v = normalize(cell ?? ""); return values.some(x => (contains ? v.includes(x) : v === x)); };
  const out = [];
  for (let n = 2; n <= rows.length; n++) {
    const row = rows[n - 1] || [];
    if (!row.some(v => String(v).trim())) continue;
    if (!values.length || (column != null ? hit(row[column]) : anyColumn ? row.some(hit) : true)) out.push(n);
  }
  return out;
}

/** Data rows (Excel numbers) whose column equals one of the comma-separated values (all rows without a column). */
export function rowsWhere(rows, column, wanted) {
  const values = String(wanted || "").split(/[,،]/).map(normalize).filter(Boolean);
  const out = [];
  for (let n = 2; n <= rows.length; n++) {
    const row = rows[n - 1] || [];
    if (row.some(v => String(v).trim()) && (column == null || !values.length || values.includes(normalize(row[column] ?? "")))) out.push(n);
  }
  return out;
}

/** A label's statistic (see FormLogic.statistic). */
export function statistic(rows, numbers, kind, column) {
  if (kind === "count") return String(numbers.length);
  if (column == null) return "؟";
  const nums = numbers.map(n => normalize(rows[n - 1][column] ?? "").replace(/,/g, "")).filter(v => v !== "" && Number.isFinite(Number(v))).map(Number);
  if (kind === "sum") return formatNumber(nums.reduce((a, b) => a + b, 0));
  if (kind === "average") return formatNumber(nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
  if (kind === "max") return nums.length ? formatNumber(Math.max(...nums)) : "—";
  if (kind === "min") return nums.length ? formatNumber(Math.min(...nums)) : "—";
  return "";
}
// ---- Charts (see FormLogic.chartData and ChartView on Android) ----
const CHART_PALETTE = ["#20B879", "#1565C0", "#EF6C00", "#8E24AA", "#C62828", "#00838F", "#F9A825", "#6D4C41", "#5C6BC0", "#43A047"];

/** Records grouped per category, counted or summed / averaged / max / min, ordered and cut to a number of categories. */
export function chartData(rows, numbers, labelOf, kind, valueColumn, sort, limit, other, empty) {
  const groups = new Map();
  for (const n of numbers) {
    const label = String(labelOf(n) ?? "").trim() || empty;
    if (!groups.has(label)) groups.set(label, []);
    if (kind === "count") groups.get(label).push(1);
    else if (valueColumn != null) { const v = numberOf((rows[n - 1] || [])[valueColumn]); if (v != null) groups.get(label).push(v); }
  }
  let points = [...groups].map(([label, vs]) => ({
    label,
    value: kind === "average" ? (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0)
      : kind === "max" ? (vs.length ? Math.max(...vs) : 0) : kind === "min" ? (vs.length ? Math.min(...vs) : 0) : vs.reduce((a, b) => a + b, 0),
  }));
  if (sort === "desc") points.sort((a, b) => b.value - a.value);
  else if (sort === "asc") points.sort((a, b) => a.value - b.value);
  else if (sort === "name") points.sort((a, b) => a.label.localeCompare(b.label));
  if (limit > 0 && points.length > limit) {
    const kept = points.slice(0, limit - 1);
    points = [...kept, { label: other, value: points.slice(limit - 1).reduce((a, p) => a + p.value, 0) }];
  }
  return points;
}

const chartNumber = v => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(Number(v.toFixed(2))));
function niceScale(min, max) {
  const span = max - min <= 0 ? (max === 0 ? 1 : Math.abs(max)) : max - min;
  const raw = span / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  return [lo, hi <= lo ? lo + step : hi, step];
}

/** An SVG of the chart [c] for [points] in a w×h box. */
function chartSvg(c, points, w, h, color, fontSize) {
  const type = prop(c, "chartType"), round = type === "pie" || type === "donut";
  const multicolor = round || bool(c, "chartMulticolor"), series = cssColor(prop(c, "chartColor"));
  const colorAt = i => (multicolor ? CHART_PALETTE[i % CHART_PALETTE.length] : series);
  const total = points.reduce((a, p) => a + Math.max(p.value, 0), 0);
  const labels = prop(c, "chartLabels");
  const labelOf = p => {
    const pct = total > 0 ? chartNumber(Math.round(p.value / total * 1000) / 10) + "%" : "";
    return labels === "percent" ? pct : labels === "both" ? `${chartNumber(p.value)} (${pct})` : labels === "none" ? "" : chartNumber(p.value);
  };
  const lh = fontSize * 1.3, out = [];
  const text = (t, x, y, opts = {}) => out.push(`<text x="${x}" y="${y}" font-size="${opts.size || fontSize}" fill="${opts.fill || color}" text-anchor="${opts.anchor || "middle"}" dominant-baseline="${opts.base || "middle"}"${opts.bold ? ' font-weight="bold"' : ""}>${esc(t)}</text>`);
  let top = 2, bottom = h - 2;
  const left0 = 2, right0 = w - 2;
  const title = prop(c, "chartTitle");
  if (title.trim()) { text(title, w / 2, top + lh * 0.6, { size: fontSize * 1.2, bold: true }); top += lh * 1.5; }
  if (!points.length) { text("—", w / 2, (top + bottom) / 2); return out.join(""); }
  let legend = prop(c, "chartLegend");
  if (legend === "auto") legend = round ? "bottom" : "none";
  if (legend === "top" || legend === "bottom") {
    // Approximate widths: a box, the label and a gap per entry, wrapped into rows.
    const widths = points.map(p => lh * 0.7 + 4 + Math.min(p.label.length * fontSize * 0.6, (right0 - left0) / 2) + lh * 0.6);
    const rowsL = [[]]; let used = 0;
    widths.forEach((wd, i) => { if (used + wd > right0 - left0 && rowsL.at(-1).length) { rowsL.push([]); used = 0; } rowsL.at(-1).push(i); used += wd; });
    const height = rowsL.length * lh * 1.2;
    let y = legend === "top" ? top : bottom - height;
    for (const row of rowsL) {
      let x = (left0 + right0) / 2 - (row.reduce((a, i) => a + widths[i], 0) - lh * 0.6) / 2;
      for (const i of row) {
        out.push(`<rect x="${x}" y="${y + lh * 0.25}" width="${lh * 0.7}" height="${lh * 0.7}" fill="${colorAt(i)}"/>`);
        text(points[i].label, x + lh * 0.7 + 4, y + lh * 0.6, { anchor: "start" });
        x += widths[i];
      }
      y += lh * 1.2;
    }
    if (legend === "top") top += height + lh * 0.3; else bottom -= height + lh * 0.3;
  }
  if (round) {
    const r = Math.min(right0 - left0, bottom - top) / 2;
    if (r <= 2) return out.join("");
    const cx = (left0 + right0) / 2, cy = (top + bottom) / 2;
    const hole = type === "donut" ? Math.min(80, Math.max(20, num(c, "chartHole"))) / 100 : 0;
    let start = -Math.PI / 2;
    const pt = (a, rr) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
    points.forEach((p, i) => {
      const sweep = total > 0 ? Math.max(p.value, 0) / total * 2 * Math.PI : 0;
      if (sweep <= 0) return;
      const end = start + Math.min(sweep, 2 * Math.PI - 1e-4), large = sweep > Math.PI ? 1 : 0;
      const d = hole > 0
        ? `M${pt(start, r)} A${r},${r} 0 ${large} 1 ${pt(end, r)} L${pt(end, r * hole)} A${r * hole},${r * hole} 0 ${large} 0 ${pt(start, r * hole)} Z`
        : `M${cx},${cy} L${pt(start, r)} A${r},${r} 0 ${large} 1 ${pt(end, r)} Z`;
      out.push(`<path d="${d}" fill="${colorAt(i)}"/>`);
      if (labels !== "none" && sweep > 0.25) {
        const mid = start + sweep / 2, at = hole > 0 ? r * (1 + hole) / 2 : r * 0.62;
        text(labelOf(p), cx + at * Math.cos(mid), cy + at * Math.sin(mid), { fill: "#fff", bold: true });
      }
      start += sweep;
    });
    if (hole > 0 && total > 0) text(chartNumber(total), cx, cy, { size: fontSize * 1.3, bold: true });
    return out.join("");
  }
  const axes = bool(c, "chartAxes"), horizontal = type === "bar";
  const maxV = Math.max(...points.map(p => p.value), 0), minV = Math.min(...points.map(p => p.value), 0);
  const [lo, hi, step] = niceScale(minV, maxV);
  const valueW = axes ? chartNumber(hi).length * fontSize * 0.6 + lh * 0.5 : 0;
  const catW = axes && horizontal ? Math.min(Math.max(...points.map(p => p.label.length)) * fontSize * 0.6 + lh * 0.4, (right0 - left0) * 0.35) : 0;
  const pl = left0 + (horizontal ? catW : valueW), pr = right0 - (labels !== "none" && horizontal ? lh * 2.2 : lh * 0.3);
  const pt0 = top + (labels !== "none" && !horizontal ? lh * 1.1 : lh * 0.3), pb = bottom - (axes ? lh * 1.3 : 0);
  if (pr - pl < 10 || pb - pt0 < 10) return out.join("");
  const px = v => (horizontal ? pl + (v - lo) / (hi - lo) * (pr - pl) : pb - (v - lo) / (hi - lo) * (pb - pt0));
  for (let t = lo; t <= hi + step / 2; t += step) {
    const p = px(t);
    if (bool(c, "chartGrid")) out.push(horizontal ? `<line x1="${p}" y1="${pt0}" x2="${p}" y2="${pb}" stroke="${color}" stroke-opacity=".15"/>` : `<line x1="${pl}" y1="${p}" x2="${pr}" y2="${p}" stroke="${color}" stroke-opacity=".15"/>`);
    if (axes) horizontal ? text(chartNumber(t), p, pb + lh * 0.6) : text(chartNumber(t), pl - lh * 0.25, p, { anchor: "end" });
  }
  const zero = px(0);
  out.push(horizontal ? `<line x1="${zero}" y1="${pt0}" x2="${zero}" y2="${pb}" stroke="${color}" stroke-opacity=".5" stroke-width="1.5"/>` : `<line x1="${pl}" y1="${zero}" x2="${pr}" y2="${zero}" stroke="${color}" stroke-opacity=".5" stroke-width="1.5"/>`);
  const n = points.length, slot = (horizontal ? pb - pt0 : pr - pl) / n;
  const center = i => (horizontal ? pt0 : pl) + slot * (i + 0.5);
  if (type === "line" || type === "area") {
    const pts = points.map((p, i) => [center(i), px(p.value)]);
    if (type === "area") out.push(`<path d="M${pts[0][0]},${zero} ${pts.map(q => "L" + q.join(",")).join(" ")} L${pts.at(-1)[0]},${zero} Z" fill="${series}" fill-opacity=".3"/>`);
    out.push(`<polyline points="${pts.map(q => q.join(",")).join(" ")}" fill="none" stroke="${series}" stroke-width="3"/>`);
    pts.forEach((q, i) => out.push(`<circle cx="${q[0]}" cy="${q[1]}" r="4.5" fill="${colorAt(i)}"/>`));
  } else {
    const thick = slot * 0.62;
    points.forEach((p, i) => {
      const v = px(p.value);
      out.push(horizontal ? `<rect x="${Math.min(zero, v)}" y="${center(i) - thick / 2}" width="${Math.abs(v - zero)}" height="${thick}" fill="${colorAt(i)}"/>`
        : `<rect x="${center(i) - thick / 2}" y="${Math.min(zero, v)}" width="${thick}" height="${Math.abs(v - zero)}" fill="${colorAt(i)}"/>`);
    });
  }
  if (bool(c, "chartTrend") && n >= 2) {
    const mx = (n - 1) / 2, my = points.reduce((a, p) => a + p.value, 0) / n;
    let sxx = 0, sxy = 0;
    points.forEach((p, i) => { sxx += (i - mx) ** 2; sxy += (i - mx) * (p.value - my); });
    const slope = sxx ? sxy / sxx : 0, at = i => my + slope * (i - mx);
    const [a, b] = horizontal ? [[px(at(0)), center(0)], [px(at(n - 1)), center(n - 1)]] : [[center(0), px(at(0))], [center(n - 1), px(at(n - 1))]];
    out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-opacity=".7" stroke-width="2" stroke-dasharray="10 7"/>`);
  }
  points.forEach((p, i) => {
    const v = px(p.value);
    if (horizontal) {
      text(labelOf(p), Math.max(v, zero) + lh * 0.25, center(i), { anchor: "start" });
      if (axes) text(p.label.length * fontSize * 0.6 > catW ? p.label.slice(0, Math.max(1, Math.floor(catW / (fontSize * 0.6)) - 1)) + "…" : p.label, left0, center(i), { anchor: "start" });
    } else {
      text(labelOf(p), center(i), Math.min(v, zero) - lh * 0.5);
      if (axes) text(p.label.length * fontSize * 0.6 > slot ? p.label.slice(0, Math.max(1, Math.floor(slot / (fontSize * 0.6)) - 1)) + "…" : p.label, center(i), pb + lh * 0.6);
    }
  });
  return out.join("");
}

/** Labels may show the signed-in user's first name with {name} or {الاسم}. */
const withUserName = (text, user) => String(text ?? "").replace(/\{(name|الاسم)\}/g, (user && (user.name || user.email)) || "");
const withStatistic = (text, value) => (text.includes("{}") ? text.replaceAll("{}", value) : text.trim() ? text + " " + value : value);

export function nextNumber(rows, column, prefix, digits) {
  const p = normalize(prefix || "");
  const re = new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(\\d+)$");
  let largest = 0;
  for (const r of rows.slice(1)) { const m = re.exec(normalize(r[column] ?? "")); if (m) largest = Math.max(largest, Number(m[1])); }
  return (prefix || "").trim() + String(largest + 1).padStart(Math.max(0, Math.min(12, digits || 0)), "0");
}

function formatTime(c, hours, minutes, lang) {
  const p = n => String(n).padStart(2, "0");
  if (prop(c, "timeFormat") === "HH:mm") return `${p(hours)}:${p(minutes)}`;
  const am = hours < 12, h12 = hours % 12 || 12;
  return `${p(h12)}:${p(minutes)} ` + (lang === "en" ? (am ? "AM" : "PM") : (am ? "ص" : "م"));
}

/** Reads a barcode or QR code with the camera (Chrome's BarcodeDetector). */
async function scanBarcode(lang, toast) {
  const t = (ar, en) => (lang === "en" ? en : ar);
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
    toast(t("هذا المتصفح لا يدعم مسح الباركود. استخدم Chrome على أندرويد أو تطبيق الجوال.", "This browser can't scan codes. Use Chrome on Android or the phone app."));
    return null;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); }
  catch (e) { toast(t("لم يُسمح باستخدام الكاميرا.", "Camera access was not allowed.")); return null; }
  return await new Promise(resolve => {
    const video = h("video", { width: "100%", maxHeight: "70vh", borderRadius: "12px", background: "#000" }, { autoplay: true, playsinline: true, muted: true });
    video.srcObject = stream;
    let done = false;
    const finish = value => { if (done) return; done = true; stream.getTracks().forEach(tr => tr.stop()); overlay.remove(); resolve(value); };
    const overlay = h("div", { position: "fixed", inset: "0", background: "#000c", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", zIndex: "60", padding: "16px" }, {},
      h("div", { color: "#fff" }, {}, t("وجّه الكاميرا إلى الباركود", "Point the camera at the code")), video,
      h("button", { padding: "10px 20px", borderRadius: "10px", border: "0", fontSize: "15px" }, { onclick: () => finish(null) }, t("إلغاء", "Cancel")));
    document.body.append(overlay);
    const detector = new BarcodeDetector();
    const tick = async () => {
      if (done) return;
      try { const codes = await detector.detect(video); if (codes.length && codes[0].rawValue) return finish(codes[0].rawValue); } catch (e) {}
      setTimeout(tick, 250);
    };
    video.onloadeddata = tick;
  });
}

/** A signature pad over the page; resolves with a JPEG (white background) or null. */
function signaturePad(lang) {
  const t = (ar, en) => (lang === "en" ? en : ar);
  return new Promise(resolve => {
    const canvas = h("canvas", { width: "100%", height: "240px", background: "#fff", borderRadius: "10px", touchAction: "none" });
    const ctx = canvas.getContext("2d");
    let drawing = false, drawn = false;
    const setup = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width; canvas.height = r.height;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#10251F"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
    };
    const at = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.onpointerdown = e => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...at(e)); };
    canvas.onpointermove = e => { if (!drawing) return; ctx.lineTo(...at(e)); ctx.stroke(); drawn = true; };
    canvas.onpointerup = () => { drawing = false; };
    const close = v => { overlay.remove(); resolve(v); };
    const btn = (label, fn, bg) => h("button", { padding: "10px 14px", borderRadius: "10px", border: "0", background: bg || "#e6e1e5", color: bg ? "#fff" : "#1d1b20", fontSize: "15px", cursor: "pointer" }, { onclick: fn }, label);
    const overlay = h("div", { position: "fixed", inset: "0", background: "#0009", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "60" }, { dir: lang === "en" ? "ltr" : "rtl" },
      h("div", { background: "#172C24", color: "#fff", borderRadius: "14px", padding: "16px", width: "min(94vw, 520px)", display: "flex", flexDirection: "column", gap: "10px" }, {},
        h("div", { fontWeight: "bold" }, {}, t("وقّع داخل المربع", "Sign inside the box")), canvas,
        h("div", { display: "flex", gap: "8px", justifyContent: "flex-end" }, {},
          btn(t("مسح", "Clear"), setup), btn(t("إلغاء", "Cancel"), () => close(null)),
          btn(t("حفظ التوقيع", "Save"), () => {
            if (!drawn) return close(null);
            canvas.toBlob(async b => close(b ? new Uint8Array(await b.arrayBuffer()) : null), "image/jpeg", 0.85);
          }, "#20B879"))));
    document.body.append(overlay);
    setup();
  });
}
const PHOTO_NAME = /^IMG_\d{8}_\d{6}_[0-9a-f]{4}\.jpg$/;
export const isPhoto = v => PHOTO_NAME.test(String(v || "").trim());
const FIT = { contain: "contain", cover: "cover", stretch: "fill" };

function photoName() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `IMG_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_` +
    crypto.randomUUID().slice(0, 4) + ".jpg";
}

/** Shrinks a picked picture (upright, longer side at most 1280px) to a JPEG under ~700 KB. */
export async function compressPhoto(file, maxSide = 1280, maxBytes = 700000) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let blob;
  for (let q = 0.8; q >= 0.3; q -= 0.1) {
    blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", q));
    if (blob.size <= maxBytes) break;
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Pages open from the browser's kept copy at once; when the service worker finds a newer version,
 * the page reloads right away if it just opened, otherwise a small bar offers to update.
 */
export function watchUpdates(t = (ar, en) => ar) {
  if (!("serviceWorker" in navigator)) return;
  const openedAt = Date.now();
  let shown = false;
  navigator.serviceWorker.addEventListener("message", e => {
    if (e.data?.type !== "waraqa-updated" || shown) return;
    shown = true;
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    // Reloads by itself at most once a minute (never in a loop); otherwise the bar below.
    let last = 0;
    try { last = +sessionStorage.getItem("waraqa-reloaded") || 0; } catch (err) {}
    if (Date.now() - openedAt < 8000 && !typing && Date.now() - last > 60000) {
      try { sessionStorage.setItem("waraqa-reloaded", String(Date.now())); } catch (err) {}
      return location.reload();
    }
    const bar = h("div", { position: "fixed", insetInline: "12px", bottom: "12px", zIndex: "200", padding: "12px 14px", borderRadius: "12px", background: "#172C24", color: "#fff", display: "flex", alignItems: "center", gap: "10px", boxShadow: "0 4px 16px rgba(0,0,0,.3)", fontSize: "14px" }, {},
      h("span", { flex: "1" }, {}, t("يوجد تحديث جديد.", "An update is ready.")));
    const go = h("button", { border: "0", borderRadius: "8px", padding: "8px 14px", background: "#20B879", color: "#fff", cursor: "pointer" }, {}, t("تحديث", "Update"));
    go.onclick = () => location.reload();
    bar.append(go);
    document.body.append(bar);
  });
}

// ---- Account security on the web (same rules as Android's PasswordRules and app lock) ----

/** Account passwords: at least 8 characters with letters and digits. */
export const isStrongPassword = p => String(p || "").length >= 8 && /\p{L}/u.test(p) && /\p{Nd}/u.test(p);

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function passwordHash(uid, password) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode("waraqa:" + uid), iterations: 150000, hash: "SHA-256" }, key, 256);
  return b64(bits);
}
const store = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
};

/**
 * Remembers a password the user just typed (sign-in or sign-up), so this browser can open the app
 * with it offline; a strong one also passes the one-time security check.
 */
export async function rememberPassword(uid, password, fresh = true) {
  if (!uid || !password || !crypto?.subtle) return;
  if (fresh) sessionSet("waraqa-fresh:" + uid, "1");
  store.set("waraqa-pw:" + uid, await passwordHash(uid, password));
  store.set("waraqa-pw-ok:" + uid, isStrongPassword(password) ? "1" : null);
}
const sessionGet = k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
const sessionSet = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} };

/**
 * Which locks open an app on this browser: the account password when its owner requires it (My apps →
 * Security), plus those the member turned on for themselves.
 */
export function lockChoice(appId, uid, security = {}) {
  // On the web the phone's lock is each member's own choice (off until they turn it on), so signing
  // in is by email and password only; the owner may still require the account password.
  const owner = { device: false, password: security.passwordLock === true };
  let mine = {};
  try { mine = JSON.parse(store.get(`waraqa-mylock:${appId}:${uid}`) || "{}"); } catch (e) {}
  return { owner, mine, device: owner.device || !!mine.device, password: owner.password || !!mine.password };
}

/** The member's own lock settings for an app: each lock on or off, except those the owner requires. */
export function lockSettings({ appId, uid, security, t, lang, onSaved }) {
  const choice = lockChoice(appId, uid, security);
  const mine = { device: choice.device, password: choice.password };
  const cover = h("div", { position: "fixed", inset: "0", background: "rgba(0,0,0,.55)", zIndex: "120", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  const row = (key, title, detail) => {
    const forced = choice.owner[key];
    const box = h("input", {}, { type: "checkbox" });
    box.checked = mine[key];
    box.disabled = forced;
    box.style.cssText = "width:22px;height:22px;accent-color:#20B879;flex:none";
    box.onchange = () => (mine[key] = box.checked);
    return h("label", { display: "flex", gap: "12px", alignItems: "flex-start", padding: "12px", borderRadius: "12px", background: "#0E1E19", cursor: forced ? "default" : "pointer" }, {},
      box,
      h("div", { display: "flex", flexDirection: "column", gap: "4px" }, {},
        h("b", { fontSize: "15px" }, {}, title),
        h("span", { fontSize: "12px", color: "#9FB5AA" }, {}, detail),
        forced ? h("span", { fontSize: "12px", color: "#FFC857" }, {}, t("مطلوب من صاحب التطبيق", "Required by the app's owner")) : null));
  };
  const save = h("button", { padding: "12px", borderRadius: "10px", border: "0", background: "#20B879", color: "#fff", fontSize: "15px", cursor: "pointer" }, {}, t("حفظ", "Save"));
  const cancel = h("button", { padding: "10px", borderRadius: "10px", border: "0", background: "transparent", color: "#9FB5AA", fontSize: "14px", cursor: "pointer" }, {}, t("إلغاء", "Cancel"));
  save.onclick = () => {
    store.set(`waraqa-mylock:${appId}:${uid}`, JSON.stringify({ device: mine.device && !choice.owner.device, password: mine.password && !choice.owner.password }));
    cover.remove();
    onSaved?.(lockChoice(appId, uid, security));
  };
  cancel.onclick = () => cover.remove();
  cover.onclick = e => { if (e.target === cover) cover.remove(); };
  cover.append(h("div", { maxWidth: "380px", width: "100%", padding: "20px", borderRadius: "16px", background: "#172C24", color: "#fff", display: "flex", flexDirection: "column", gap: "10px" }, { dir: lang === "en" ? "ltr" : "rtl" },
    h("h3", { margin: "0" }, {}, t("قفل التطبيق", "App lock")),
    h("p", { margin: "0", fontSize: "13px", color: "#9FB5AA" }, {}, t("اختر ما يُطلب عند فتح التطبيق على هذا الجهاز، أو لا شيء.", "Choose what is asked when the app opens on this device, or nothing.")),
    row("device", t("البصمة أو رمز الجوال", "Fingerprint or phone PIN"), t("قفل شاشة جوالك نفسه (البصمة أو الوجه أو الرمز).", "Your phone's own screen lock (fingerprint, face or PIN).")),
    row("password", t("كلمة مرور الحساب", "Account password"), t("تكتب كلمة مرور حسابك عند الفتح.", "Type your account password when opening.")),
    save, cancel));
  document.body.append(cover);
}

// ---- Symbols on buttons (Material icons, as in the Android app) ----

const ICON_PATHS = {
  undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z",
  redo: "M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z",
  save: "M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z",
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  search: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  clear: "M5 13h14v-2H5v2zm-2 4h14v-2H3v2zM7 7v2h14V7H7z",
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  pdf: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  share: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
};
/** A button's symbol as an SVG element, or null; undo, redo and back are mirrored in right-to-left apps (as on Android). */
function buttonIcon(name, color, size, rtl) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
  svg.style.flex = "none";
  if (rtl && ["undo", "redo", "back"].includes(name)) svg.style.transform = "scaleX(-1)";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d); path.setAttribute("fill", color || "currentColor");
  svg.append(path);
  return svg;
}

// ---- The app's standard ☰ menu (chosen by its owner when exporting or publishing; see AppMenu) ----

const MENU_ITEMS = [
  ["profile", "الملف الشخصي", "Profile"], ["password", "تغيير كلمة المرور", "Change password"], ["lock", "قفل التطبيق", "App lock"],
  ["share", "مشاركة التطبيق", "Share the app"], ["export", "تصدير البيانات إلى Excel", "Export data to Excel"],
  ["signOut", "تسجيل الخروج", "Sign out"], ["close", "إغلاق", "Close"],
];
const MENU_DEFAULT = ["profile", "password", "lock", "share", "export", "signOut"];

/**
 * The menu entries [label, action] for a project: the items its owner chose, in order, for which
 * `actions` has a handler (an item that can't work here is left out).
 */
export function appMenu(project, actions, lang) {
  const chosen = Array.isArray(project.appMenu) ? project.appMenu : MENU_DEFAULT;
  return MENU_ITEMS.filter(([id]) => chosen.includes(id) && actions[id]).map(([id, ar, en]) => [lang === "en" ? en : ar, actions[id], id]);
}

/** A small dialog with fields; resolves with their values, or null when cancelled. */
function formDialog({ title, fields, note, t, lang, submit }) {
  return new Promise(resolve => {
    const cover = h("div", { position: "fixed", inset: "0", background: "rgba(0,0,0,.55)", zIndex: "120", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    const inputs = fields.map(f => {
      const i = h("input", { padding: "11px", borderRadius: "10px", border: "1px solid #4f6b5f", background: "#0b1c16", color: "#fff", fontSize: "15px" },
        { type: f.type || "text", placeholder: f.label, dir: "auto" });
      i.value = f.value || "";
      return i;
    });
    const ok = h("button", { padding: "12px", borderRadius: "10px", border: "0", background: "#20B879", color: "#fff", fontSize: "15px", cursor: "pointer" }, {}, submit);
    const cancel = h("button", { padding: "10px", borderRadius: "10px", border: "0", background: "transparent", color: "#9FB5AA", fontSize: "14px", cursor: "pointer" }, {}, t("إلغاء", "Cancel"));
    const close = v => { cover.remove(); resolve(v); };
    ok.onclick = () => close({ values: inputs.map(i => i.value) });
    cancel.onclick = () => close(null);
    cover.append(h("div", { maxWidth: "380px", width: "100%", padding: "20px", borderRadius: "16px", background: "#172C24", color: "#fff", display: "flex", flexDirection: "column", gap: "10px" }, { dir: lang === "en" ? "ltr" : "rtl" },
      h("h3", { margin: "0" }, {}, title), note ? h("p", { margin: "0", fontSize: "13px", color: "#9FB5AA" }, {}, note) : null, ...inputs, ok, cancel));
    document.body.append(cover);
  });
}

/** The member's name (changeable) and email. `save(name)` changes it. */
export async function profileDialog({ name, email, t, lang, save, toast }) {
  const r = await formDialog({ title: t("الملف الشخصي", "Profile"), note: t("البريد: ", "Email: ") + (email || "—"), t, lang, submit: t("حفظ", "Save"),
    fields: [{ label: t("الاسم", "Name"), value: name }] });
  if (!r) return;
  const next = r.values[0].trim().slice(0, 40);
  if (!next) return toast(t("اكتب اسمك.", "Enter your name."));
  try { await save(next); toast(t("تم حفظ الاسم ✓", "Name saved ✓")); } catch (e) { toast(String(e?.message || e)); }
}

/** Current password, then the new one twice. `change(current, next)` does it (throws on a wrong current one). */
export async function passwordDialog({ uid, t, lang, change, toast, strong = true }) {
  const r = await formDialog({ title: t("تغيير كلمة المرور", "Change password"), t, lang, submit: t("تغيير", "Change"),
    note: strong ? t("٨ أحرف على الأقل، فيها حرف ورقم.", "At least 8 characters, with a letter and a digit.") : t("٦ أحرف على الأقل.", "At least 6 characters."),
    fields: [{ label: t("كلمة المرور الحالية", "Current password"), type: "password" }, { label: t("كلمة المرور الجديدة", "New password"), type: "password" }, { label: t("أعد كتابة الجديدة", "New password again"), type: "password" }] });
  if (!r) return;
  const [current, next, again] = r.values;
  if (strong ? !isStrongPassword(next) : next.length < 6) return toast(t("الكلمة الجديدة ضعيفة.", "The new password is weak."));
  if (next !== again) return toast(t("الكلمتان الجديدتان غير متطابقتين.", "The new passwords don't match."));
  try { await change(current, next); if (uid) await rememberPassword(uid, next); toast(t("تم تغيير كلمة المرور ✓", "Password changed ✓")); }
  catch (e) { toast(/credential|wrong-password/.test(String(e?.code || e)) ? t("كلمة المرور الحالية غير صحيحة.", "The current password is wrong.") : String(e?.message || e)); }
}

export function forgetSecurity(uid) {
  for (const k of ["waraqa-pw:", "waraqa-pw-ok:", "waraqa-key:"]) store.set(k + uid, null);
}

/**
 * Before showing an account's data: a one-time check of the password (a weak one is replaced),
 * then the lock (fingerprint/face/PIN through the browser, or the password, also offline).
 * Resolves when the app may show; [ui] gives t, the container, and the account's functions.
 */
export async function securityGate(ui) {
  const { uid, el, t, verify, change, signOut } = ui;
  // The app owner's choices (My apps → Security): the password check, the lock and its delay.
  // device: the phone's own lock (fingerprint, face or PIN); password: the account password.
  const checkPassword = ui.checkPassword !== false, useDevice = !!ui.device, usePassword = !!ui.password, lockAfterMs = ui.lockAfterMs || 2 * 60 * 1000;
  const box = (...kids) => {
    const card = h("div", { maxWidth: "380px", margin: "40px auto", padding: "20px", borderRadius: "16px", background: "#172C24", color: "#fff", display: "flex", flexDirection: "column", gap: "10px" }, { dir: ui.lang === "en" ? "ltr" : "rtl" }, ...kids);
    el.replaceChildren(card);
    return card;
  };
  const input = ph => h("input", { padding: "12px", borderRadius: "10px", border: "1px solid #2E4A3E", background: "#0E1E19", color: "#fff", fontSize: "15px" }, { type: "password", placeholder: ph });
  const button = (text, primary = true) => h("button", { padding: "12px", borderRadius: "10px", border: "0", background: primary ? "#20B879" : "transparent", color: primary ? "#fff" : "#9FB5AA", fontSize: "15px", cursor: "pointer" }, {}, text);
  const note = (text, color = "#9FB5AA") => h("p", { margin: "0", fontSize: "13px", color }, {}, text);

  // 1. The security update, once per browser, when online (offline it waits for the next time).
  if (checkPassword && !store.get("waraqa-pw-ok:" + uid) && navigator.onLine) {
    await new Promise(done => {
      const current = input(t("كلمة المرور الحالية", "Current password"));
      const fresh = input(t("كلمة المرور الجديدة", "New password")), again = input(t("تأكيد كلمة المرور الجديدة", "Confirm the new password"));
      const weakNote = note(t("كلمة مرورك ضعيفة. اختر كلمة جديدة: 8 خانات على الأقل، فيها حروف وأرقام.", "Your password is weak. Choose a new one: at least 8 characters, with letters and digits."), "#FF8A80");
      const msg = note("", "#FF8A80"), go = button(t("متابعة", "Continue")), out = button(t("تسجيل الخروج", "Sign out"), false);
      const extra = [weakNote, fresh, again];
      extra.forEach(x => (x.style.display = "none"));
      current.oninput = () => extra.forEach(x => (x.style.display = current.value && !isStrongPassword(current.value) ? "" : "none"));
      out.onclick = () => signOut();
      go.onclick = async () => {
        msg.textContent = "";
        const weak = !isStrongPassword(current.value);
        if (weak && !isStrongPassword(fresh.value)) return (msg.textContent = t("الكلمة الجديدة ضعيفة: 8 خانات على الأقل، فيها حروف وأرقام.", "The new password is weak: at least 8 characters, with letters and digits."));
        if (weak && fresh.value !== again.value) return (msg.textContent = t("كلمتا المرور الجديدتان غير متطابقتين.", "The new passwords do not match."));
        go.disabled = true;
        try {
          await verify(current.value);
          if (weak) await change(fresh.value);
          await rememberPassword(uid, weak ? fresh.value : current.value);
          done();
        } catch (e) {
          msg.textContent = /wrong-password|invalid-credential|invalid-login/.test(String(e?.code)) ? t("كلمة المرور الحالية غير صحيحة.", "The current password is wrong.")
            : /network/.test(String(e?.code)) ? t("يحتاج اتصالًا بالإنترنت.", "This needs a connection.") : String(e?.message || e);
          go.disabled = false;
        }
      };
      box(h("h3", { margin: "0" }, {}, t("تحديث الأمان", "Security update")), note(t("أدخل كلمة مرورك الحالية للتأكد من قوتها.", "Enter your current password to check that it is strong.")), current, ...extra, msg, go, out);
    });
  }

  const isAvailable = async () => !!window.PublicKeyCredential && !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false));
  const signOutButton = () => { const out = button(t("تسجيل الخروج", "Sign out"), false); out.onclick = () => signOut(); return out; };

  /** The phone's own lock (fingerprint, face or PIN); the first time it is set up with one tap. */
  const deviceStep = () => new Promise(done => {
    const msg = note("", "#FF8A80"), bio = button(t("فتح بالبصمة أو رمز الجوال", "Unlock with fingerprint or PIN"));
    const useKey = async () => {
      msg.textContent = "";
      const id = store.get("waraqa-key:" + uid);
      try {
        if (id) {
          await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: "public-key", id: unb64(id) }], userVerification: "required", timeout: 60000 } });
        } else {
          const cred = await navigator.credentials.create({ publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: "Waraqa" },
            user: { id: new TextEncoder().encode(uid).slice(0, 64), name: ui.email || uid, displayName: ui.name || ui.email || uid },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
            authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" }, timeout: 60000,
          } });
          if (!cred) throw new Error("no credential");
          store.set("waraqa-key:" + uid, b64(cred.rawId));
        }
        done();
      } catch (e) { msg.textContent = t("لم يتم التحقق. اضغط الزر للمحاولة مرة أخرى.", "Not verified. Tap the button to try again."); }
    };
    bio.onclick = useKey;
    const card = box(h("div", { fontSize: "40px", textAlign: "center" }, {}, "🔒"), h("h3", { margin: "0", textAlign: "center" }, {}, t("التطبيق مقفل", "The app is locked")), bio, msg, signOutButton());
    // Opens the phone's lock at once when it is already set up (the first time needs the tap).
    if (store.get("waraqa-key:" + uid)) card.ownerDocument.defaultView?.setTimeout(useKey, 50);
  });

  /** The account password: checked on this browser (also offline), or with the server. */
  const passwordStep = () => new Promise(done => {
    const hash = store.get("waraqa-pw:" + uid);
    const pass = input(t("كلمة مرور الحساب", "Account password"));
    const msg = note("", "#FF8A80"), open = button(t("فتح", "Open"));
    const go = async () => {
      msg.textContent = "";
      try {
        const ok = hash ? (await passwordHash(uid, pass.value)) === hash : (await verify(pass.value), true);
        if (!ok) return (msg.textContent = t("كلمة المرور غير صحيحة.", "Wrong password."));
        await rememberPassword(uid, pass.value, false);
        done();
      } catch (e) {
        msg.textContent = /network/.test(String(e?.code)) ? t("يحتاج اتصالًا بالإنترنت أول مرة.", "The first time needs a connection.") : t("كلمة المرور غير صحيحة.", "Wrong password.");
      }
    };
    open.onclick = go;
    pass.onkeydown = e => { if (e.key === "Enter") go(); };
    const card = box(h("div", { fontSize: "40px", textAlign: "center" }, {}, "🔑"), h("h3", { margin: "0", textAlign: "center" }, {}, t("التطبيق مقفل", "The app is locked")), pass, open, msg, signOutButton());
    card.ownerDocument.defaultView?.setTimeout(() => pass.focus(), 50);
  });

  // 2. The lock: on opening, and when back after some minutes away. Each kind is its own step;
  // a browser that can't use the phone's lock asks for the account password instead.
  const unlockOnce = async () => {
    const deviceOk = useDevice && await isAvailable();
    if (deviceOk) await deviceStep();
    if (usePassword || (useDevice && !deviceOk)) await passwordStep();
  };
  if (!useDevice && !usePassword) return;
  // Right after signing in (the password was just typed) it opens without asking again.
  if (!ui.watching && sessionGet("waraqa-fresh:" + uid)) sessionSet("waraqa-fresh:" + uid, null);
  else await unlockOnce();

  // Locks again after some minutes in the background (the app stays underneath).
  if (!ui.watching) {
    ui.watching = true;
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (!hiddenAt || Date.now() - hiddenAt < lockAfterMs) return;
      hiddenAt = 0;
      const cover = h("div", { position: "fixed", inset: "0", background: "#10251F", zIndex: "100", overflow: "auto" });
      document.body.append(cover);
      await securityGate({ ...ui, el: cover, watching: true, checkPassword: false });
      cover.remove();
    });
  }
}

// ---- Shared tables that keep working offline (same layout and rules as Android's CloudRowStore) ----

/** Waiting changes applied to the stored records: new ones at the end, changes and removals in place (see OfflineOps). */
export function applyPending(records, ops) {
  const list = records.map(r => ({ ...r }));
  for (const op of ops) {
    if (op.kind === "add") { if (!list.some(r => r.id === op.id)) list.push({ ...(op.extra || {}), id: op.id, c: op.cells || [], pending: true }); }
    else if (op.kind === "update") { const r = list.find(x => x.id === op.id); if (r) { r.c = withValues(r.c, op.values); r.pending = true; } }
    else if (op.kind === "delete") { const i = list.findIndex(x => x.id === op.id); if (i >= 0) list.splice(i, 1); }
  }
  return list;
}
export const withValues = (cells, values) => {
  const out = [...cells];
  for (const [k, v] of Object.entries(values || {})) { const i = Number(k); while (out.length <= i) out.push(""); out[i] = v; }
  return out;
};

/**
 * A shared table's records (fs: the Firestore functions in use). Without a connection a change is
 * kept in this browser, shown at once, and uploaded in order when the connection comes back.
 */
export function offlineTable(fs, col, headers, author, allowOffline = true) {
  const CHUNK = 200;
  const chunkId = i => "c" + String(i).padStart(5, "0");
  const chunkIndex = id => (/^c\d+$/.test(id) ? Number(id.slice(1)) : null);
  const readRows = raw => (Array.isArray(raw) ? raw : []).map(m => ({ ...(m || {}), id: String(m?.id ?? ""), c: (m?.c || []).map(v => String(v ?? "")) }));
  const plain = r => { const { chunk, pending, ...rest } = r; return rest; };
  const key = "waraqa-offline:" + col.path;
  const queue = () => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; } };
  const saveQueue = ops => { try { ops.length ? localStorage.setItem(key, JSON.stringify(ops)) : localStorage.removeItem(key); } catch (e) {} };
  const isOffline = e => !navigator.onLine || ["unavailable", "deadline-exceeded", "failed-precondition"].includes(e?.code) || e?.offline;
  let snapshot = [];
  let lastOffline = false;
  let flushing = null;

  async function appendIn(row) {
    const ids = (await fs.getDocsFromServer(col)).docs.map(d => chunkIndex(d.id)).filter(i => i != null);
    const last = ids.length ? Math.max(...ids) : null;
    await fs.runTransaction(fs.db, async tx => {
      const lastRows = last == null ? [] : readRows((await tx.get(fs.doc(col, chunkId(last)))).data()?.rows);
      const target = last == null ? 0 : lastRows.length >= CHUNK ? last + 1 : last;
      const existing = target === last ? lastRows : readRows((await tx.get(fs.doc(col, chunkId(target)))).data()?.rows);
      tx.set(fs.doc(col, chunkId(target)), { rows: [...existing, row], updatedAt: fs.serverTimestamp() });
    });
  }
  async function rewrite(id, transform) {
    const holder = (await fs.getDocsFromServer(col)).docs.find(d => readRows(d.data().rows).some(r => r.id === id));
    if (!holder) return false;
    await fs.runTransaction(fs.db, async tx => {
      const rows = readRows((await tx.get(holder.ref)).data()?.rows), edited = [];
      for (const r of rows) { if (r.id !== id) edited.push(r); else { const c = transform(r.c); if (c) edited.push({ ...r, c }); } }
      tx.set(holder.ref, { rows: edited, updatedAt: fs.serverTimestamp() });
    });
    return true;
  }
  /** Uploads the waiting changes in order; stops at the first one that can't go up yet. */
  function flush() {
    flushing ||= (async () => {
      try {
        for (const op of queue()) {
          if (op.kind === "add") {
            const exists = (await fs.getDocsFromServer(col)).docs.some(d => readRows(d.data().rows).some(r => r.id === op.id));
            if (!exists) await appendIn({ ...(op.extra || {}), id: op.id, c: op.cells });
          } else await rewrite(op.id, cells => (op.kind === "delete" ? null : withValues(cells, op.values)));
          saveQueue(queue().filter(o => JSON.stringify(o) !== JSON.stringify(op)));
        }
      } finally { flushing = null; }
    })();
    return flushing;
  }
  const keep = op => { saveQueue([...queue(), op]); lastOffline = true; };
  if (typeof window !== "undefined") window.addEventListener("online", () => { if (queue().length) flush().catch(() => {}); });

  const fromDocs = docs => {
    const stored = [...docs].sort((a, b) => (a.id < b.id ? -1 : 1)).flatMap(d => readRows(d.data().rows).map(r => ({ ...r, chunk: d.id })));
    snapshot = applyPending(stored, queue());
    return [headers, ...snapshot.map(r => r.c)];
  };
  // Told when the server's rows arrive after a quick read from the kept copy, and they differ.
  const freshListeners = new Set();
  let refreshing = null;

  return {
    headers,
    /**
     * The rows, headers first. [quick]: from the copy kept in this browser when there is one (shows
     * at once), while the server's are read in the background (see onFresh). Checks before saving
     * read without it, so they always see the latest.
     */
    async rows(quick = false) {
      if (quick && fs.getDocsFromCache && !queue().length) {
        try {
          const kept = await fs.getDocsFromCache(col);
          if (!kept.empty) {
            const result = fromDocs(kept.docs);
            const before = JSON.stringify(result);
            refreshing ||= this.rows().then(rows => {
              if (JSON.stringify(rows) !== before) freshListeners.forEach(listener => listener(rows));
            }).catch(() => {}).finally(() => (refreshing = null));
            return result;
          }
        } catch (e) { /* nothing kept yet: read normally */ }
      }
      if (queue().length && navigator.onLine) await flush().catch(() => {});
      // Offline, Firestore answers from the copy kept in this browser.
      return fromDocs((await fs.getDocs(col)).docs);
    },
    /** Calls [listener] with the server's rows when they differ from a quick read; returns the way to stop. */
    onFresh(listener) { freshListeners.add(listener); return () => freshListeners.delete(listener); },
    authors() { return snapshot.map(r => r.by || ""); },
    authorNames() { return snapshot.map(r => r.byName || ""); },
    savedOffline() { return lastOffline; },
    pendingCount() { return queue().length; },
    async append(values) {
      const width = Math.max(headers.length, ...Object.keys(values).map(k => Number(k) + 1));
      const cells = Array.from({ length: width }, (_, i) => values[i] ?? "");
      const extra = author(), id = crypto.randomUUID();
      lastOffline = false;
      try {
        if (queue().length || !navigator.onLine) throw { offline: true }; // keep the order
        await appendIn({ ...extra, id, c: cells });
      } catch (e) {
        if (!isOffline(e)) throw e;
        if (!allowOffline) throw Object.assign(new Error("offline"), { code: "unavailable" });
        keep({ kind: "add", id, cells, extra });
      }
      const offline = lastOffline;
      const n = (await this.rows()).length;
      lastOffline = offline;
      return n;
    },
    async update(number, values) { await change(number, "update", Object.fromEntries(Object.entries(values).map(([k, v]) => [String(k), v]))); },
    async delete(number) { await change(number, "delete", {}); },
    /** Puts a record before the one now at row [number] (in its chunk); offline it goes at the end. */
    async insert(number, values) {
      const next = snapshot[number - 2];
      if (!next || next.pending || queue().length || !navigator.onLine) return this.append(values);
      const width = Math.max(headers.length, ...Object.keys(values).map(k => Number(k) + 1));
      const cells = Array.from({ length: width }, (_, i) => values[i] ?? "");
      const id = crypto.randomUUID();
      try {
        const holder = (await fs.getDocsFromServer(col)).docs.find(d => readRows(d.data().rows).some(r => r.id === next.id));
        if (!holder) return this.append(values);
        await fs.runTransaction(fs.db, async tx => {
          const rows = readRows((await tx.get(holder.ref)).data()?.rows);
          const at = rows.findIndex(r => r.id === next.id);
          rows.splice(at < 0 ? rows.length : at, 0, { ...author(), id, c: cells });
          tx.set(holder.ref, { rows, updatedAt: fs.serverTimestamp() });
        });
      } catch (e) {
        if (isOffline(e) && allowOffline) return this.append(values);
        throw e;
      }
      lastOffline = false;
      const all = await this.rows();
      const at = snapshot.findIndex(r => r.id === id);
      return at < 0 ? all.length : at + 2;
    },
  };

  async function change(number, kind, values) {
    const target = snapshot[number - 2];
    if (!target) throw Object.assign(new Error("app-gone"), { code: "not-found" });
    lastOffline = false;
    try {
      if (target.pending || queue().length || !navigator.onLine) throw { offline: true };
      await rewrite(target.id, cells => (kind === "delete" ? null : withValues(cells, values)));
    } catch (e) {
      if (!isOffline(e)) throw e;
      if (!allowOffline) throw Object.assign(new Error("offline"), { code: "unavailable" });
      keep({ kind, id: target.id, values });
    }
    snapshot = kind === "delete" ? snapshot.filter(r => r.id !== target.id) : snapshot.map(r => (r.id === target.id ? { ...r, c: withValues(r.c, values) } : r));
  }
}

// ---- Excel file of table rows (a minimal .xlsx: inline strings, numbers as numbers) ----
const xlsxCrcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const xlsxCrc32 = bytes => { let c = 0xFFFFFFFF; for (const b of bytes) c = xlsxCrcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function xlsxZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = enc.encode(text), nameBytes = enc.encode(name), crc = xlsxCrc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function xlsxBlobOf(sheetName, rows, lang) {
  const x = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const col = i => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const numeric = v => /^-?\d+(\.\d+)?$/.test(v) && !(v.replace("-", "").length > 1 && /^-?0\d/.test(v)) && v.replace(/[-.]/g, "").length <= 15;
  const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    const ref = col(ci) + (ri + 1), s = ri === 0 ? ' s="1"' : "", val = String(v ?? "");
    if (!val) return "";
    return numeric(val) && ri > 0 ? `<c r="${ref}"><v>${val}</v></c>` : `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${x(val)}</t></is></c>`;
  }).join("") + "</row>").join("");
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main", rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const name = x(sheetName.replace(/[:\\/?*\[\]]/g, " ").trim().slice(0, 31) || "Sheet1");
  return xlsxZip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E7145"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"${lang === "ar" ? ' rightToLeft="1"' : ""}/></sheetViews><sheetData>${body}</sheetData></worksheet>`],
  ]);
}

/** Saves a file to the user's downloads. */
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
}

/** The id of the data file a field names ("الملف الرئيسي", a file's name or its Excel file), or null (see Project.fileIdByName). */
export function fileIdByName(project, name) {
  const key = x => normalize(x ?? "").replace(/\.xlsx$/, "");
  const n = key(name);
  if (!n) return null;
  const ex = project.excel || {};
  if ([ "الملف الرئيسي", "Main file", ex.fileName, ex.sheet].some(x => x && key(x) === n)) return "";
  return (project.files || []).find(f => [f.name, f.link?.fileName, f.link?.sheet].some(x => x && key(x) === n))?.id ?? null;
}

/**
 * Lets the phone add this app to its home screen as its own app: a manifest with the app's name
 * and icon that opens straight on [startUrl] (not on Waraqa's home page).
 */
export async function useAppManifest(name, startUrl, icon) {
  if (!/^https?:$/.test(location.protocol)) return;
  // The icon's real size: a size that doesn't match makes phones ignore the icon.
  const size = await new Promise(done => {
    const img = new Image();
    img.onload = () => done(img.naturalWidth ? `${img.naturalWidth}x${img.naturalHeight}` : null);
    img.onerror = () => done(null);
    img.src = icon || "icon-512.png";
  });
  const abs = u => new URL(u, location.href).href;
  const iconUrl = abs(icon || "icon-512.png");
  const type = /^data:image\/svg|\.svg$/i.test(iconUrl) ? "image/svg+xml" : "image/png";
  const manifest = {
    name, short_name: name.slice(0, 24), start_url: abs(startUrl), scope: abs("./"), id: abs(startUrl),
    display: "standalone", background_color: "#10251F", theme_color: "#10251F",
    dir: document.documentElement.dir || "rtl", lang: document.documentElement.lang || "ar",
    icons: [{ src: iconUrl, sizes: type === "image/svg+xml" ? "any" : size || "512x512", type, purpose: "any" }],
  };
  let link = document.querySelector('link[rel="manifest"]');
  if (!link) { link = document.createElement("link"); link.rel = "manifest"; document.head.append(link); }
  link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" }));
  for (const [n, v] of [["apple-mobile-web-app-capable", "yes"], ["mobile-web-app-capable", "yes"], ["apple-mobile-web-app-title", name]]) {
    let m = document.querySelector(`meta[name="${n}"]`);
    if (!m) { m = document.createElement("meta"); m.name = n; document.head.append(m); }
    m.content = v;
  }
}

const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/** Opens a printable report in a new tab (the browser's print dialog can save it as PDF). */
function reportWindow(lang) {
  const w = window.open("", "_blank");
  if (w) w.document.write(`<p style="font-family:sans-serif;padding:24px">${lang === "en" ? "Preparing the report…" : "جارٍ تجهيز التقرير…"}</p>`);
  return w;
}
function showReport(w, lang, title, body) {
  const stamp = new Date().toLocaleString(lang === "en" ? "en" : "ar-u-nu-latn");
  w.document.open();
  w.document.write(`<!DOCTYPE html><html lang="${lang}" dir="${lang === "en" ? "ltr" : "rtl"}"><head><meta charset="utf-8">
<title>${esc(title)}</title><style>
body{font-family:system-ui,"Segoe UI",Tahoma,sans-serif;color:#183328;margin:24px}
h1{color:#00838F;font-size:22px;margin:0 0 4px}.stamp{color:#6B7C74;font-size:12px;margin-bottom:12px;border-bottom:2px solid #00838F;padding-bottom:8px}
table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #C8D3CD;padding:6px;text-align:start;vertical-align:top}
th{background:#1E7145;color:#fff}.cap{background:#EEF5F1;font-weight:bold;width:32%}tr.s td{background:#F5F8F6}
img{max-width:100%;max-height:300px}@page{margin:14mm}@media print{.no{display:none}}
button{font-size:15px;padding:8px 18px;margin-bottom:12px}
</style></head><body><button class="no" onclick="print()">${lang === "en" ? "Print / Save as PDF" : "طباعة / حفظ PDF"}</button>
<h1>${esc(title)}</h1><div class="stamp">${esc(stamp)}</div>${body}
<script>window.addEventListener("load",()=>setTimeout(()=>print(),400))<\/script></body></html>`);
  w.document.close();
}
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
const prop2 = (screen, key) => ((screen.properties || {})[key] || "").trim();

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
export function search(rows, criteria, after = 1, mode = "exact") {
  return searchAll(rows, criteria, mode).find(n => n > after) ?? null;
}

/** Every matching data row (Excel row numbers), like FormLogic.searchAll. */
export function searchAll(rows, criteria, mode = "exact") {
  const wanted = Object.entries(criteria).filter(([, v]) => String(v).trim() !== "").map(([k, v]) => [Number(k), normalize(v)]);
  if (!wanted.length) return [];
  const matches = (cell, v) => mode === "contains" ? cell.includes(v) : mode === "startsWith" ? cell.startsWith(v)
    : cell === v || (cell !== "" && v !== "" && !isNaN(Number(cell)) && !isNaN(Number(v)) && Number(cell) === Number(v));
  const found = [];
  for (let n = 2; n <= rows.length; n++) {
    const row = rows[n - 1] || [];
    if (row.length && wanted.every(([col, v]) => matches(normalize(row[col] ?? ""), v))) found.push(n);
  }
  return found;
}

/** How a text field suggests while typing (see Component.autocompleteMode in the app). */
function autocompleteMode(c) {
  if (c.type !== "TEXT_FIELD" || prop(c, "formula").trim()) return "off";
  if (["number", "decimal", "password"].includes(prop(c, "inputType"))) return "off";
  const p = c.properties || {};
  if (p.autocomplete) return p.autocomplete;
  return p.suggest === "true" ? "record" : "field";
}

/** Rows whose cell in the column contains what was typed: [row number, text], distinct, starts first. */
export function suggestions(rows, column, typed, limit = 6) {
  const wanted = normalize(typed);
  if (!wanted) return [];
  const seen = new Set(), starts = [], inside = [];
  for (let n = 2; n <= rows.length; n++) {
    const cell = (rows[n - 1] || [])[column] ?? "";
    const v = normalize(cell);
    if (!v || !v.includes(wanted) || seen.has(v)) continue;
    seen.add(v);
    (v.startsWith(wanted) ? starts : inside).push([n, cell]);
  }
  return [...starts, ...inside].slice(0, limit);
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
      const formula = prop(c, "formula");
      const read = [];
      const v = evaluateFormula(formula, name => {
        const other = byName[normalize(name)];
        const value = other ? (results[other.id] ?? valueOf(other)) : "";
        read.push(String(value ?? ""));
        return value;
      });
      // Nothing to work with yet: no result rather than 0. A sum counts the values it has; a product
      // or division needs all of them (as FormLogic.computeFormulas).
      const blank = x => x.trim() === "";
      const multiplies = /[*\/×÷]/.test(formula.replace(/\[[^\]]*\]/g, ""));
      const missing = read.length > 0 && (read.every(blank) || (multiplies && read.some(blank)));
      results[c.id] = missing ? "" : v == null ? "؟" : formatNumber(v);
    }
  }
  return results;
}

// ---- Summary tables (see FormLogic.summary) ----

const SUMMARY_FUNCTIONS = {
  "مجموع": "sum", "المجموع": "sum", sum: "sum", "متوسط": "average", "المتوسط": "average", average: "average",
  "أكبر": "max", "اكبر": "max", max: "max", "أصغر": "min", "اصغر": "min", min: "min",
  "آخر": "last", "اخر": "last", last: "last", "أول": "first", "اول": "first", first: "first", "عدد": "count", count: "count",
};

/** A summary table's columns, one per line: "title = function column" or "function column". */
export function summaryColumns(spec) {
  return String(spec || "").split("\n").map(raw => raw.trim()).filter(Boolean).map(line => {
    const eq = line.indexOf("=");
    const title = eq > 0 ? line.slice(0, eq).trim() : line;
    const body = (eq > 0 ? line.slice(eq + 1) : line).trim();
    const space = body.indexOf(" ");
    const fn = SUMMARY_FUNCTIONS[normalize(space < 0 ? body : body.slice(0, space))];
    return fn ? { title: title || body, fn, arg: space < 0 ? "" : body.slice(space + 1).trim() } : null;
  }).filter(Boolean);
}

/** One line per value of groupColumn among the rows numbered `numbers` (header line first). */
export function summary(rows, numbers, groupColumn, columns, total = false, hideZero = false, totalTitle = "الإجمالي") {
  const head = rows[0] || [];
  const index = name => { const i = head.findIndex(x => normalize(x) === normalize(name)); return i < 0 ? null : i; };
  const cell = (n, col) => String((rows[n - 1] || [])[col] ?? "").trim();
  const valueIn = (c, n) => {
    const col = index(c.arg);
    if (col != null) return cell(n, col);
    if (!c.arg) return "";
    const v = evaluateFormula(c.arg, name => { const i = index(name); return i == null ? "" : cell(n, i); });
    return v == null ? "" : formatNumber(v);
  };
  const groups = new Map();
  for (const n of numbers) {
    const key = cell(n, groupColumn);
    if (!key) continue;
    const k = normalize(key);
    if (!groups.has(k)) groups.set(k, { key, members: [] });
    groups.get(k).members.push(n);
  }
  const compute = (c, members) => {
    if (c.fn === "count") return String(members.length);
    const vals = members.map(n => valueIn(c, n)).filter(v => v.trim());
    const nums = vals.map(numberOf).filter(v => v != null);
    switch (c.fn) {
      case "sum": return formatNumber(nums.reduce((a, b) => a + b, 0));
      case "average": return nums.length ? formatNumber(nums.reduce((a, b) => a + b, 0) / nums.length) : "";
      default: {
        if (!vals.length) return "";
        const high = c.fn === "max" || c.fn === "last";
        if (nums.length === vals.length) return formatNumber(high ? Math.max(...nums) : Math.min(...nums));
        const sorted = [...vals].sort();
        return high ? sorted[sorted.length - 1] : sorted[0];
      }
    }
  };
  let lines = [...groups.values()].map(g => [g.key, ...columns.map(c => compute(c, g.members))]);
  if (hideZero && columns.length) lines = lines.filter(l => { const v = numberOf(l[l.length - 1]); return v != null ? v !== 0 : String(l[l.length - 1]).trim() !== ""; });
  const header = [head[groupColumn] ?? "", ...columns.map(c => c.title)];
  if (!total) return [header, ...lines];
  const totals = [totalTitle, ...columns.map((c, i) => (c.fn === "sum" || c.fn === "count") ? formatNumber(lines.reduce((a, l) => a + (numberOf(l[i + 1]) ?? 0), 0)) : "")];
  return [header, ...lines, totals];
}

/** A date written with `pattern` ("yyyy/MM" or one with days) moved on by `steps` months, or null. */
export function addPeriods(value, pattern, steps) {
  const m = toWestern(value).trim().match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
  const p = pattern || "yyyy/MM/dd";
  if (!m || !(p === "yyyy/MM" || p === "yyyy/MM/dd")) return null;
  const pad = n => String(n).padStart(2, "0");
  let y = Number(m[1]), mo = Number(m[2]) - 1 + steps;
  y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
  if (p === "yyyy/MM") return `${y}/${pad(mo + 1)}`;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return `${y}/${pad(mo + 1)}/${pad(Math.min(Number(m[3] || 1), last))}`;
}

// ---- Fields added as columns by an "add a field" button (see FormLogic.withAddedFields) ----

const overlapV = (a, b) => Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const overlapH = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
const gapH = (a, b) => (a.x + a.width <= b.x ? b.x - (a.x + a.width) : b.x + b.width <= a.x ? a.x - (b.x + b.width) : 0);

/** The label captioning an input: on the same line (nearest), else just above it. */
export function labelComponentFor(screen, input) {
  // Never itself: a label showing a value is captioned by another one.
  const labels = screen.components.filter(c => c.type === "LABEL" && String(c.text || "").trim() && c.id !== input.id);
  const same = labels.filter(l => overlapV(l, input) > Math.min(l.height, input.height) / 2).sort((a, b) => gapH(a, input) - gapH(b, input))[0];
  if (same) return same;
  return labels.filter(l => l.y + l.height <= input.y + 4 && input.y - (l.y + l.height) <= 48 && overlapH(l, input) > 0)
    .sort((a, b) => (input.y - (a.y + a.height)) - (input.y - (b.y + b.height)))[0] || null;
}

export function withAddedFields(screen, headers) {
  const button = screen.components.find(c => runsAction(c, "addField"));
  if (!button) return screen;
  const bound = bindings(screen, headers);
  const wanted = prop(button, "templateField");
  const textFields = bound.filter(([c]) => c.type === "TEXT_FIELD").sort((a, b) => b[0].y - a[0].y || b[0].x - a[0].x);
  const hit = (wanted && bound.find(([c]) => normalize(c.name) === normalize(wanted))) || textFields[0];
  if (!hit) return screen;
  const [template, templateColumn] = hit;
  const used = new Set(bound.map(([, col]) => col));
  const extra = headers.map((hd, i) => i).filter(i => i > templateColumn && !used.has(i) && String(headers[i]).trim());
  if (!extra.length) return screen;
  const label = labelComponentFor(screen, template);
  const rowBottom = Math.max(template.y + template.height, label ? label.y + label.height : 0);
  const rowHeight = rowBottom - Math.min(template.y, label ? label.y : template.y);
  const above = screen.components.filter(c => INPUT_TYPES.has(c.type) && c.y < template.y - 1 && overlapH(c, template) > 0).sort((a, b) => b.y - a.y)[0];
  const gap = above ? template.y - above.y : 0;
  const step = above && gap >= rowHeight ? gap : rowHeight + 8;
  const names = new Set(screen.components.map(c => normalize(c.name)));
  const nameLike = c => { const base = c.name.replace(/\d+$/, "") || c.type.toLowerCase(); let n = 1; while (names.has(normalize(base + n))) n++; names.add(normalize(base + n)); return base + n; };
  const moved = screen.components.map(c => (c.id !== template.id && c.id !== label?.id && c.y >= rowBottom - 0.5 ? { ...c, y: c.y + step * extra.length } : c));
  const strip = (props, keys) => Object.fromEntries(Object.entries(props || {}).filter(([k]) => !keys.includes(k)));
  const added = extra.flatMap((col, i) => {
    const dy = step * (i + 1), title = headers[col];
    return [
      label && { ...label, id: `${label.id}~${col}`, name: nameLike(label), text: title, y: label.y + dy, properties: strip(label.properties, ["formula", "stat", "lookupField"]) },
      { ...template, id: `${template.id}~${col}`, name: nameLike(template), y: template.y + dy, properties: { ...strip(template.properties, ["formula", "lookupField", "autoNumber"]), column: title } },
    ].filter(Boolean);
  });
  return { ...screen, components: [...moved, ...added] };
}

/** Whether some screen of the project has a button doing `action` (then the app adds none of its own). */
export function designedAction(project, action) {
  return (project.screens || []).some(s => s.components.some(c => runsAction(c, action)));
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
    case "yyyy/MM": return `${year}/${month}`;
    default: return `${year}/${month}/${day}`;
  }
}

function today() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function startValue(c, lang) {
  switch (c.type) {
    case "TEXT_FIELD": return bool(c, "autoNumber") ? "" : c.text || "";
    case "RADIO": return listOptions(prop(c, "items"))[Math.trunc(num(c, "selectedIndex"))] ?? "";
    case "TIME_PICKER": { if (!bool(c, "defaultNow")) return ""; const d = new Date(); return formatTime(c, d.getHours(), d.getMinutes(), lang); }
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

// ---- Button blocks (see Logic.kt): what happens, in order, when a button is pressed ----

const LOGIC_LAST = new Set(["openScreen", "back", "closeApp", "signOut", "lockSettings", "deleteRow", "chooseColumns", "addField"]);
export const LOGIC_YES = new Set(["true", "نعم", "yes", "1", "صح", "✓"]);

/** The blocks kept in a button's "logic" property; damaged text reads as none. */
export function logicOf(c) {
  const text = (c.properties || {}).logic;
  if (!text) return [];
  try { const steps = JSON.parse(text); return Array.isArray(steps) ? steps : []; } catch (e) { return []; }
}

/** Every action a button's blocks run, nested ones included. */
function logicActions(steps, into = new Set()) {
  for (const s of steps || []) { if (s.kind === "action") into.add(s.action); logicActions(s.then, into); logicActions(s.otherwise, into); }
  return into;
}

/** Whether a button runs action: its single action, or one of its blocks when it has some. */
export function runsAction(c, action) {
  if (c.type !== "BUTTON") return false;
  const blocks = logicOf(c);
  return blocks.length ? logicActions(blocks).has(action) : prop(c, "action") === action;
}

const logicNumber = text => {
  const s = toWestern(text).trim().replace(/[٫,]/g, ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** A block's value: a calculation after "=", otherwise the text with each [name] replaced by that field's value. */
export function logicResolve(value, valueOf) {
  const text = String(value ?? "");
  const trimmed = text.trimStart();
  if (trimmed.startsWith("=")) {
    const v = evaluateFormula(trimmed.slice(1), name => valueOf(name) ?? "");
    return v == null ? "؟" : formatNumber(v);
  }
  return text.replace(/\[([^\[\]]+)\]/g, (m, name) => valueOf(name.trim()) ?? m);
}

/** Whether left relates to right as op says: as numbers when both are, else as text (case and spacing ignored). */
export function logicTest(op, left, right) {
  const a = normalize(left), b = normalize(right);
  const x = logicNumber(left), y = logicNumber(right);
  const numeric = x != null && y != null;
  const cmp = () => (numeric ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : a > b ? 1 : 0);
  switch (op) {
    case "eq": return numeric ? x === y : a === b;
    case "ne": return numeric ? x !== y : a !== b;
    case "gt": return cmp() > 0;
    case "lt": return cmp() < 0;
    case "ge": return cmp() >= 0;
    case "le": return cmp() <= 0;
    case "contains": return b !== "" && a.includes(b);
    case "empty": return a === "";
    case "notEmpty": return a !== "";
    default: return false;
  }
}

/**
 * Runs blocks in order; false when one stopped them. host: { get(name) -> value or null, set(name, value),
 * show(name, shown), say(text) -> Promise, ask(text) -> Promise<bool>, act(action, target) -> Promise<bool> }.
 */
export async function runLogic(steps, host) {
  const valueOf = name => host.get(name);
  for (const step of steps || []) {
    switch (step.kind) {
      case "set": host.set(step.field || "", logicResolve(step.value, valueOf)); break;
      case "message": await host.say(logicResolve(step.value, valueOf)); break;
      case "show": host.show(step.field || "", true); break;
      case "hide": host.show(step.field || "", false); break;
      case "confirm": if (!(await host.ask(logicResolve(step.value, valueOf)))) return false; break;
      case "action":
        if (!(await host.act(step.action || "", step.target || ""))) return false;
        if (LOGIC_LAST.has(step.action)) return false;
        break;
      case "stop": return false;
      case "if": {
        const holds = logicTest(step.op || "", host.get(step.field || "") ?? "", logicResolve(step.value, valueOf));
        if (!(await runLogic(holds ? step.then : step.otherwise, host))) return false;
        break;
      }
    }
  }
  return true;
}

// ---- Runner ----

/**
 * Renders `screen` of `project` into `root` and wires its buttons to `store`.
 * opts: { lang, t(ar,en), toast(msg), confirm(msg) -> Promise<bool> }
 */
export function runScreen(root, project, screen, store, opts) {
  const { lang, t, toast } = opts;
  // The file this screen saves to ("" = main); other files are only read (lookups, lists).
  const fileId = (project.files || []).some(f => f.id === (screen.properties || {}).dataFile) ? screen.properties.dataFile : "";
  const mainStore = store;
  const storeCache = {};
  const storeOf = id => (id ? (storeCache[id] ??= opts.storeFor?.(id) || null) : mainStore);
  if (fileId) store = storeOf(fileId);
  const otherRows = {};
  let freshOff = []; // stops the updates from the server when this screen closes
  const headers = store ? store.headers : [];
  // Columns added by an "add a field" button each get a row like the template field's.
  const designed = screen;
  screen = withAddedFields(screen, headers);
  const binds = bindings(screen, headers);
  // Typed values are shared by all screens of the app, so they survive moving between screens.
  const values = opts.values || {};
  for (const c of screen.components) if (INPUT_TYPES.has(c.type) && !(c.id in values)) values[c.id] = startValue(c, lang);
  let computed = {};
  const formulaShown = {}; // component id -> function(text) for calculated fields
  const rowsOf = id => (id === fileId ? state.sheetRows : otherRows[id]);
  const lastLooked = {}; // field id -> the value last found for it in a file
  const recompute = () => {
    const looked = lookups(screen, c => values[c.id] ?? "", rowsOf);
    const labels = {};
    for (const [id, v] of Object.entries(looked)) {
      if (screen.components.find(o => o.id === id)?.type === "LABEL") { labels[id] = v; continue; }
      // A field filled from a file takes the found value when its key changes, and can still be typed over.
      const before = lastLooked[id];
      if (before === undefined ? v !== "" && !(values[id] || "").trim() : before !== v) { values[id] = v; inputs[id]?.(v); }
      lastLooked[id] = v;
    }
    // Calculations can use statistics (e.g. profits minus expenses).
    computed = { ...computeFormulas(screen, c => (c.type === "LABEL" ? (prop(c, "stat") ? statRaw(c) ?? c.text : c.text) : values[c.id] ?? "")), ...labels };
    for (const [id, show] of Object.entries(formulaShown)) show(computed[id] ?? "");
    refreshShownLater();
  };
  let refreshShownLater = () => {};
  /** A label's statistic as a bare number, or null while its file is read (see statRaw on Android). */
  function statRaw(c) {
    const chosen = prop(c, "statFile");
    const file = chosen === "@main" ? "" : chosen && (project.files || []).some(f => f.id === chosen) ? chosen : fileId;
    const rows = file === fileId ? state.sheetRows : rowsFor(file);
    if (!rows || rows.length < 1) return null;
    const head = rows[0] || [];
    const colOfName = name => { const i = head.findIndex(x => normalize(x) === normalize(name)); return i < 0 ? null : i; };
    // The filter's value may come from a field, such as the month a report is for.
    const source = byName(prop(c, "statFilterField"));
    const wanted = source ? values[source.id] ?? "" : prop(c, "statFilterValue");
    let numbers = rowsWhere(rows, prop(c, "statFilterColumn") ? colOfName(prop(c, "statFilterColumn")) : null, wanted);
    let kind = prop(c, "stat");
    if (kind === "mine") {
      // Records added by whoever is signed in (all of them when records keep no author, e.g. on this device only).
      const authors = (file === fileId ? store : storeOf(file))?.authors?.();
      if (authors && opts.user) numbers = numbers.filter(n => authors[n - 2] === opts.user.uid);
      kind = "count";
    }
    return statistic(rows, numbers, kind, prop(c, "statColumn") ? colOfName(prop(c, "statColumn")) : null);
  }
  const state = { currentRow: null, lastCriteria: null, filledSnapshot: null, sheetRows: null, working: false };
  // Rows ticked with a long press (Excel row numbers of this screen's file), to delete several at once.
  const picked = new Set();
  let pickBar = null;
  const mayDelete = opts.canEdit !== false && opts.canDelete !== false;
  const barStyle = { position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "14px", zIndex: "40", background: "#10251FF0", color: "#fff",
    borderRadius: "16px", padding: "6px 10px", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", boxShadow: "0 4px 14px #0005", maxWidth: "94vw" };
  const barButton = (text, color, onclick) => h("button", { background: "none", border: "0", color, fontSize: "14px", cursor: "pointer", padding: "6px 8px", fontWeight: "bold" }, { onclick }, text);
  function showPickBar() {
    pickBar?.remove(); pickBar = null;
    if (!picked.size) return;
    pickBar = h("div", barStyle, { dir: lang === "en" ? "ltr" : "rtl" },
      h("span", {}, {}, t(`محدد: ${picked.size}`, `Selected: ${picked.size}`)),
      mayDelete ? barButton(t("حذف المحدد", "Delete selected"), "#FF8A80", async () => {
        const rows = [...picked];
        if (!(await opts.confirm(t(`حذف ${rows.length} صفوف؟ تصعد الصفوف التي بعدها.`, `Delete ${rows.length} rows? The rows below move up.`)))) return;
        try {
          const now = await store.rows();
          const gone = [...rows].sort((a, b) => a - b).filter(n => now[n - 1]);
          for (const n of rows.sort((a, b) => b - a)) await store.delete(n);
          remember({ kind: "removed", rows: gone, records: gone.map(n => recordOf(now[n - 1])) });
          picked.clear(); showPickBar(); clearForm();
          saved(t(`تم حذف ${rows.length} صفوف`, `${rows.length} rows deleted`));
          await reloadTables();
        } catch (e) { toast(opts.errorText(e)); }
      }) : null,
      barButton(t("إلغاء التحديد", "Clear selection"), "#fff", () => { picked.clear(); showPickBar(); tables.forEach(draw => draw()); }));
    document.body.append(pickBar);
  }
  // Column widths each person drags in tables, kept in this browser per app and table.
  const widthKey = id => `waraqa-colw:${project.id || project.name}:${id}`;
  function tableWidths(id) { try { return JSON.parse(localStorage.getItem(widthKey(id)) || "{}") || {}; } catch (e) { return {}; } }
  function setTableWidths(id, all) {
    try { localStorage.setItem(widthKey(id), JSON.stringify(all)); } catch (e) {}
  }
  function togglePicked(n) { picked.has(n) ? picked.delete(n) : picked.add(n); showPickBar(); tables.forEach(draw => draw()); }
  // Changes to this screen's records, for the app's ↶ / ↷ buttons (like the editor's). A change is
  // only taken back or redone while its rows still hold what it left there.
  const undoStack = [], redoStack = [];
  const recordOf = row => Object.fromEntries((row || []).map((v, i) => [i, v ?? ""]));
  const holds = (rows, numbers, records) => numbers.length === records.length &&
    numbers.every((n, i) => rows[n - 1] && Object.entries(records[i]).every(([col, v]) => normalize(rows[n - 1][col] ?? "") === normalize(v)));
  // Back in the row it was in (stores that can't insert add it at the end).
  const putBack = (n, record) => store.insert ? store.insert(n, record) : store.append(record);
  const deleteAll = async numbers => { for (const n of [...new Set(numbers)].sort((a, b) => b - a)) await store.delete(n); };
  function remember(change) { undoStack.push(change); if (undoStack.length > 50) undoStack.shift(); redoStack.length = 0; refreshShown(); }
  function offerUndo(message, rows, records) { remember({ kind: "added", rows, records }); saved(message); }
  async function undoOrRedo(redo) {
    if (!store) return;
    const change = (redo ? redoStack : undoStack).pop();
    refreshShown();
    if (!change) return toast(redo ? t("لا يوجد ما يُعاد.", "Nothing to redo.") : t("لا يوجد ما يُتراجع عنه.", "Nothing to undo."));
    try {
      const rows = await store.rows();
      let ok = true;
      if (change.kind === "added") {
        if (!redo) { ok = holds(rows, change.rows, change.records); if (ok) await deleteAll(change.rows); }
        else { change.rows = []; for (const r of change.records) change.rows.push(await store.append(r)); }
      } else if (change.kind === "changed") {
        ok = holds(rows, [change.row], [redo ? change.before : change.after]);
        if (ok) await store.update(change.row, redo ? change.after : change.before);
      } else if (change.kind === "removed") {
        if (!redo) { change.restored = []; for (let i = 0; i < change.records.length; i++) change.restored.push(await putBack(change.rows[i], change.records[i])); }
        else { ok = holds(rows, change.restored, change.records); if (ok) await deleteAll(change.restored); }
      }
      if (ok) (redo ? undoStack : redoStack).push(change); else (redo ? undoStack : redoStack).length = 0;
      refreshShown();
      toast(!ok ? t("تغيّرت هذه السجلات بعد ذلك، فلا يمكن ", "These records changed since, so it can't be ") + (redo ? t("إعادتها.", "redone.") : t("التراجع عنها.", "undone."))
        : redo ? t("تمت الإعادة ↷", "Redone ↷") : t("تم التراجع ↶", "Undone ↶"));
      state.currentRow = null;
      clearForm();
      await reloadTables();
    } catch (e) { toast(opts.errorText(e)); }
  }
  const inputs = {}; // component id -> function(value) updating its element
  const tables = [];

  const toExcel = c => {
    const v = computed[c.id] ?? values[c.id] ?? "";
    return c.type === "CHECKBOX" ? (v === "true" ? t("نعم", "Yes") : t("لا", "No")) : v;
  };
  // "Show only when" conditions; hidden fields save nothing.
  const byName = name => name && screen.components.find(o => normalize(o.name) === normalize(name));
  // What buttons' blocks did on this screen: label texts they set and components they hid.
  const logicTexts = {}; // label id -> text
  const logicHidden = new Set();
  const labelSetters = {}; // label id -> function(text)
  const isShown = c => {
    if (logicHidden.has(c.id)) return false;
    const source = byName(prop(c, "showIfField"));
    if (!source) return true;
    const wanted = prop(c, "showIfValues").split(/[,،]/).map(normalize).filter(Boolean);
    const actual = normalize(source.type === "LABEL" ? logicTexts[source.id] ?? source.text : toExcel(source));
    return wanted.length ? wanted.includes(actual) : actual !== "";
  };
  // Undo/redo buttons may show only while there is something to undo / redo.
  const historyAllows = c => { const w = prop(c, "showWithHistory"); return w === "canUndo" ? undoStack.length > 0 : w === "canRedo" ? redoStack.length > 0 : true; };
  const boxes = {}; // component id -> its positioned box
  const refreshShown = () => { for (const c of screen.components) if (boxes[c.id]) boxes[c.id].style.display = isShown(c) && historyAllows(c) ? "" : "none"; };
  const formValues = () => Object.fromEntries(binds.map(([c, col]) => [col, isShown(c) ? toExcel(c) : ""]));
  const optionRefreshers = {}; // list id -> redraws its options
  const statLabels = []; // labels showing a statistic of the sheet
  const colOf = name => { const i = headers.findIndex(x => normalize(x) === normalize(name)); return i < 0 ? null : i; };
  const optionsFor = c => {
    const parent = byName(prop(c, "parentField"));
    const rows = rowsOf(prop(c, "optionsColumn") ? prop(c, "optionsFile") : fileId);
    const header = rows?.[0] || headers;
    const index = name => { if (!name) return null; const i = header.findIndex(x => normalize(x) === normalize(name)); return i < 0 ? null : i; };
    return listOptions(prop(c, "items"), rows, index(prop(c, "optionsColumn")),
      parent ? index(prop(parent, "optionsColumn")) ?? index(prop(parent, "column")) : null, parent ? toExcel(parent) : null);
  };
  // Tables filtered by a field (its value or the column it names) follow it as it changes.
  const redrawFilteredBy = c => {
    if (screen.components.some(o => o.type === "TABLE" && [prop(o, "filterField"), prop(o, "filterColumnField"), prop(o, "tableFileField")].some(n => n && normalize(n) === normalize(c.name)))) tables.forEach(draw => draw());
  };
  // ---- Tables from a file: which file, filter, sort and shown columns ----
  const tableSorts = {}; // table id -> { column (in the file), descending }
  const tableColumns = {}; // table id -> column names the user chose to show
  const loadingFiles = new Set();
  const tableFileOf = c => {
    const field = byName(prop(c, "tableFileField"));
    if (field) { const id = fileIdByName(project, toExcel(field)); if (id != null) return id; }
    const chosen = prop(c, "tableFile");
    if (chosen === "@main") return "";
    return chosen && (project.files || []).some(f => f.id === chosen) ? chosen : fileId;
  };
  /** Rows of a file, read in the background the first time (tables redraw when they arrive). */
  const rowsFor = id => {
    if (id === fileId) return state.sheetRows || (store ? [store.headers] : null);
    if (otherRows[id]) return otherRows[id];
    const s = storeOf(id);
    if (s && !loadingFiles.has(id)) {
      loadingFiles.add(id);
      const show = rows => { otherRows[id] = rows; tables.forEach(draw => draw()); statLabels.forEach(update => update()); recompute(); };
      freshOff.push(s.onFresh?.(show));
      s.rows(true).then(show).catch(e => toast(opts.errorText(e))).finally(() => loadingFiles.delete(id));
    }
    return s ? [s.headers || []] : null;
  };
  /** What a sheet table shows (see TableView on Android): matching rows, sorted, in its shown columns. */
  const tableView = c => {
    const file = tableFileOf(c);
    const rows = rowsFor(file);
    if (!rows) return null;
    const head = rows[0] || [];
    const col = name => { if (!name) return null; const i = head.findIndex(x => normalize(x) === normalize(name)); return i < 0 ? null : i; };
    // Advanced search: the column is the one chosen in a list (none or "all" = every column).
    const columnField = byName(prop(c, "filterColumnField"));
    const column = columnField ? col(toExcel(columnField)) : col(prop(c, "filterColumn"));
    const source = byName(prop(c, "filterField"));
    const wanted = source ? toExcel(source) : prop(c, "filterValue");
    let numbers = rowsMatching(rows, column, wanted, prop(c, "filterMatch") === "contains", !!columnField);
    const sort = tableSorts[c.id];
    // A summary table: one line per value of a column (e.g. per member), from the filtered rows.
    const group = col(prop(c, "groupBy"));
    if (group != null) {
      const lines = summary(rows, numbers, group, summaryColumns(prop(c, "groupValues")), bool(c, "groupTotal"), bool(c, "groupHideZero"), t("الإجمالي", "Total"));
      const totalLine = bool(c, "groupTotal") ? lines.length : null;
      let body = lines.map((_, i) => i + 1).slice(1).filter(n => n !== totalLine);
      if (sort && sort.column >= 0) body = sortRows(lines, body, sort.column, sort.descending);
      const nums = totalLine ? [...body, totalLine] : body;
      const cols = lines[0].map((_, i) => i);
      const lineOf = n => cols.map(i => (lines[n - 1] || [])[i] ?? "");
      return { fileId: "@summary", rows: lines, columns: cols, numbers: nums, head: lines[0], header: () => lines[0], line: lineOf, shownRows: () => [lines[0], ...nums.map(lineOf)] };
    }
    if (sort && sort.column >= 0) numbers = sortRows(rows, numbers, sort.column, sort.descending);
    const chosen = tableColumns[c.id] || prop(c, "shownColumns").split(/[,،]/).map(x => x.trim()).filter(Boolean);
    let columns = head.map((_, i) => i).filter(i => !chosen.length || chosen.some(n => normalize(n) === normalize(head[i])));
    if (!columns.length) columns = head.map((_, i) => i);
    const line = n => columns.map(i => (rows[n - 1] || [])[i] ?? "");
    return { fileId: file, rows, columns, numbers, head, header: () => columns.map(i => head[i] ?? ""), line, shownRows: () => [columns.map(i => head[i] ?? ""), ...numbers.map(line)] };
  };
  /** The table that export and "show / hide columns" buttons act on. */
  const mainTable = () => screen.components.find(o => o.type === "TABLE" && prop(o, "dataSource") === "sheet" && bool(o, "visible") && isShown(o));
  function chooseColumns(table) {
    const view = tableView(table);
    if (!view) return;
    const picked = new Set(view.columns.map(i => normalize(view.head[i])));
    const close = () => overlay.remove();
    const list = h("div", { maxHeight: "55vh", overflow: "auto" }, {}, ...view.head.filter(x => String(x).trim()).map(name => {
      const box = h("input", { width: "18px", height: "18px" }, { type: "checkbox", onchange: e => { e.target.checked ? picked.add(normalize(name)) : picked.delete(normalize(name)); } });
      box.checked = picked.has(normalize(name));
      return h("label", { display: "flex", alignItems: "center", gap: "10px", padding: "8px 2px", cursor: "pointer", borderBottom: "1px solid #ffffff14" }, {}, box, String(name));
    }));
    const overlay = h("div", { position: "fixed", inset: "0", background: "#0008", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "50" },
      { dir: lang === "en" ? "ltr" : "rtl", onclick: e => { if (e.target === overlay) close(); } },
      h("div", { background: "#172C24", color: "#fff", borderRadius: "14px", padding: "16px", width: "min(92vw, 380px)" }, {},
        h("div", { fontWeight: "bold", marginBottom: "8px" }, {}, t("الأعمدة الظاهرة", "Columns shown")),
        list,
        h("div", { display: "flex", gap: "16px", justifyContent: "flex-end", marginTop: "10px" }, {},
          h("button", { background: "none", border: "0", color: "#9FB5AA", fontSize: "15px", cursor: "pointer" }, { onclick: close }, t("إلغاء", "Cancel")),
          h("button", { background: "none", border: "0", color: "#20B879", fontSize: "15px", cursor: "pointer", fontWeight: "bold" }, { onclick: () => {
            const names = view.head.filter(x => picked.has(normalize(x)));
            if (!names.length) return toast(t("اختر عمودًا واحدًا على الأقل.", "Choose at least one column."));
            tableColumns[table.id] = names; close(); tables.forEach(draw => draw());
          } }, t("تم", "Done")))));
    document.body.append(overlay);
  }
  /** The table's shown rows (headers first), reading its file when needed; null with a message when there is none. */
  async function shownTableRows() {
    const table = mainTable();
    if (!table) return null;
    const file = tableFileOf(table);
    if (file !== fileId && !otherRows[file]) { const s = storeOf(file); if (s) otherRows[file] = await s.rows(); }
    if (file === fileId && !state.sheetRows && store) state.sheetRows = await store.rows();
    return tableView(table)?.shownRows() || null;
  }
  async function exportTable() {
    if (!mainTable()) return toast(t("أضف جدولًا مصدره ملف Excel في هذه الشاشة.", "Add a table showing an Excel file on this screen."));
    try {
      const rows = await shownTableRows();
      if (!rows || rows.length < 2) return toast(t("لا توجد سجلات لعرضها.", "There are no records to show."));
      downloadBlob(xlsxBlobOf(project.name || "data", rows, lang), (project.name || "data").replace(/[\\/:*?"<>|]+/g, "_") + ".xlsx");
    } catch (e) { toast(opts.errorText(e)); }
  }

  let filling = false;
  const sameForm = (a, b) => a && b && JSON.stringify(a) === JSON.stringify(b);
  const setValue = (c, v) => {
    values[c.id] = v; inputs[c.id]?.(v); recompute();
    // The key of a "save or update" button: an existing row with this key is shown to be updated.
    const keyCol = binds.find(([b]) => b === c)?.[1];
    if (!filling && keyCol != null && state.sheetRows && String(v).trim() &&
        screen.components.some(o => runsAction(o, "upsertRow") && normalize(prop(o, "searchField")) === normalize(c.name))) {
      const found = searchAll(state.sheetRows, { [keyCol]: v })[0];
      if (found) { fill(state.sheetRows[found - 1]); state.currentRow = found; state.lastCriteria = null; state.filledSnapshot = formValues(); }
      else if (state.currentRow != null) {
        filling = true;
        for (const [o] of binds) if (o !== c) setValue(o, startValue(o, lang));
        filling = false;
        state.currentRow = null;
      }
    }
    redrawFilteredBy(c);
    if (screen.components.some(o => normalize(prop(o, "statFilterField")) === normalize(c.name) && prop(o, "statFilterField"))) { statLabels.forEach(update => update()); recompute(); }
    // Lists that depend on this one show matching options and drop a choice that no longer fits.
    for (const child of screen.components) {
      if (byName(prop(child, "parentField")) !== c) continue;
      optionRefreshers[child.id]?.();
      const opts2 = optionsFor(child);
      const fits = bool(child, "multiSelect") ? choicesOf(values[child.id]).every(v => opts2.includes(v)) : opts2.includes(values[child.id]);
      if (values[child.id] && !fits) setValue(child, "");
    }
  };
  const fill = row => {
    filling = true;
    for (const [c, col] of binds) {
      const cell = row[col] ?? "";
      setValue(c, c.type === "CHECKBOX" ? String(TRUTHY.has(normalize(cell))) : cell);
    }
    filling = false;
  };
  const clearForm = () => {
    for (const c of screen.components) if (INPUT_TYPES.has(c.type)) setValue(c, startValue(c, lang));
    state.currentRow = null; state.filledSnapshot = null;
  };
  const missingRequired = () => binds
    .filter(([c]) => ["TEXT_FIELD", "PHOTO", "RADIO", "SIGNATURE", "LOCATION"].includes(c.type) && bool(c, "required") && !bool(c, "autoNumber")
      && !(values[c.id] || "").trim() && isShown(c))
    .map(([c, col]) => headers[col] || c.name);
  /** A change's confirmation; changes kept in this browser while offline say they will upload later. */
  const saved = message => toast(store?.savedOffline?.() ? message.replace(/ ✓$/, "") + t(" ⏳ بدون اتصال، سيُرفع تلقائيًا عند رجوع الإنترنت", " ⏳ offline, uploads automatically when back online") : message);
  /** A "no repeats" field whose value another record (not `except`) already has, as a message, or null. */
  const duplicateError = (rows, except) => {
    for (const [c, col] of binds) {
      if (!bool(c, "noRepeat") || !isShown(c)) continue;
      const value = toExcel(c), n = duplicateRow(rows, col, value, except);
      if (n) return t(`«${headers[col] || c.name}» ${value} موجود مسبقًا في الصف ${n}، لا يمكن تكراره.`, `"${headers[col] || c.name}" ${value} is already in row ${n} and can't be repeated.`);
    }
    return null;
  };
  /** The first field whose number is outside its lowest / highest, as a message, or null. */
  const rangeError = () => {
    for (const [c, col] of binds) {
      if (c.type !== "TEXT_FIELD" || !isShown(c)) continue;
      const range = rangeProblem(values[c.id], prop(c, "minValue"), prop(c, "maxValue"), lang === "en");
      if (range) return t(`«${headers[col] || c.name}» يجب أن يكون رقمًا ${range}.`, `"${headers[col] || c.name}" must be a number ${range}.`);
    }
    return null;
  };

  async function reloadTables() {
    if (!store) return;
    // Rows show from the kept copy at once; when the server's differ they replace them.
    freshOff.forEach(off => off?.());
    freshOff = [];
    // Other files read by this screen.
    const reads = new Set(screen.components.flatMap(c => [
      prop(c, "lookupField") ? prop(c, "lookupFile") : null, prop(c, "optionsColumn") ? prop(c, "optionsFile") : null,
    ]).filter(id => id != null && id !== fileId));
    for (const id of reads) {
      const s = storeOf(id);
      if (!s) continue;
      const show = rows => { otherRows[id] = rows; recompute(); Object.values(optionRefreshers).forEach(r => r()); };
      freshOff.push(s.onFresh?.(show));
      s.rows(true).then(show).catch(() => {});
    }
    const listsFromSheet = screen.components.some(c => c.type === "CHART" || prop(c, "optionsColumn") || prop(c, "scan") === "record" || (c.type === "LABEL" && prop(c, "stat"))
      || runsAction(c, "upsertRow") || prop(c, "lookupField"));
    if (!tables.length && !listsFromSheet) { state.sheetRows = null; return; } // suggestions read the sheet again when needed
    const show = rows => {
      state.sheetRows = rows;
      tables.forEach(draw => draw());
      Object.values(optionRefreshers).forEach(redraw => redraw());
      statLabels.forEach(update => update());
      recompute();
    };
    freshOff.push(store.onFresh?.(show));
    try { show(await store.rows(true)); } catch (e) { toast(opts.errorText(e)); }
  }

  /** What a search button looks for (see FormLogic.searchCriteria). */
  // While a record is shown, only what the user changed since counts as the question.
  const startOf = (c, col) => (state.currentRow != null && state.filledSnapshot ? state.filledSnapshot[col] ?? "" : startValue(c, lang));

  function searchCriteria(field) {
    const valueOf = c => computed[c.id] ?? values[c.id] ?? "";
    if (field) {
      const hit = binds.find(([c]) => normalize(c.name) === normalize(field));
      return hit && String(valueOf(hit[0])).trim() ? { [hit[1]]: valueOf(hit[0]) } : {};
    }
    return Object.fromEntries(binds.filter(([c, col]) => c.type !== "CHECKBOX" && !PICTURE_TYPES.has(c.type) && c.type !== "LOCATION" && !prop(c, "formula").trim() &&
      String(valueOf(c)).trim() && normalize(valueOf(c)) !== normalize(startOf(c, col))).map(([c, col]) => [col, valueOf(c)]));
  }

  function showRow(rows, n) {
    fill(rows[n - 1]);
    state.currentRow = n; state.filledSnapshot = formValues();
    toast(t(`تم عرض الصف ${n}`, `Showing row ${n}`));
    tables.forEach(draw => draw());
  }

  /** Several rows matched: a list to pick one from. */
  /** Shows a found row here, or on the button's screen ("show the result in"), filling that screen's fields. */
  function openRecord(rows, n, targetName) {
    const target = targetName && project.screens.find(s => s.name === targetName);
    if (!target || target.id === screen.id || !opts.openScreen) return showRow(rows, n);
    for (const [c, col] of bindings(target, headers)) {
      const cell = rows[n - 1][col] ?? "";
      values[c.id] = c.type === "CHECKBOX" ? String(TRUTHY.has(normalize(cell))) : cell;
    }
    opts.openScreen(target.name, n);
  }

  function pickResult(rows, found) {
    const order = screen.components.filter(c => INPUT_TYPES.has(c.type)).sort((a, b) => a.y - b.y || a.x - b.x)
      .map(c => binds.find(([b]) => b === c)?.[1]).filter(col => col != null);
    const close = () => overlay.remove();
    const list = h("div", { overflow: "auto", maxHeight: "60vh" });
    for (const n of found.slice(0, 300)) {
      const row = rows[n - 1];
      list.append(h("div", { padding: "10px 4px", borderBottom: "1px solid #2C4A3D", cursor: "pointer" }, { onclick: () => { close(); openRecord(rows, n, state.resultsTarget); } },
        h("div", {}, {}, order.map(col => row[col] ?? "").filter(v => String(v).trim()).slice(0, 4).join(" • ")),
        h("div", { fontSize: "11px", color: "#8a9a92" }, {}, t(`الصف ${n}`, `Row ${n}`))));
    }
    const overlay = h("div", { position: "fixed", inset: "0", background: "#0008", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "50" },
      { dir: lang === "en" ? "ltr" : "rtl", onclick: e => { if (e.target === overlay) close(); } },
      h("div", { background: "#172C24", color: "#fff", borderRadius: "14px", padding: "16px", width: "min(92vw, 420px)" }, {},
        h("div", { fontWeight: "bold", marginBottom: "8px" }, {}, t(`وُجدت ${found.length} نتائج، اختر واحدة`, `${found.length} matches, pick one`)),
        list,
        h("button", { marginTop: "10px", background: "none", border: "0", color: "#20B879", fontSize: "15px", cursor: "pointer" }, { onclick: close }, t("إغلاق", "Close"))));
    document.body.append(overlay);
  }

  async function perform(action, target, button) {
    // A failure says why and returns false, so a button's blocks stop there.
    const fail = message => { toast(message); return false; };
    if (!action) return;
    if (action === "clear") { clearForm(); return true; }
    if (action === "openScreen") { if (!opts.openScreen) return false; opts.openScreen(target); return true; }
    if (action === "back") { if (!opts.back) return false; opts.back(); return true; }
    // The app owner's choices: who exports files, who deletes records.
    if (opts.canExport === false && ["pdfRecord", "pdfTable", "excelTable", "pdfScreen"].includes(action)) return fail(t("تصدير الملفات متاح لصاحب التطبيق فقط.", "Exporting files is for the app's owner only."));
    if (action === "deleteRow" && opts.canEdit !== false && opts.canDelete === false) return fail(t("حذف السجلات متاح لصاحب التطبيق فقط.", "Deleting records is for the app's owner only."));
    if (action === "pdfRecord") return recordReport();
    if (action === "pdfTable") return tableReport();
    if (action === "pdfScreen") return screenReport();
    // Buttons the designer placed instead of the app's own close, lock and sign-out buttons.
    if (action === "undo" || action === "redo") return mayDelete ? undoOrRedo(action === "redo") : toast(t("غير مصرّح لك بالحذف.", "You can't delete."));
    if (action === "closeApp") return opts.onClose ? opts.onClose() : toast(t("الإغلاق يعمل في التطبيق المنشور.", "Closing works in the published app."));
    if (action === "lockSettings") return opts.onLockSettings ? opts.onLockSettings() : toast(t("قفل التطبيق يعمل بعد تسجيل الدخول في التطبيق المنشور.", "The app lock works once signed in to the published app."));
    if (action === "signOut") return opts.onSignOut ? opts.onSignOut() : toast(t("تسجيل الخروج يعمل في التطبيق المنشور.", "Signing out works in the published app."));
    if (action === "addField") return fail(opts.canEdit === false ? t("غير مصرّح لك بالإضافة.", "You can't add.")
      : t("إضافة الحقول تتم من تطبيق ورقة: يضيفها صاحب التطبيق ثم يعيد النشر.", "Fields are added in the Waraqa app: its owner adds them, then publishes again."));
    if (action === "excelTable") return exportTable();
    if (action === "chooseColumns") {
      const table = mainTable();
      return table ? chooseColumns(table) : toast(t("أضف جدولًا مصدره ملف Excel في هذه الشاشة.", "Add a table showing an Excel file on this screen."));
    }
    if (!store) return fail(t("هذا التطبيق غير مرتبط ببيانات.", "This app has no data source."));
    const writes = ["addRow", "upsertRow", "updateRow", "deleteRow"].includes(action);
    if (writes && opts.canEdit === false) { noAccess(); return false; }
    if (!binds.length) return fail(t("لا يوجد حقل مرتبط بعمود.", "No field is linked to a column."));
    if (state.working) return false;
    // Filled-in fields linked to no column are not saved: the app's owner is told which (as PreviewScreen).
    const unsaved = ["addRow", "upsertRow", "updateRow"].includes(action) && opts.canEdit !== false && opts.canDelete !== false
      ? screen.components.filter(c => INPUT_TYPES.has(c.type) && !binds.some(([b]) => b === c) && isShown(c)
          && !prop(c, "formula") && !prop(c, "lookupField")
          && (c.type === "CHECKBOX" ? values[c.id] === "true" : String(toExcel(c)).trim() !== "")).map(c => c.name)
      : [];
    state.working = true;
    try {
      if (action === "upsertRow") {
        const key = byName(button ? prop(button, "searchField") : "");
        const keyCol = key && binds.find(([b]) => b === key)?.[1];
        if (keyCol == null) return fail(t("اختر في خصائص الزر «الحقل المميّز للسجل»، وهو الحقل الذي لا يتكرر في كل صف (مثل الرقم أو الكود).", "Choose the button's \"Key field of the record\": the field that is different in every row (like a number or code)."));
        const keyValue = toExcel(key);
        if (!String(keyValue).trim()) return fail(t("اختر قيمة الحقل المميّز أولًا.", "Fill in the identifying field first."));
        const missing = missingRequired();
        if (missing.length) return fail(t("املأ الحقول المطلوبة: ", "Fill in the required fields: ") + missing.join("، "));
        if (rangeError()) return fail(rangeError());
        const rows = await store.rows();
        const found = searchAll(rows, { [keyCol]: keyValue })[0];
        const repeated = duplicateError(rows, found || null);
        if (repeated) return fail(repeated);
        if (found) {
          const after = formValues();
          await store.update(found, after);
          remember({ kind: "changed", row: found, before: Object.fromEntries(Object.keys(after).map(k => [k, rows[found - 1]?.[k] ?? ""])), after });
          saved(t(`تم تحديث سجل «${keyValue}» ✓`, `"${keyValue}" updated ✓`));
        }
        else { const record = formValues(); const row = await store.append(record); remember({ kind: "added", rows: [row], records: [record] }); saved(t(`تمت إضافة «${keyValue}» في الصف ${row} ✓`, `"${keyValue}" added in row ${row} ✓`)); }
        clearForm();
      } else if (action === "addRow") {
        const missing = missingRequired();
        if (missing.length) return fail(t("املأ الحقول المطلوبة: ", "Fill in the required fields: ") + missing.join("، "));
        if (rangeError()) return fail(rangeError());
        if (Object.values(formValues()).every(v => !String(v).trim())) return fail(t("الحقول فارغة.", "The fields are empty."));
        const repeated = duplicateError(await store.rows(), null);
        if (repeated) return fail(repeated);
        // Serial numbers: one more than the largest already in the column.
        const numbered = binds.filter(([c]) => bool(c, "autoNumber") && !(values[c.id] || "").trim());
        const assigned = [];
        if (numbered.length) {
          const rows = await store.rows();
          for (const [c, col] of numbered) { const next = nextNumber(rows, col, prop(c, "autoPrefix"), Math.trunc(num(c, "autoDigits"))); setValue(c, next); assigned.push(next); }
        }
        // Several records at once (e.g. paying 3 months ahead): the date moves on a month each time.
        const countField = byName(button ? prop(button, "repeatField") : "");
        const times = Math.min(120, Math.max(1, Math.trunc(countField ? numberOf(values[countField.id]) ?? 1 : 1)));
        const dateField = byName(button ? prop(button, "repeatDateField") : "");
        const dateCol = dateField ? binds.find(([b]) => b === dateField)?.[1] : null;
        const first = formValues();
        const addedRows = [], addedRecords = [];
        for (let i = 0; i < times; i++) {
          const record = i === 0 || dateCol == null ? first : { ...first, [dateCol]: addPeriods(first[dateCol] ?? "", prop(dateField, "dateFormat"), i) ?? first[dateCol] };
          addedRows.push(await store.append(record));
          addedRecords.push(record);
        }
        clearForm();
        // A mistake (say, too many months) can be taken back at once.
        offerUndo(times > 1 ? t(`تمت إضافة ${times} سجلات ✓`, `${times} records added ✓`)
          : t(`تمت إضافة الصف رقم ${addedRows[0]} ✓`, `Row ${addedRows[0]} added ✓`) + (assigned.length ? " — " + assigned.join("، ") : ""),
          addedRows, addedRecords);
      } else if (action === "search") {
        const field = button ? prop(button, "searchField") : "";
        const mode = (button && prop(button, "matchMode")) || "exact";
        const again = state.currentRow != null && sameForm(formValues(), state.filledSnapshot) && state.lastCriteria;
        const criteria = again ? state.lastCriteria : searchCriteria(field);
        state.resultsTarget = button ? prop(button, "targetScreen") : "";
        if (!Object.keys(criteria).length) {
          return fail(field ? t(`اكتب قيمة في حقل «${field}» ثم اضغط بحث.`, `Type a value in "${field}", then search.`)
            : t("اكتب قيمة في حقل أو أكثر ثم اضغط بحث.", "Type a value in one or more fields, then search."));
        }
        const rows = await store.rows();
        state.sheetRows = rows;
        state.lastCriteria = criteria;
        const found = searchAll(rows, criteria, mode);
        if (!found.length) return fail(t("لا توجد نتيجة مطابقة.", "No matching row."));
        else if (found.length === 1) openRecord(rows, found[0], state.resultsTarget);
        else { pickResult(rows, found); return false; }
      } else if (action === "updateRow") {
        const row = state.currentRow;
        if (row == null) return fail(t("ابحث عن الصف أولًا ثم عدّله.", "Search for the row first, then edit it."));
        const missing = missingRequired();
        if (missing.length) return fail(t("املأ الحقول المطلوبة: ", "Fill in the required fields: ") + missing.join("، "));
        if (rangeError()) return fail(rangeError());
        const now = await store.rows();
        const repeated = duplicateError(now, row);
        if (repeated) return fail(repeated);
        const after = formValues();
        await store.update(row, after);
        remember({ kind: "changed", row, before: Object.fromEntries(Object.keys(after).map(k => [k, now[row - 1]?.[k] ?? ""])), after });
        state.filledSnapshot = formValues();
        saved(t(`تم حفظ التعديل على الصف ${row} ✓`, `Row ${row} updated ✓`));
      } else if (action === "deleteRow") {
        const row = state.currentRow;
        if (row == null) return fail(t("ابحث عن الصف أولًا ثم احذفه.", "Search for the row first, then delete it."));
        if (!(await opts.confirm(t(`حذف الصف ${row}؟ تصعد الصفوف التي بعده.`, `Delete row ${row}? The rows below move up.`)))) return false;
        const old = (await store.rows())[row - 1];
        await store.delete(row);
        if (old) remember({ kind: "removed", rows: [row], records: [recordOf(old)] });
        clearForm();
        saved(t(`تم حذف الصف ${row}`, `Row ${row} deleted`));
      }
      await reloadTables();
      if (unsaved.length) await logicDialog(t(
        "حُفظ السجل، لكن هذه الحقول غير مرتبطة بعمود في ملف Excel فلم تُحفظ قيمتها:\n" + unsaved.join("، ") + "\n\nاربط كل حقل من: الخصائص ← الأساسيات ← «العمود المرتبط».",
        "The record was saved, but these fields are linked to no column of the Excel file, so their values weren't saved:\n" + unsaved.join(", ") + "\n\nLink each one in: Properties → Basics → \"Linked column\"."), false);
    } catch (e) {
      if (writes && String(e?.code || "").includes("permission-denied")) noAccess();
      else toast(opts.errorText(e));
      return false;
    } finally {
      state.working = false;
    }
  }


  /** The value a block reads: as saved (checkboxes as نعم/لا), with calculations worked out now. */
  const liveValue = c => {
    const fresh = computeFormulas(screen, x => (x.type === "LABEL" ? logicTexts[x.id] ?? (prop(x, "stat") ? statRaw(x) ?? x.text : x.text) : values[x.id] ?? ""));
    if (c.id in fresh) return fresh[c.id];
    if (c.type === "LABEL") return logicTexts[c.id] ?? (prop(c, "stat") ? withStatistic(c.text || "", statRaw(c) ?? "") : computed[c.id] ?? withUserName(c.text, opts.user));
    return toExcel(c);
  };
  /** A message or yes/no question from a button's blocks; resolves when answered (true = OK / yes). */
  function logicDialog(text, question) {
    return new Promise(resolve => {
      const close = answer => { overlay.remove(); resolve(answer); };
      const button = (label, color, answer) => h("button", { background: "none", border: "0", color, fontSize: "15px", cursor: "pointer", fontWeight: "bold", padding: "6px 4px" }, { onclick: () => close(answer) }, label);
      const overlay = h("div", { position: "fixed", inset: "0", background: "#0008", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "60" },
        { dir: lang === "en" ? "ltr" : "rtl", onclick: e => { if (e.target === overlay) close(false); } },
        h("div", { background: "#172C24", color: "#fff", borderRadius: "14px", padding: "18px 16px 10px", width: "min(92vw, 380px)" }, {},
          h("div", { whiteSpace: "pre-wrap", fontSize: "15px", lineHeight: "1.6" }, { dir: "auto" }, text),
          h("div", { display: "flex", gap: "16px", justifyContent: "flex-end", marginTop: "12px" }, {},
            question ? button(t("لا", "No"), "#9FB5AA", false) : null,
            button(question ? t("نعم", "Yes") : t("حسنًا", "OK"), "#20B879", true))));
      document.body.append(overlay);
    });
  }
  let runningBlocks = false;
  /** Runs a button's blocks; a button without blocks does its single action. */
  async function press(button) {
    const blocks = logicOf(button);
    if (!blocks.length) return perform(prop(button, "action"), prop(button, "targetScreen"), button);
    if (runningBlocks) return;
    runningBlocks = true;
    const host = {
      get: name => { const c = byName(name); return c ? liveValue(c) : null; },
      set: (name, value) => {
        const c = byName(name);
        if (!c) return;
        if (c.type === "LABEL") { logicTexts[c.id] = value; labelSetters[c.id]?.(value); }
        else setValue(c, c.type === "CHECKBOX" ? String(LOGIC_YES.has(normalize(value))) : value);
        recompute();
      },
      show: (name, shown) => { const c = byName(name); if (!c) return; shown ? logicHidden.delete(c.id) : logicHidden.add(c.id); refreshShown(); },
      say: text => logicDialog(text, false),
      ask: text => logicDialog(text, true),
      // The blocks end once the app leaves this screen (a search can open its record elsewhere).
      act: async (action, target) => (await perform(action, target, button)) !== false && page.isConnected,
    };
    try { await runLogic(blocks, host); }
    catch (e) { toast(opts.errorText(e)); }
    finally { runningBlocks = false; }
  }

  /** A member who may only look: says so, and offers to ask the owner for editing rights. */
  function noAccess() {
    const close = () => overlay.remove();
    const send = h("button", { padding: "10px 16px", border: "0", borderRadius: "10px", background: "#20B879", color: "#fff", fontSize: "15px", cursor: "pointer" },
      { onclick: async () => {
        send.disabled = true;
        try { await opts.requestAccess(); close(); toast(t("تم إرسال طلبك لصاحب التطبيق.", "Your request was sent to the app's owner.")); }
        catch (e) { send.disabled = false; toast(opts.errorText(e)); }
      } }, t("إرسال طلب لصاحب التطبيق", "Ask the owner for access"));
    const overlay = h("div", { position: "fixed", inset: "0", background: "#0008", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "50" },
      { dir: lang === "en" ? "ltr" : "rtl", onclick: e => { if (e.target === overlay) close(); } },
      h("div", { background: "#172C24", color: "#fff", borderRadius: "14px", padding: "18px", width: "min(92vw, 400px)", display: "flex", flexDirection: "column", gap: "10px" }, {},
        h("div", { fontWeight: "bold", fontSize: "17px" }, {}, t("غير مصرّح لك بالإضافة أو التعديل", "You can't add or change records")),
        h("div", { color: "#b9d9c9", fontSize: "14px" }, {}, opts.requestAccess
          ? t("يمكنك البحث والاطلاع على البيانات. لتتمكن من الحفظ والتعديل اطلب الصلاحية من صاحب التطبيق.", "You can search and view the data. To save or change records, ask the app's owner for access.")
          : t("يمكنك البحث والاطلاع على البيانات فقط.", "You can only search and view the data.")),
        opts.requestAccess ? send : null,
        h("button", { background: "none", border: "0", color: "#b9d9c9", fontSize: "15px", cursor: "pointer" }, { onclick: close }, t("إغلاق", "Close"))));
    document.body.append(overlay);
  }

  function caption(c) {
    // The label beside the input (same line, nearest), else the column, else the name.
    const labels = screen.components.filter(l => l.type === "LABEL" && (l.text || "").trim() && !prop(l, "formula").trim());
    const overlap = l => Math.max(0, Math.min(l.y + l.height, c.y + c.height) - Math.max(l.y, c.y));
    const gap = l => (l.x + l.width <= c.x ? c.x - l.x - l.width : c.x + c.width <= l.x ? l.x - c.x - c.width : 0);
    const same = labels.filter(l => overlap(l) > Math.min(l.height, c.height) / 2).sort((a, b) => gap(a) - gap(b))[0];
    const above = labels.filter(l => l.y + l.height <= c.y + 4 && c.y - (l.y + l.height) <= 48 && Math.min(l.x + l.width, c.x + c.width) > Math.max(l.x, c.x))
      .sort((a, b) => b.y - a.y)[0];
    return ((same || above)?.text || prop(c, "column") || c.name).trim().replace(/[:：]$/, "");
  }

  async function recordReport() {
    const fields = screen.components.filter(c => INPUT_TYPES.has(c.type) && isShown(c)).sort((a, b) => a.y - b.y || a.x - b.x);
    if (fields.every(c => c.type === "CHECKBOX" || !(values[c.id] || "").trim())) {
      return toast(t("النموذج فارغ. املأ الحقول أو ابحث عن سجل ثم أنشئ التقرير.", "The form is empty. Fill it in or search for a record first."));
    }
    const w = reportWindow(lang);
    if (!w) return toast(t("اسمح بالنوافذ المنبثقة لهذا الموقع لعرض التقرير.", "Allow pop-ups for this site to see the report."));
    const results = screen.components.filter(c => c.type === "LABEL" && c.id in computed);
    const rows = [];
    for (const c of [...fields, ...results]) {
      let cell;
      if (PICTURE_TYPES.has(c.type)) {
        const url = values[c.id] && store?.loadPhoto ? await store.loadPhoto(values[c.id]).catch(() => null) : null;
        cell = url ? `<img src="${url}">` : t("(لا توجد صورة)", "(no photo)");
      } else cell = esc(toExcel(c) || "—");
      rows.push(`<tr><td class="cap">${esc(caption(c))}</td><td>${cell}</td></tr>`);
    }
    showReport(w, lang, prop2(screen, "title") || project.name, `<table>${rows.join("")}</table>`);
  }

  async function tableReport() {
    if (!store && !mainTable()) return toast(t("لا يوجد جدول بيانات مرتبط.", "No data table is linked."));
    const w = reportWindow(lang);
    if (!w) return toast(t("اسمح بالنوافذ المنبثقة لهذا الموقع لعرض التقرير.", "Allow pop-ups for this site to see the report."));
    try {
      // What the screen's table shows (search, sort, columns), or every record.
      const [head, ...data] = (await shownTableRows()) || await store.rows();
      const filled = data.filter(r => r.some(v => String(v).trim()));
      const cell = v => (isPhoto(v) ? t("صورة", "Photo") : esc(v));
      const body = `<p>${t("عدد السجلات: ", "Records: ")}${filled.length}</p><table><tr><th>#</th>${head.map(x => `<th>${esc(x)}</th>`).join("")}</tr>` +
        filled.map((r, i) => `<tr class="${i % 2 ? "s" : ""}"><td>${i + 1}</td>${head.map((_, j) => `<td>${cell(r[j] ?? "")}</td>`).join("")}</tr>`).join("") + "</table>";
      showReport(w, lang, project.name, body);
    } catch (e) {
      w.close();
      toast(opts.errorText(e));
    }
  }

  /** The whole screen as a report: each value with its caption, each table under the label above it. */
  async function screenReport() {
    const w = reportWindow(lang);
    if (!w) return toast(t("اسمح بالنوافذ المنبثقة لهذا الموقع لعرض التقرير.", "Allow pop-ups for this site to see the report."));
    const parts = screen.components.filter(c => bool(c, "visible") && isShown(c)).sort((a, b) => a.y - b.y || a.x - b.x);
    const facts = [];
    let body = "";
    const flush = () => { if (facts.length) body += `<table>${facts.join("")}</table><br>`; facts.length = 0; };
    const fact = (cap, value) => facts.push(`<tr><td class="cap">${esc(cap)}</td><td>${esc(value || "—")}</td></tr>`);
    for (const c of parts) {
      if (c.type === "TABLE") {
        flush();
        const above = parts.filter(l => l.type === "LABEL" && l.y + l.height <= c.y + 4 && c.y - (l.y + l.height) <= 40 && l.x < c.x + c.width && c.x < l.x + l.width).sort((a, b) => b.y - a.y)[0];
        let grid;
        if (prop(c, "dataSource") === "sheet") {
          const file = tableFileOf(c);
          if (file !== fileId && !otherRows[file]) { const s = storeOf(file); if (s) otherRows[file] = await s.rows(); }
          if (file === fileId && !state.sheetRows && store) state.sheetRows = await store.rows();
          grid = tableView(c)?.shownRows();
        } else grid = [prop(c, "columns").split(",").map(x => x.trim())];
        if (!grid) continue;
        const [head, ...data] = grid;
        if (above) body += `<h3 style="color:#00838F;margin:14px 0 6px">${esc(above.text)}</h3>`;
        body += `<table><tr>${head.map(x => `<th>${esc(x)}</th>`).join("")}</tr>` +
          data.filter(r => r.some(v => String(v).trim())).map((r, i) => `<tr class="${i % 2 ? "s" : ""}">${head.map((_, j) => `<td>${esc(r[j] ?? "")}</td>`).join("")}</tr>`).join("") + "</table><br>";
      } else if (c.type === "LABEL" && prop(c, "stat")) {
        const own = String(c.text || "").replaceAll("{}", "").trim().replace(/[:：]$/, "").trim();
        fact(own || labelComponentFor(screen, c)?.text?.trim() || "", statRaw(c) ?? "");
      } else if (c.type === "LABEL" && c.id in computed) fact(labelComponentFor(screen, c)?.text?.trim() || "", computed[c.id]);
      else if (INPUT_TYPES.has(c.type) && !PICTURE_TYPES.has(c.type)) fact(caption(c), toExcel(c));
    }
    flush();
    showReport(w, lang, prop2(screen, "title") || project.name, body);
  }

  // Page size: the project frame, turned for landscape screens.
  const f = project.frame || { width: 360, height: 800 };
  const landscape = (screen.properties || {}).orientation === "landscape";
  const pageW = landscape ? Math.max(f.width, f.height) : Math.min(f.width, f.height);
  // Added fields can push the page down: it grows to keep them all (and scrolls).
  // A screen can have its own height (e.g. a long report); 0 or none = the project's.
  const ownH = parseFloat((screen.properties || {}).pageHeight) || 0;
  const pageH = Math.max(ownH > 0 ? Math.min(Math.max(ownH, 240), 2000) : landscape ? Math.min(f.width, f.height) : Math.max(f.width, f.height),
    screen === designed ? 0 : Math.max(0, ...screen.components.map(c => c.y + c.height)) + 16);

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
      // Labels and images used as backgrounds let taps through to the fields under them, like on the phone.
      pointerEvents: c.type === "LABEL" || c.type === "IMAGE" ? "none" : "",
    }, { dir: lang === "en" ? "ltr" : "rtl" });
    box.append(drawComponent(c));
    boxes[c.id] = box;
    page.append(box);
  }
  refreshShown();
  refreshShownLater = refreshShown;

  function drawComponent(c) {
    const style = textStyle(c);
    const enabled = bool(c, "enabled");
    const frame = (extra = {}) => h("div", { ...chrome(c), width: "100%", height: "100%", display: "flex", alignItems: "center", ...extra });
    switch (c.type) {
      case "LABEL": {
        const max = Math.trunc(num(c, "maxLines"));
        const el = frame({ justifyContent: justify(prop(c, "textAlign")) });
        const shownText = withUserName(c.text, opts.user);
        const text = h("div", { ...style, width: "100%", whiteSpace: "pre-wrap", ...(max > 0 ? { display: "-webkit-box", WebkitLineClamp: String(max), WebkitBoxOrient: "vertical", overflow: "hidden" } : {}) }, { dir: "auto" }, shownText);
        if (isCalculated(c)) formulaShown[c.id] = v => { text.textContent = v; };
        labelSetters[c.id] = v => { text.textContent = v; };
        if (prop(c, "stat")) {
          // The file counted: the screen's own unless another is chosen ("@main" = the main file).
          const update = () => { text.textContent = withStatistic(shownText || "", statRaw(c) ?? "…"); };
          statLabels.push(update);
          update();
        }
        el.append(text);
        return el;
      }
      case "BUTTON": {
        const el = h("button", { ...chrome(c), ...style, width: "100%", height: "100%", cursor: enabled ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: justify(prop(c, "textAlign")), gap: "4px" },
          { disabled: !enabled, onclick: () => press(c) });
        // A symbol (the same arrows as the editor's undo/redo), beside the text or alone.
        const icon = buttonIcon(prop(c, "buttonIcon"), style.color, Math.max(16, num(c, "fontSize") * 1.4), lang !== "en");
        if (icon) el.append(icon);
        if (c.text) el.append(c.text);
        return el;
      }
      case "TEXT_FIELD": {
        const type = prop(c, "inputType");
        const multiline = type === "multiline";
        const required = bool(c, "required");
        const attrs = {
          placeholder: bool(c, "autoNumber") ? t("رقم تلقائي عند الحفظ", "Numbered on save") : prop(c, "hint") + (required ? " *" : ""),
          maxlength: num(c, "maxLength") > 0 ? Math.trunc(num(c, "maxLength")) : null,
          readonly: bool(c, "readOnly") || bool(c, "autoNumber") || isCalculated(c), disabled: !enabled,
          type: { password: "password", email: "email", phone: "tel" }[type] || "text",
          inputmode: { number: "numeric", decimal: "decimal", phone: "tel", email: "email" }[type] || null,
          oninput: e => {
            // "No spaces": spaces typed or pasted are dropped as they come.
            if (bool(c, "noSpaces") && /\s/.test(e.target.value)) {
              const at = e.target.value.slice(0, e.target.selectionEnd ?? e.target.value.length).replace(/\s/g, "").length;
              e.target.value = e.target.value.replace(/\s/g, "");
              try { e.target.setSelectionRange(at, at); } catch (_) {}
            }
            values[c.id] = e.target.value; markRange(); recompute(); redrawFilteredBy(c); suggest();
          },
          onblur: () => setTimeout(() => menu?.remove(), 200),
        };
        // Suggestions from the sheet while typing; picking one shows that record.
        let menu = null;
        // A key other fields look up in another file (like KKS on a maintenance screen) suggests from that file.
        const looker = c.name && screen.components.find(o => prop(o, "lookupColumn") && normalize(prop(o, "lookupField")) === normalize(c.name));
        const sourceFile = looker && prop(looker, "lookupFile") !== fileId ? prop(looker, "lookupFile") : null;
        const ownCol = binds.find(([b]) => b === c)?.[1];
        const mode = sourceFile != null && autocompleteMode(c) !== "off" ? "field" : autocompleteMode(c);
        const suggest = async () => {
          menu?.remove(); menu = null;
          const typed = values[c.id] || "";
          if (mode === "off" || typed.trim().length < Math.max(1, Math.trunc(num(c, "suggestAfter")))) return;
          let rows, col;
          if (sourceFile != null) {
            if (!otherRows[sourceFile]) { const s = storeOf(sourceFile); if (!s) return; try { otherRows[sourceFile] = await s.rows(); } catch (e) { return; } }
            rows = otherRows[sourceFile];
            const name = prop(c, "optionsColumn") || prop(c, "column") || (ownCol != null ? headers[ownCol] : "");
            col = (rows[0] || []).findIndex(x => normalize(x) === normalize(name));
            if (col < 0) return;
          } else {
            if (ownCol == null || !store) return;
            if (!state.sheetRows) { try { state.sheetRows = await store.rows(); } catch (e) { return; } }
            rows = state.sheetRows; col = ownCol;
          }
          let list = suggestions(rows, col, typed);
          // Nothing to offer once the field already holds the value.
          if (list.some(([, v]) => normalize(v) === normalize(typed)) && (mode === "field" || list.length === 1)) {
            list = list.filter(([, v]) => normalize(v) !== normalize(typed));
          }
          if (!list.length || values[c.id] !== typed) return;
          const r = input.getBoundingClientRect();
          menu = h("div", { position: "fixed", left: r.left + "px", top: r.bottom + 4 + "px", minWidth: Math.max(r.width, 160) + "px", background: "#fff", color: "#183328",
            borderRadius: "8px", boxShadow: "0 4px 14px #0004", zIndex: "40", overflow: "hidden", fontSize: "14px" }, { dir: lang === "en" ? "ltr" : "rtl" },
            ...list.map(([n, text]) => h("div", { padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #eee" },
              { onmousedown: e => {
                e.preventDefault(); menu?.remove(); menu = null;
                if (mode === "record") { state.lastCriteria = null; showRow(rows, n); } else setValue(c, text);
              } }, text)));
          document.body.append(menu);
        };
        const input = h(multiline ? "textarea" : "input",
          { ...style, width: "100%", height: "100%", border: "none", outline: "none", background: "transparent", resize: "none", padding: "0", fontFamily: style.fontFamily },
          attrs);
        input.value = values[c.id];
        // Outside the lowest / highest number: shown in red until fixed.
        const markRange = () => { input.style.color = rangeProblem(values[c.id], prop(c, "minValue"), prop(c, "maxValue"), lang === "en") ? "#D32F2F" : style.color || ""; };
        markRange();
        inputs[c.id] = v => { input.value = v; markRange(); };
        if (isCalculated(c)) formulaShown[c.id] = v => { input.value = v; };
        const el = frame({ alignItems: multiline ? "flex-start" : "center" });
        el.style.setProperty("--hint", cssColor(prop(c, "hintColor")));
        input.classList.add("hinted");
        el.append(input);
        const scanMode = prop(c, "scan");
        if (scanMode === "fill" || scanMode === "record") {
          el.append(h("button", { flex: "0 0 auto", border: "0", background: "transparent", fontSize: "20px", cursor: "pointer", padding: "0 4px" },
            { title: t("مسح باركود", "Scan code"), disabled: !enabled, onclick: async () => {
              const code = await scanBarcode(lang, toast);
              if (!code) return;
              setValue(c, code);
              const column = binds.find(([b]) => b === c)?.[1];
              if (scanMode !== "record" || column == null || !store) return;
              try {
                state.resultsTarget = "";
                const rows = state.sheetRows || await store.rows();
                state.sheetRows = rows;
                const found = searchAll(rows, { [column]: code });
                if (!found.length) toast(t(`لا يوجد سجل بهذا الرمز: ${code}`, `No record has this code: ${code}`));
                else if (found.length === 1) showRow(rows, found[0]);
                else pickResult(rows, found);
              } catch (e) { toast(opts.errorText(e)); }
            } }, "▦"));
        }
        return el;
      }
      case "DROPDOWN": {
        let items = optionsFor(c);
        if (bool(c, "multiSelect")) {
          // Multiple choice: ticked in a list, saved as "A, B, C".
          const label = h("span", { ...style, flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, { dir: "auto" });
          const show = v => { label.textContent = v || prop(c, "hint"); label.style.opacity = v ? "1" : ".55"; };
          show(values[c.id]);
          inputs[c.id] = show;
          optionRefreshers[c.id] = () => { items = optionsFor(c); };
          const el = frame({ cursor: enabled ? "pointer" : "default" });
          el.append(label, h("span", { ...style, flex: "0 0 auto", opacity: ".6" }, {}, "▾"));
          if (enabled) el.onclick = () => {
            const picked = new Set(choicesOf(values[c.id]));
            const close = () => overlay.remove();
            const list = h("div", { maxHeight: "55vh", overflow: "auto" }, {}, ...items.map(item => {
              const box = h("input", { width: "18px", height: "18px" }, { type: "checkbox", onchange: e => { e.target.checked ? picked.add(item) : picked.delete(item); } });
              box.checked = picked.has(item);
              return h("label", { display: "flex", alignItems: "center", gap: "10px", padding: "8px 2px", cursor: "pointer", borderBottom: "1px solid #ffffff14" }, {}, box, item);
            }));
            const overlay = h("div", { position: "fixed", inset: "0", background: "#0008", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "50" },
              { dir: lang === "en" ? "ltr" : "rtl", onclick: e => { if (e.target === overlay) close(); } },
              h("div", { background: "#172C24", color: "#fff", borderRadius: "14px", padding: "16px", width: "min(92vw, 380px)" }, {},
                h("div", { fontWeight: "bold", marginBottom: "8px" }, {}, prop(c, "hint") || t("اختر", "Choose")),
                list,
                h("div", { display: "flex", gap: "16px", justifyContent: "flex-end", marginTop: "10px" }, {},
                  h("button", { background: "none", border: "0", color: "#9FB5AA", fontSize: "15px", cursor: "pointer" }, { onclick: close }, t("إلغاء", "Cancel")),
                  h("button", { background: "none", border: "0", color: "#20B879", fontSize: "15px", cursor: "pointer", fontWeight: "bold" },
                    { onclick: () => { close(); setValue(c, joinChoices(items, picked)); } }, t("تم", "Done")))));
            document.body.append(overlay);
          };
          return el;
        }
        const select = h("select", { ...style, width: "100%", height: "100%", border: "none", background: "transparent", outline: "none" },
          { disabled: !enabled, onchange: e => setValue(c, e.target.value) });
        const sync = v => {
          select.replaceChildren(h("option", {}, { value: "" }, prop(c, "hint")), ...items.map(item => h("option", {}, { value: item }, item)));
          if (v && !items.includes(v)) select.append(h("option", {}, { value: v }, v));
          select.value = v || "";
        };
        optionRefreshers[c.id] = () => { items = optionsFor(c); sync(values[c.id]); };
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
          // Month-only dates pick a month where the browser can.
          type: prop(c, "dateFormat") === "yyyy/MM" && prop(c, "calendar") !== "hijri" ? "month" : "date", disabled: !enabled,
          onchange: e => {
            if (!e.target.value) return;
            const [y, m, d] = e.target.value.split("-").map(Number);
            setValue(c, formatDate(c, new Date(Date.UTC(y, m - 1, d || 1)), lang));
          },
        });
        const el = frame({ position: "relative", gap: "6px" });
        el.append(label, h("span", { ...style, flex: "0" }, {}, "📅"), picker);
        return el;
      }
      case "RADIO": {
        const el = frame({ flexDirection: prop(c, "radioLayout") === "vertical" ? "column" : "row", alignItems: prop(c, "radioLayout") === "vertical" ? "stretch" : "center", gap: "10px", flexWrap: "wrap" });
        const group = "r" + c.id;
        const draw = () => {
          el.replaceChildren(...(optionsFor(c).length ? optionsFor(c) : ["—"]).map(option => {
            const input = h("input", { accentColor: cssColor(prop(c, "checkColor")), width: "18px", height: "18px", margin: "0" },
              { type: "radio", name: group, value: option, disabled: !enabled, onchange: () => setValue(c, option) });
            input.checked = values[c.id] === option;
            return h("label", { display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }, {}, input, h("span", style, { dir: "auto" }, option));
          }));
        };
        optionRefreshers[c.id] = draw;
        inputs[c.id] = draw;
        draw();
        return el;
      }
      case "TIME_PICKER": {
        const label = h("span", { ...style, flex: "1", whiteSpace: "nowrap" }, { dir: "ltr" });
        const show = v => { label.textContent = v || "--:--"; label.style.opacity = v ? "1" : ".55"; };
        show(values[c.id]);
        inputs[c.id] = show;
        const picker = h("input", { position: "absolute", inset: "0", opacity: "0", width: "100%", height: "100%", cursor: "pointer" }, {
          type: "time", disabled: !enabled,
          onchange: e => { if (!e.target.value) return; const [hh, mm] = e.target.value.split(":").map(Number); setValue(c, formatTime(c, hh, mm, lang)); },
        });
        const el = frame({ position: "relative", gap: "6px" });
        el.append(label, h("span", { ...style, flex: "0" }, {}, "🕒"), picker);
        return el;
      }
      case "SIGNATURE": {
        const el = frame({ justifyContent: "center", overflow: "hidden", cursor: enabled ? "pointer" : "default", flexDirection: "column" });
        const show = async v => {
          el.replaceChildren();
          if (!v) { el.append(h("div", { fontSize: "26px" }, {}, "✍️"), h("div", { ...style, textAlign: "center" }, {}, prop(c, "hint") + (bool(c, "required") ? " *" : ""))); return; }
          const url = store?.loadPhoto ? await store.loadPhoto(v).catch(() => null) : null;
          if (values[c.id] !== v) return;
          el.append(url ? h("img", { width: "100%", height: "100%", objectFit: "contain" }, { src: url, alt: c.name }) : h("div", style, {}, t("التوقيع غير متاح", "Signature not available")));
        };
        el.onclick = async () => {
          if (!enabled) return;
          if (!store?.savePhoto) return toast(t("حفظ التوقيع يحتاج تطبيقًا مرتبطًا ببيانات.", "Saving a signature needs an app with data."));
          const jpeg = await signaturePad(lang);
          if (!jpeg) return;
          try { const name = photoName(); await store.savePhoto(name, jpeg); setValue(c, name); } catch (e) { toast(opts.errorText(e)); }
        };
        inputs[c.id] = show;
        show(values[c.id]);
        return el;
      }
      case "LOCATION": {
        const el = frame({ justifyContent: "center", gap: "6px", cursor: enabled ? "pointer" : "default", position: "relative" });
        const show = v => {
          el.replaceChildren(h("span", { ...style }, { dir: "auto" }, v || prop(c, "hint") + (bool(c, "required") ? " *" : "")));
          if (v) el.append(h("a", { position: "absolute", insetInlineEnd: "6px", textDecoration: "none" },
            { href: "https://maps.google.com/?q=" + encodeURIComponent(v.replace(/\s/g, "")), target: "_blank", onclick: e => e.stopPropagation() }, "🗺️"));
        };
        el.onclick = () => {
          if (!enabled) return;
          if (!navigator.geolocation) return toast(t("هذا المتصفح لا يدعم تحديد الموقع.", "This browser can't get the location."));
          el.style.opacity = ".6";
          navigator.geolocation.getCurrentPosition(
            pos => { el.style.opacity = "1"; setValue(c, pos.coords.latitude.toFixed(6) + ", " + pos.coords.longitude.toFixed(6)); },
            () => { el.style.opacity = "1"; toast(t("تعذّر تحديد الموقع. اسمح بالوصول للموقع وشغّل GPS.", "Couldn't get the location. Allow location access and turn on GPS.")); },
            { enableHighAccuracy: true, timeout: 20000 });
        };
        inputs[c.id] = show;
        show(values[c.id]);
        return el;
      }
      case "CHECKBOX": {
        const box = h("input", { width: "20px", height: "20px", accentColor: cssColor(prop(c, "checkColor")), flex: "0 0 auto", margin: "0" },
          { type: "checkbox", disabled: !enabled, onchange: e => setValue(c, String(e.target.checked)) });
        box.checked = values[c.id] === "true";
        inputs[c.id] = v => { box.checked = v === "true"; };
        const text = h("span", { ...style, flex: "1" }, { dir: "auto" }, c.text);
        const el = h("label", { ...chrome(c), width: "100%", height: "100%", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" });
        if (prop(c, "boxPosition") === "end") el.append(text, box); else el.append(box, text);
        return el;
      }
      case "TABLE": {
        const el = h("div", { ...chrome(c), width: "100%", height: "100%", overflow: "auto" });
        const fromSheet = prop(c, "dataSource") === "sheet";
        const draw = () => {
          let grid;
          let numbers = null; // Excel row number of each grid line
          let view = null;
          if (fromSheet) {
            view = tableView(c);
            if (!view) { el.replaceChildren(); return; }
            numbers = [1, ...view.numbers].slice(0, 501);
            grid = [view.header(), ...numbers.slice(1).map(view.line)];
          } else {
            const cols = prop(c, "columns").split(",").map(s => s.trim()).filter(Boolean);
            grid = [cols.length ? cols : [""], ...Array.from({ length: Math.max(1, Math.trunc(num(c, "rows"))) }, () => cols.map(() => ""))];
          }
          const own = view && view.fileId === fileId; // only rows of this screen's own file open in the form
          const shownRow = own ? (numbers.indexOf(state.currentRow) > 0 ? numbers.indexOf(state.currentRow) + 1 : null) : null;
          const sort = tableSorts[c.id] || { column: -1, descending: false };
          el.replaceChildren(drawTable(c, style, grid, shownRow, own ? line => {
            const number = numbers[line];
            const row = state.sheetRows?.[number - 1];
            if (!row || number < 2) return;
            // While ticking rows, a tap ticks or unticks one.
            if (picked.size) return togglePicked(number);
            fill(row);
            state.currentRow = number; state.lastCriteria = null; state.filledSnapshot = formValues();
            draw();
          } : null, view ? { column: view.columns.indexOf(sort.column), descending: sort.descending, onSort: k => {
            const orig = view.columns[k];
            tableSorts[c.id] = { column: orig, descending: sort.column === orig ? !sort.descending : false };
            draw();
          } } : null, own && bool(c, "pickRows") ? {
            marked: new Set(numbers.map((n, i) => (i > 0 && picked.has(n) ? i : -1)).filter(i => i > 0)),
            onLongPick: line => { const number = numbers[line]; if (number >= 2) togglePicked(number); },
          } : null, bool(c, "resizeColumns") && {
            widths: tableWidths(c.id),
            onWidths: all => { setTableWidths(c.id, all); draw(); },
          }));
        };
        draw();
        if (fromSheet) tables.push(draw);
        return el;
      }
      case "CHART": {
        const el = frame();
        const chosen = prop(c, "chartFile");
        const file = chosen === "@main" ? "" : chosen && (project.files || []).some(f => f.id === chosen) ? chosen : fileId;
        const draw = () => {
          const rows = file === fileId ? state.sheetRows : rowsFor(file);
          let points = [];
          if (rows && rows.length) {
            const head = rows[0] || [];
            const col = name => { if (!name) return null; const i = head.findIndex(x => normalize(x) === normalize(name)); return i < 0 ? null : i; };
            const numbers = rowsWhere(rows, col(prop(c, "statFilterColumn")), prop(c, "statFilterValue"));
            const group = prop(c, "chartGroup");
            let labelOf;
            if (group === "@author") {
              const s = file === fileId ? store : storeOf(file);
              const names = s?.authorNames?.();
              labelOf = n => (names ? names[n - 2] || t("سجلات قديمة", "Older records") : (opts.user?.name || t("أنا", "Me")));
            } else {
              const gc = col(group);
              labelOf = n => (gc == null ? t("الكل", "All") : (rows[n - 1] || [])[gc]);
            }
            points = chartData(rows, numbers, labelOf, prop(c, "chartValue"), col(prop(c, "chartValueColumn")), prop(c, "chartSort"), Math.trunc(num(c, "chartLimit")), t("أخرى", "Other"), t("(فارغ)", "(blank)"));
          }
          const pad = num(c, "padding") || 0, w = Math.max(10, c.width - 2 * pad), h2 = Math.max(10, c.height - 2 * pad);
          el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${w} ${h2}" style="font-family:inherit;direction:ltr">${chartSvg(c, points, w, h2, style.color, num(c, "fontSize"))}</svg>`;
        };
        draw();
        tables.push(draw);
        return el;
      }
      case "IMAGE": {
        const el = frame({ justifyContent: "center", overflow: "hidden" });
        const data = prop(c, "imageData");
        if (data) el.append(h("img", { width: "100%", height: "100%", objectFit: FIT[prop(c, "imageFit")] || "contain" }, { src: data, alt: c.name }));
        else el.append(h("span", { fontSize: "30px", opacity: "0.5" }, {}, "🖼️"));
        return el;
      }
      case "PHOTO": {
        const el = frame({ justifyContent: "center", position: "relative", overflow: "hidden", cursor: enabled ? "pointer" : "default", flexDirection: "column" });
        const picker = h("input", { display: "none" }, { type: "file", accept: "image/*" });
        let busy = false;
        const show = async v => {
          el.replaceChildren(picker);
          if (busy) { el.append(h("div", style, {}, t("جارٍ الحفظ…", "Saving…"))); return; }
          if (!v) {
            el.append(h("div", { fontSize: "30px" }, {}, "📷"),
              h("div", { ...style, textAlign: "center" }, {}, prop(c, "hint") + (bool(c, "required") ? " *" : "")));
            return;
          }
          const url = store?.loadPhoto ? await store.loadPhoto(v).catch(() => null) : null;
          if (values[c.id] !== v) return;
          if (url) el.append(h("img", { width: "100%", height: "100%", objectFit: FIT[prop(c, "imageFit")] || "contain" }, { src: url, alt: c.name }));
          else el.append(h("div", { ...style, textAlign: "center" }, {}, t("الصورة غير متاحة", "Photo not available")));
          if (enabled) {
            el.append(h("button", { position: "absolute", top: "4px", insetInlineEnd: "4px", border: "0", borderRadius: "50%", width: "26px", height: "26px", background: "#000a", color: "#fff", cursor: "pointer" },
              { title: t("إزالة الصورة", "Remove photo"), onclick: e => { e.stopPropagation(); setValue(c, ""); } }, "✕"));
          }
        };
        picker.onchange = async () => {
          const file = picker.files?.[0];
          picker.value = "";
          if (!file) return;
          if (!store?.savePhoto) return toast(t("حفظ الصور يحتاج تطبيقًا منشورًا.", "Saving photos needs a published app."));
          busy = true; show("");
          try {
            const name = photoName();
            await store.savePhoto(name, await compressPhoto(file));
            busy = false;
            setValue(c, name);
          } catch (e) {
            busy = false; show(values[c.id]);
            toast(opts.errorText(e));
          }
        };
        el.onclick = () => { if (enabled && !busy) picker.click(); };
        inputs[c.id] = show;
        show(values[c.id]);
        return el;
      }
      default:
        return h("div");
    }
  }

  recompute();
  // Opened to show a search result from another screen (its fields were filled before).
  if (opts.openRow) {
    state.currentRow = opts.openRow; state.filledSnapshot = formValues();
    toast(t(`تم عرض الصف ${opts.openRow}`, `Showing row ${opts.openRow}`));
  }
  reloadTables();
  return () => { window.removeEventListener("resize", fit); freshOff.forEach(off => off?.()); pickBar?.remove(); };
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
  const show = (openRow = null) => {
    cleanup?.();
    root.scrollTop = 0;
    cleanup = runScreen(root, project, current, store, {
      ...opts, values, openRow,
      openScreen: (name, row) => {
        const next = project.screens.find(s => s.name === name);
        if (!next) return opts.toast(opts.t("اختر الشاشة التي يفتحها هذا الزر من خصائصه.", "Choose the screen this button opens in its properties."));
        stack.push(current); current = next; show(row);
      },
      back: () => { if (stack.length) { current = stack.pop(); show(); } },
    });
    opts.onScreen?.(current);
  };
  show();
  return { cleanup: () => cleanup?.(), back: () => (stack.length ? (current = stack.pop(), show(), true) : false) };
}

/** Table from grid (line 0 = headers). Vertical orientation shows one column per record. */
function drawTable(c, style, grid, currentRow, onPick, sort = null, ticks = null, sizing = null) {
  // Column widths the person dragged (kept in this browser): { widths: {k: px}, onWidth(k, px|0) }.
  const widths = sizing?.widths || {};
  const custom = Object.keys(widths).length > 0;
  // Ticked lines (for deleting several records), and a long press (or right click) that ticks one.
  const marked = ticks?.marked || new Set();
  const onLongPick = ticks?.onLongPick || null;
  const pickable = (el, line, ok) => {
    let timer = null, long = false;
    el.addEventListener("click", () => { if (long) { long = false; return; } if (ok()) onPick?.(line); });
    if (!onLongPick) return;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener("pointerdown", () => { long = false; cancel(); timer = setTimeout(() => { long = true; if (ok()) onLongPick(line); }, 550); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => el.addEventListener(ev, cancel));
    el.addEventListener("contextmenu", e => { e.preventDefault(); cancel(); if (ok()) onLongPick(line); });
  };
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
  // Sortable headers show an arrow on the sorted column and sort when tapped.
  const headCell = k => {
    const arrow = sort && sort.column === k ? (sort.descending ? " ▼" : " ▲") : "";
    const width = widths[k] ? { width: widths[k] + "px", minWidth: widths[k] + "px", maxWidth: widths[k] + "px" } : {};
    const th = cell((headers[k] ?? "") + arrow, true, { ...(sort ? { cursor: "pointer", userSelect: "none" } : {}), ...width, position: "relative" });
    if (sort) { th.title = "فرز"; th.addEventListener("click", () => sort.onSort(k)); }
    // Drag the header's edge to widen or narrow the column; a double tap makes it automatic again.
    if (sizing?.onWidths && !vertical) {
      const grip = h("span", { position: "absolute", top: "0", bottom: "0", width: "12px", cursor: "col-resize", touchAction: "none",
        display: "flex", alignItems: "center", justifyContent: "center" }, {}, h("span", { width: "2px", height: "50%", background: "rgba(255,255,255,.6)" }));
      let startX = 0, startW = 0, scale = 1, dragging = false;
      // The table's direction (not the header text's): which way a drag widens the column.
      const rtl = () => getComputedStyle(table).direction === "rtl";
      grip.addEventListener("click", e => e.stopPropagation());
      grip.addEventListener("dblclick", e => { e.stopPropagation(); sizing.onWidths({}); });
      const setCol = (col, w) => {
        for (const el of table.querySelectorAll(`[data-col="${col}"]`)) Object.assign(el.style, { width: w + "px", minWidth: w + "px", maxWidth: w + "px" });
      };
      grip.addEventListener("pointerdown", e => {
        e.stopPropagation(); e.preventDefault();
        const box = th.getBoundingClientRect();
        scale = box.width / (th.offsetWidth || box.width || 1) || 1;
        // Every column keeps the width it has now, so only the dragged one moves.
        const heads = [...table.querySelectorAll("th[data-col]")];
        const now = heads.map(x => [x.dataset.col, x.offsetWidth]);
        table.style.width = "auto"; table.style.tableLayout = "fixed";
        for (const [col, w] of now) { setCol(col, w); heads.find(x => x.dataset.col === col).dataset.w = String(w); }
        startX = e.clientX; startW = th.offsetWidth; dragging = true;
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener("pointermove", e => {
        if (!dragging) return;
        const w = Math.max(40, Math.min(600, startW + ((e.clientX - startX) / scale) * (rtl() ? -1 : 1)));
        setCol(k, w);
        th.dataset.w = String(Math.round(w));
      });
      const end = () => {
        if (!dragging) return;
        dragging = false;
        sizing.onWidths(Object.fromEntries([...table.querySelectorAll("th[data-col]")].map(x => [x.dataset.col, Number(x.dataset.w || x.offsetWidth)])));
      };
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);
      // On the column's end edge, by the table's direction (the header's own text may run the other way).
      const place = () => { const r = rtl(); grip.style.left = r ? "0" : ""; grip.style.right = r ? "" : "0"; };
      place(); setTimeout(place, 0);
      th.append(grip);
    }
    return th;
  };
  const cell = (text, head, extra = {}) => h(head ? "th" : "td", {
    ...(head ? headStyle : style), border: grid_, height: rowH + "px", padding: "0 4px", textAlign: align,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "1px", ...(minW > 0 ? { minWidth: minW + "px" } : {}), ...extra,
  }, { dir: "auto" }, text);
  const recordBg = i => marked.has(i + 1) ? "rgba(32,184,121,.55)" : i + 1 === currentRow - 1 ? "rgba(32,184,121,.3)" : (striped && i % 2 === 1 ? cssColor(prop(c, "gridColor")) : "transparent");
  const table = h("table", { borderCollapse: "collapse", width: minW > 0 || custom ? "auto" : "100%", tableLayout: minW > 0 && !custom ? "auto" : "fixed" });
  // Without a width of its own, a column takes the minimum (or 100px once some are dragged, so it scrolls sideways).
  const colWidth = k => widths[k] ? widths[k] : custom ? Math.max(minW, 100) : 0;
  const sized = (el, k) => { const w = colWidth(k); if (w) Object.assign(el.style, { width: w + "px", minWidth: w + "px", maxWidth: w + "px" }); el.dataset.col = String(k); return el; };
  if (!vertical) {
    table.append(h("tr", {}, {}, numbers ? cell("#", true, { width: "34px", maxWidth: "none" }) : null, Array.from({ length: fields }, (_, i) => sized(headCell(i), i))));
    records.forEach((r, i) => {
      const tr = h("tr", { background: recordBg(i), cursor: onPick ? "pointer" : "default", userSelect: onLongPick ? "none" : "" }, {},
        numbers ? cell(marked.has(i + 1) ? "✓" : String(i + 1), false, { width: "34px", maxWidth: "none" }) : null,
        Array.from({ length: fields }, (_, k) => sized(cell(r[k] ?? "", false), k)));
      pickable(tr, i + 1, () => !!onPick && r.length > 0);
      table.append(tr);
    });
  } else {
    if (numbers) table.append(h("tr", {}, {}, cell("#", true), records.map((_, i) => cell(String(i + 1), true))));
    for (let k = 0; k < fields; k++) {
      table.append(h("tr", {}, {}, headCell(k),
        records.map((r, i) => cell(r[k] ?? "", false, { background: recordBg(i), cursor: onPick ? "pointer" : "default" }))));
    }
    if (onPick) table.querySelectorAll("tr").forEach(tr => [...tr.children].slice(1).forEach((td, i) => pickable(td, i + 1, () => !!records[i]?.length)));
  }
  return table;
}
