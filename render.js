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
    rowNumbers: "false", dataSource: "",
  },
  DATE_PICKER: { dateFormat: "yyyy/MM/dd", calendar: "gregorian", defaultToday: "true" },
  CHECKBOX: { backgroundColor: "#00FFFFFF", borderWidth: "0", checked: "false", checkColor: "#FF20B879", boxPosition: "start" },
  PHOTO: { hint: "اضغط لالتقاط صورة", imageFit: "contain", required: "false", textColor: "#FF607D8B", textAlign: "center", fontSize: "13", backgroundColor: "#FFFFFFFF", borderWidth: "1" },
  IMAGE: { imageData: "", imageFit: "contain", backgroundColor: "#00FFFFFF", borderWidth: "0" },
  RADIO: { items: "خيار 1\nخيار 2", selectedIndex: "-1", radioLayout: "horizontal", checkColor: "#FF20B879", required: "false", backgroundColor: "#00FFFFFF", borderWidth: "0" },
  TIME_PICKER: { timeFormat: "HH:mm", defaultNow: "false", backgroundColor: "#FFFFFFFF", borderWidth: "1" },
  SIGNATURE: { hint: "اضغط للتوقيع", required: "false", textColor: "#FF607D8B", textAlign: "center", fontSize: "13", backgroundColor: "#FFFFFFFF", borderWidth: "1" },
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
export function useAppManifest(name, startUrl, icon) {
  if (!/^https?:$/.test(location.protocol)) return;
  const abs = u => new URL(u, location.href).href;
  const iconUrl = abs(icon || "icon-512.png");
  const type = /^data:image\/svg|\.svg$/i.test(iconUrl) ? "image/svg+xml" : "image/png";
  const manifest = {
    name, short_name: name.slice(0, 24), start_url: abs(startUrl), scope: abs("./"), id: abs(startUrl),
    display: "standalone", background_color: "#10251F", theme_color: "#10251F",
    dir: document.documentElement.dir || "rtl", lang: document.documentElement.lang || "ar",
    icons: [{ src: iconUrl, sizes: "192x192", type, purpose: "any" }, { src: iconUrl, sizes: "512x512", type, purpose: "any" }],
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
  const headers = store ? store.headers : [];
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
    computed = { ...computeFormulas(screen, c => (c.type === "LABEL" ? c.text : values[c.id] ?? "")), ...labels };
    for (const [id, show] of Object.entries(formulaShown)) show(computed[id] ?? "");
    refreshShownLater();
  };
  let refreshShownLater = () => {};
  const state = { currentRow: null, lastCriteria: null, filledSnapshot: null, sheetRows: null, working: false };
  const inputs = {}; // component id -> function(value) updating its element
  const tables = [];

  const toExcel = c => {
    const v = computed[c.id] ?? values[c.id] ?? "";
    return c.type === "CHECKBOX" ? (v === "true" ? t("نعم", "Yes") : t("لا", "No")) : v;
  };
  // "Show only when" conditions; hidden fields save nothing.
  const byName = name => name && screen.components.find(o => normalize(o.name) === normalize(name));
  const isShown = c => {
    const source = byName(prop(c, "showIfField"));
    if (!source) return true;
    const wanted = prop(c, "showIfValues").split(/[,،]/).map(normalize).filter(Boolean);
    const actual = normalize(source.type === "LABEL" ? source.text : toExcel(source));
    return wanted.length ? wanted.includes(actual) : actual !== "";
  };
  const boxes = {}; // component id -> its positioned box
  const refreshShown = () => { for (const c of screen.components) if (boxes[c.id]) boxes[c.id].style.display = isShown(c) ? "" : "none"; };
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
      s.rows().then(rows => { otherRows[id] = rows; tables.forEach(draw => draw()); statLabels.forEach(update => update()); }).catch(e => toast(opts.errorText(e))).finally(() => loadingFiles.delete(id));
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
        screen.components.some(o => prop(o, "action") === "upsertRow" && normalize(prop(o, "searchField")) === normalize(c.name))) {
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
    // Other files read by this screen.
    const reads = new Set(screen.components.flatMap(c => [
      prop(c, "lookupField") ? prop(c, "lookupFile") : null, prop(c, "optionsColumn") ? prop(c, "optionsFile") : null,
    ]).filter(id => id != null && id !== fileId));
    for (const id of reads) {
      const s = storeOf(id);
      if (s) s.rows().then(rows => { otherRows[id] = rows; recompute(); Object.values(optionRefreshers).forEach(r => r()); }).catch(() => {});
    }
    const listsFromSheet = screen.components.some(c => prop(c, "optionsColumn") || prop(c, "scan") === "record" || (c.type === "LABEL" && prop(c, "stat"))
      || prop(c, "action") === "upsertRow" || prop(c, "lookupField"));
    if (!tables.length && !listsFromSheet) { state.sheetRows = null; return; } // suggestions read the sheet again when needed
    try {
      state.sheetRows = await store.rows();
      tables.forEach(draw => draw());
      Object.values(optionRefreshers).forEach(redraw => redraw());
      statLabels.forEach(update => update());
    } catch (e) { toast(opts.errorText(e)); }
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
    if (!action) return;
    if (action === "clear") return clearForm();
    if (action === "openScreen") return opts.openScreen ? opts.openScreen(target) : null;
    if (action === "back") return opts.back ? opts.back() : null;
    if (action === "pdfRecord") return recordReport();
    if (action === "pdfTable") return tableReport();
    if (action === "excelTable") return exportTable();
    if (action === "chooseColumns") {
      const table = mainTable();
      return table ? chooseColumns(table) : toast(t("أضف جدولًا مصدره ملف Excel في هذه الشاشة.", "Add a table showing an Excel file on this screen."));
    }
    if (!store) return toast(t("هذا التطبيق غير مرتبط ببيانات.", "This app has no data source."));
    const writes = ["addRow", "upsertRow", "updateRow", "deleteRow"].includes(action);
    if (writes && opts.canEdit === false) return noAccess();
    if (!binds.length) return toast(t("لا يوجد حقل مرتبط بعمود.", "No field is linked to a column."));
    if (state.working) return;
    state.working = true;
    try {
      if (action === "upsertRow") {
        const key = byName(button ? prop(button, "searchField") : "");
        const keyCol = key && binds.find(([b]) => b === key)?.[1];
        if (keyCol == null) return toast(t("اختر في خصائص الزر «الحقل المميّز للسجل»، وهو الحقل الذي لا يتكرر في كل صف (مثل الرقم أو الكود).", "Choose the button's \"Key field of the record\": the field that is different in every row (like a number or code)."));
        const keyValue = toExcel(key);
        if (!String(keyValue).trim()) return toast(t("اختر قيمة الحقل المميّز أولًا.", "Fill in the identifying field first."));
        const missing = missingRequired();
        if (missing.length) return toast(t("املأ الحقول المطلوبة: ", "Fill in the required fields: ") + missing.join("، "));
        if (rangeError()) return toast(rangeError());
        const rows = await store.rows();
        const found = searchAll(rows, { [keyCol]: keyValue })[0];
        const repeated = duplicateError(rows, found || null);
        if (repeated) return toast(repeated);
        if (found) { await store.update(found, formValues()); toast(t(`تم تحديث سجل «${keyValue}» ✓`, `"${keyValue}" updated ✓`)); }
        else { const row = await store.append(formValues()); toast(t(`تمت إضافة «${keyValue}» في الصف ${row} ✓`, `"${keyValue}" added in row ${row} ✓`)); }
        clearForm();
      } else if (action === "addRow") {
        const missing = missingRequired();
        if (missing.length) return toast(t("املأ الحقول المطلوبة: ", "Fill in the required fields: ") + missing.join("، "));
        if (rangeError()) return toast(rangeError());
        if (Object.values(formValues()).every(v => !String(v).trim())) return toast(t("الحقول فارغة.", "The fields are empty."));
        const repeated = duplicateError(await store.rows(), null);
        if (repeated) return toast(repeated);
        // Serial numbers: one more than the largest already in the column.
        const numbered = binds.filter(([c]) => bool(c, "autoNumber") && !(values[c.id] || "").trim());
        const assigned = [];
        if (numbered.length) {
          const rows = await store.rows();
          for (const [c, col] of numbered) { const next = nextNumber(rows, col, prop(c, "autoPrefix"), Math.trunc(num(c, "autoDigits"))); setValue(c, next); assigned.push(next); }
        }
        const row = await store.append(formValues());
        clearForm();
        toast(t(`تمت إضافة الصف رقم ${row} ✓`, `Row ${row} added ✓`) + (assigned.length ? " — " + assigned.join("، ") : ""));
      } else if (action === "search") {
        const field = button ? prop(button, "searchField") : "";
        const mode = (button && prop(button, "matchMode")) || "exact";
        const again = state.currentRow != null && sameForm(formValues(), state.filledSnapshot) && state.lastCriteria;
        const criteria = again ? state.lastCriteria : searchCriteria(field);
        state.resultsTarget = button ? prop(button, "targetScreen") : "";
        if (!Object.keys(criteria).length) {
          return toast(field ? t(`اكتب قيمة في حقل «${field}» ثم اضغط بحث.`, `Type a value in "${field}", then search.`)
            : t("اكتب قيمة في حقل أو أكثر ثم اضغط بحث.", "Type a value in one or more fields, then search."));
        }
        const rows = await store.rows();
        state.sheetRows = rows;
        state.lastCriteria = criteria;
        const found = searchAll(rows, criteria, mode);
        if (!found.length) toast(t("لا توجد نتيجة مطابقة.", "No matching row."));
        else if (found.length === 1) openRecord(rows, found[0], state.resultsTarget);
        else pickResult(rows, found);
      } else if (action === "updateRow") {
        const row = state.currentRow;
        if (row == null) return toast(t("ابحث عن الصف أولًا ثم عدّله.", "Search for the row first, then edit it."));
        const missing = missingRequired();
        if (missing.length) return toast(t("املأ الحقول المطلوبة: ", "Fill in the required fields: ") + missing.join("، "));
        if (rangeError()) return toast(rangeError());
        const repeated = duplicateError(await store.rows(), row);
        if (repeated) return toast(repeated);
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
      if (writes && String(e?.code || "").includes("permission-denied")) noAccess();
      else toast(opts.errorText(e));
    } finally {
      state.working = false;
    }
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
        h("div", { color: "#b9d9c9", fontSize: "14px" }, {}, t("يمكنك البحث والاطلاع على البيانات وتصديرها إلى Excel. لتتمكن من الحفظ والتعديل والحذف اطلب الصلاحية من صاحب التطبيق.",
          "You can search, view and export the data to Excel. To save, change or delete, ask the app's owner for access.")),
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
        if (prop(c, "stat")) {
          // The file counted: the screen's own unless another is chosen ("@main" = the main file).
          const chosen = prop(c, "statFile");
          const file = chosen === "@main" ? "" : chosen && (project.files || []).some(f => f.id === chosen) ? chosen : fileId;
          const update = () => {
            const rows = file === fileId ? state.sheetRows : rowsFor(file);
            if (!rows || rows.length < 1) { text.textContent = withStatistic(shownText || "", "…"); return; }
            const head = rows[0] || [];
            const colOfName = name => { const i = head.findIndex(x => normalize(x) === normalize(name)); return i < 0 ? null : i; };
            let numbers = rowsWhere(rows, prop(c, "statFilterColumn") ? colOfName(prop(c, "statFilterColumn")) : null, prop(c, "statFilterValue"));
            let kind = prop(c, "stat");
            if (kind === "mine") {
              // Records added by whoever is signed in (all of them when records keep no author, e.g. on this device only).
              const authors = (file === fileId ? store : storeOf(file))?.authors?.();
              if (authors && opts.user) numbers = numbers.filter(n => authors[n - 2] === opts.user.uid);
              kind = "count";
            }
            text.textContent = withStatistic(shownText || "", statistic(rows, numbers, kind, prop(c, "statColumn") ? colOfName(prop(c, "statColumn")) : null));
          };
          statLabels.push(update);
          update();
        }
        el.append(text);
        return el;
      }
      case "BUTTON": {
        const el = h("button", { ...chrome(c), ...style, width: "100%", height: "100%", cursor: enabled ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: justify(prop(c, "textAlign")) },
          { disabled: !enabled, onclick: () => perform(prop(c, "action"), prop(c, "targetScreen"), c) }, c.text);
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
          type: "date", disabled: !enabled,
          onchange: e => {
            if (!e.target.value) return;
            const [y, m, d] = e.target.value.split("-").map(Number);
            setValue(c, formatDate(c, new Date(Date.UTC(y, m - 1, d)), lang));
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
            fill(row);
            state.currentRow = number; state.lastCriteria = null; state.filledSnapshot = formValues();
            draw();
          } : null, view ? { column: view.columns.indexOf(sort.column), descending: sort.descending, onSort: k => {
            const orig = view.columns[k];
            tableSorts[c.id] = { column: orig, descending: sort.column === orig ? !sort.descending : false };
            draw();
          } } : null));
        };
        draw();
        if (fromSheet) tables.push(draw);
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
function drawTable(c, style, grid, currentRow, onPick, sort = null) {
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
    const th = cell((headers[k] ?? "") + arrow, true, sort ? { cursor: "pointer", userSelect: "none" } : {});
    if (sort) { th.title = "فرز"; th.addEventListener("click", () => sort.onSort(k)); }
    return th;
  };
  const cell = (text, head, extra = {}) => h(head ? "th" : "td", {
    ...(head ? headStyle : style), border: grid_, height: rowH + "px", padding: "0 4px", textAlign: align,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "1px", ...(minW > 0 ? { minWidth: minW + "px" } : {}), ...extra,
  }, { dir: "auto" }, text);
  const recordBg = i => i + 1 === currentRow - 1 ? "rgba(32,184,121,.3)" : (striped && i % 2 === 1 ? cssColor(prop(c, "gridColor")) : "transparent");
  const table = h("table", { borderCollapse: "collapse", width: minW > 0 ? "auto" : "100%", tableLayout: minW > 0 ? "auto" : "fixed" });
  if (!vertical) {
    table.append(h("tr", {}, {}, numbers ? cell("#", true, { width: "34px", maxWidth: "none" }) : null, Array.from({ length: fields }, (_, i) => headCell(i))));
    records.forEach((r, i) => table.append(h("tr", { background: recordBg(i), cursor: onPick ? "pointer" : "default" },
      { onclick: () => onPick && r.length && onPick(i + 1) },
      numbers ? cell(String(i + 1), false, { width: "34px", maxWidth: "none" }) : null,
      Array.from({ length: fields }, (_, k) => cell(r[k] ?? "", false)))));
  } else {
    if (numbers) table.append(h("tr", {}, {}, cell("#", true), records.map((_, i) => cell(String(i + 1), true))));
    for (let k = 0; k < fields; k++) {
      table.append(h("tr", {}, {}, headCell(k),
        records.map((r, i) => cell(r[k] ?? "", false, { background: recordBg(i), cursor: onPick ? "pointer" : "default" }))));
    }
    if (onPick) table.querySelectorAll("tr").forEach(tr => [...tr.children].slice(1).forEach((td, i) => td.addEventListener("click", () => records[i]?.length && onPick(i + 1))));
  }
  return table;
}
