// The standalone runner of an exported web app (one app, no Waraqa screens around it): offline with
// its data in this browser, or signed in to the team's cloud table. Used by app.html (hosted link)
// and inlined into exported .html files by the Waraqa app (WebExport.kt), so keep it self-contained.
import { runApp } from "./render.js";

// ---- The exported app's shell: runs the one app above, offline in this browser or on the team's cloud table ----
export async function runStandalone(CONFIG, ICON) {
  const FIREBASE = {
    apiKey: "AIzaSyBLGHPwv6Gd9hfEIHa4rqNJ-lnqdb6NH_w", authDomain: "daftari-68543.firebaseapp.com", projectId: "daftari-68543",
    storageBucket: "daftari-68543.firebasestorage.app", messagingSenderId: "199459850912", appId: "1:199459850912:web:74239d3c03fe44d6a017c5",
  };
  const lang = document.documentElement.lang === "en" ? "en" : "ar";
  const t = (ar, en) => (lang === "en" ? en : ar);
  const stage = document.getElementById("stage");
  const menuBtn = document.getElementById("menuBtn");
  const menu = document.getElementById("menu");
  let timer;
  const toast = m => { const b = document.getElementById("toast"); b.textContent = m; b.classList.add("show"); clearTimeout(timer); timer = setTimeout(() => b.classList.remove("show"), 3500); };
  const confirmBox = m => Promise.resolve(window.confirm(m));
  const fail = code => Object.assign(new Error(code), { code });
  const errorText = e => {
    const code = e?.code || "";
    if (code.includes("unavailable") || code.includes("network")) return t("لا يوجد اتصال بالإنترنت.", "No internet connection.");
    if (code.includes("permission-denied")) return t("ليست لديك صلاحية على هذا التطبيق.", "You don't have access to this app.");
    if (code === "not-found-code") return t("تغيّر رمز هذا التطبيق. اطلب نسخة جديدة من صاحبه.", "This app's code changed. Ask its owner for a new copy.");
    if (code === "app-gone") return t("هذا السجل لم يعد موجودًا.", "That record no longer exists.");
    if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return t("البريد أو كلمة المرور غير صحيحة.", "Wrong email or password.");
    if (code.includes("email-already-in-use")) return t("هذا البريد مسجّل مسبقًا. سجّل الدخول.", "This email already has an account. Sign in.");
    if (code.includes("weak-password")) return t("كلمة المرور ضعيفة: 6 أحرف على الأقل.", "Password too weak: at least 6 characters.");
    if (code.includes("invalid-email")) return t("اكتب بريدًا إلكترونيًا صحيحًا.", "Enter a valid email.");
    if (code === "quota") return t("امتلأت مساحة المتصفح.", "The browser's storage is full.");
    return t("حدث خطأ. حاول مرة أخرى.", "Something went wrong. Try again.") + (code ? ` (${code})` : "");
  };
  const node = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); }
    e.append(...kids.flat().filter(k => k != null));
    return e;
  };
  const bg = screen => {
    const hex = ((screen.properties || {}).backgroundColor || "#FFF7FAF8").replace("#", "");
    if (hex.length !== 8) return "#" + hex;
    return `rgba(${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${parseInt(hex.slice(6, 8), 16)},${parseInt(hex.slice(0, 2), 16) / 255})`;
  };
  const setMenu = items => {
    menu.replaceChildren(...items.map(([label, fn]) => node("button", { onclick: () => { menu.style.display = "none"; fn(); } }, label)));
    menuBtn.style.display = items.length ? "block" : "none";
  };
  menuBtn.onclick = () => { menu.style.display = menu.style.display === "block" ? "none" : "block"; };
  document.addEventListener("click", e => { if (e.target !== menuBtn && !menu.contains(e.target)) menu.style.display = "none"; });

  const project = JSON.parse(CONFIG.projectJson);
  const start = store => runApp(stage, project, store, {
    lang, t, toast, confirm: confirmBox, errorText,
    onScreen: screen => { document.body.style.background = bg(screen); },
  });

  // ---- Excel file of the records (a minimal .xlsx: inline strings, numbers as numbers) ----
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = bytes => { let c = 0xFFFFFFFF; for (const b of bytes) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const [name, text] of files) {
      const data = enc.encode(text), nameBytes = enc.encode(name), crc = crc32(data);
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
  function xlsx(sheetName, rows) {
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
    return zip([
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E7145"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`],
      ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"${lang === "ar" ? ' rightToLeft="1"' : ""}/></sheetViews><sheetData>${body}</sheetData></worksheet>`],
    ]);
  }
  const download = (blob, name) => {
    const a = node("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
  };
  const exportExcel = async store => {
    try { download(xlsx(project.name, await store.rows()), (project.name || "data").replace(/[\\/:*?"<>|]+/g, "_") + ".xlsx"); }
    catch (e) { toast(errorText(e)); }
  };

  // ---- Personal: records and photos kept in this browser (IndexedDB) ----
  function localStore() {
    const headers = CONFIG.headers || [];
    const dbName = "waraqa-" + CONFIG.id;
    const opened = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore("table"); req.result.createObjectStore("photos"); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const op = (store, mode, fn) => opened.then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error?.name === "QuotaExceededError" ? fail("quota") : tx.error);
    }));
    const load = async () => (await op("table", "readonly", s => s.get("rows"))) || [];
    const save = rows => op("table", "readwrite", s => s.put(rows, "rows"));
    const cells = values => Array.from({ length: Math.max(headers.length, ...Object.keys(values).map(k => Number(k) + 1)) }, (_, i) => values[i] ?? "");
    const urls = new Map();
    return {
      headers,
      async rows() { return [headers, ...(await load())]; },
      async append(values) { const rows = await load(); rows.push(cells(values)); await save(rows); return rows.length + 1; },
      async update(number, values) {
        const rows = await load(), row = rows[number - 2];
        if (!row) throw fail("app-gone");
        for (const [k, v] of Object.entries(values)) { while (row.length <= Number(k)) row.push(""); row[Number(k)] = v; }
        await save(rows);
      },
      async delete(number) { const rows = await load(); if (!rows[number - 2]) throw fail("app-gone"); rows.splice(number - 2, 1); await save(rows); },
      async savePhoto(name, jpeg) { await op("photos", "readwrite", s => s.put(jpeg, name)); },
      async loadPhoto(name) {
        if (!urls.has(name)) {
          const jpeg = await op("photos", "readonly", s => s.get(name));
          urls.set(name, jpeg ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(new Blob([jpeg], { type: "image/jpeg" })); }) : null);
        }
        return urls.get(name);
      },
    };
  }

  if (CONFIG.mode !== "cloud") {
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    const store = localStore();
    setMenu([[t("تصدير البيانات إلى Excel", "Export data to Excel"), () => exportExcel(store)]]);
    start(store);
    return;
  }

  // ---- Shared: sign in, join the published app with its code, run on its cloud table ----
  const V = "https://www.gstatic.com/firebasejs/10.14.1/";
  let fb;
  try {
    const [appMod, authMod, fsMod] = await Promise.all([import(V + "firebase-app.js"), import(V + "firebase-auth.js"), import(V + "firebase-firestore.js")]);
    fb = { ...authMod, ...fsMod };
    const app = appMod.initializeApp(FIREBASE);
    fb.auth = authMod.getAuth(app);
    fb.db = fsMod.getFirestore(app);
  } catch (e) {
    stage.replaceChildren(node("div", { class: "center" }, node("p", {}, t("هذا التطبيق يحتاج اتصالًا بالإنترنت.", "This app needs an internet connection."))));
    return;
  }
  const { db } = fb;
  const CHUNK = 200;
  const chunkId = i => "c" + String(i).padStart(5, "0");
  const chunkIndex = id => (/^c\d+$/.test(id) ? Number(id.slice(1)) : null);
  const readRows = raw => (Array.isArray(raw) ? raw : []).map(m => ({ id: String(m?.id ?? ""), c: (m?.c || []).map(v => String(v ?? "")) }));

  function cloudStore(appId, headers) {
    const col = fb.collection(db, "apps", appId, "chunks");
    let snapshot = [];
    const photoCache = new Map();
    async function change(number, transform) {
      const target = snapshot[number - 2];
      if (!target) throw fail("app-gone");
      const ref = fb.doc(col, target.chunk);
      await fb.runTransaction(db, async tx => {
        const rows = readRows((await tx.get(ref)).data()?.rows), edited = [];
        for (const r of rows) { if (r.id !== target.id) edited.push(r); else { const c = transform(r.c); if (c) edited.push({ id: r.id, c }); } }
        tx.set(ref, { rows: edited, updatedAt: fb.serverTimestamp() });
      });
    }
    return {
      headers,
      async rows() {
        const docs = (await fb.getDocs(col)).docs.sort((a, b) => (a.id < b.id ? -1 : 1));
        snapshot = docs.flatMap(d => readRows(d.data().rows).map(r => ({ ...r, chunk: d.id })));
        return [headers, ...snapshot.map(r => r.c)];
      },
      async append(values) {
        const width = Math.max(headers.length, ...Object.keys(values).map(k => Number(k) + 1));
        const cells = Array.from({ length: width }, (_, i) => values[i] ?? "");
        const ids = (await fb.getDocs(col)).docs.map(d => chunkIndex(d.id)).filter(i => i != null);
        const last = ids.length ? Math.max(...ids) : null;
        const row = { id: crypto.randomUUID(), c: cells };
        await fb.runTransaction(db, async tx => {
          const lastRows = last == null ? [] : readRows((await tx.get(fb.doc(col, chunkId(last)))).data()?.rows);
          const target = last == null ? 0 : lastRows.length >= CHUNK ? last + 1 : last;
          const existing = target === last ? lastRows : readRows((await tx.get(fb.doc(col, chunkId(target)))).data()?.rows);
          tx.set(fb.doc(col, chunkId(target)), { rows: [...existing, row], updatedAt: fb.serverTimestamp() });
        });
        return (await this.rows()).length;
      },
      async update(number, values) {
        await change(number, cells => { const out = [...cells]; for (const [k, v] of Object.entries(values)) { while (out.length <= Number(k)) out.push(""); out[Number(k)] = v; } return out; });
      },
      async delete(number) { await change(number, () => null); },
      async savePhoto(name, jpeg) {
        await fb.setDoc(fb.doc(db, "apps", appId, "photos", name), { data: fb.Bytes.fromUint8Array(jpeg), createdAt: fb.serverTimestamp() });
        photoCache.set(name, URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" })));
      },
      async loadPhoto(name) {
        if (!photoCache.has(name)) photoCache.set(name, (async () => {
          const data = (await fb.getDoc(fb.doc(db, "apps", appId, "photos", name))).data()?.data;
          if (!data) return null;
          return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(new Blob([data.toUint8Array()], { type: "image/jpeg" })); });
        })());
        return await photoCache.get(name);
      },
    };
  }

  async function join(user) {
    const codeDoc = await fb.getDoc(fb.doc(db, "shareCodes", CONFIG.shareCode));
    if (!codeDoc.exists() || codeDoc.data().appId !== CONFIG.appId) throw fail("not-found-code");
    if (codeDoc.data().ownerUid !== user.uid) {
      await fb.setDoc(fb.doc(db, "apps", CONFIG.appId, "members", user.uid), { code: CONFIG.shareCode, email: user.email || "", joinedAt: Date.now() });
    }
  }

  async function openShared(user) {
    stage.replaceChildren(node("div", { class: "center" }, node("p", { class: "muted" }, t("جارٍ الفتح…", "Opening…"))));
    try {
      let snap;
      try { snap = await fb.getDoc(fb.doc(db, "apps", CONFIG.appId)); }
      catch (e) { if (!String(e.code).includes("permission-denied")) throw e; await join(user); snap = await fb.getDoc(fb.doc(db, "apps", CONFIG.appId)); }
      if (!snap.exists()) throw fail("not-found-code");
      const data = snap.data();
      const latest = JSON.parse(data.json); // the owner's latest published design
      const store = cloudStore(CONFIG.appId, data.headers || []);
      setMenu([
        [t("تصدير البيانات إلى Excel", "Export data to Excel"), () => exportExcel(store)],
        [t("تسجيل الخروج", "Sign out"), () => fb.signOut(fb.auth)],
      ]);
      runApp(stage, latest, store, { lang, t, toast, confirm: confirmBox, errorText, onScreen: screen => { document.body.style.background = bg(screen); } });
    } catch (e) {
      stage.replaceChildren(node("div", { class: "center" }, node("p", {}, errorText(e)),
        node("button", { class: "lnk", onclick: () => fb.signOut(fb.auth) }, t("تسجيل الخروج", "Sign out"))));
    }
  }

  function loginView() {
    setMenu([]);
    document.body.style.background = "";
    let signUp = false;
    const email = node("input", { type: "email", placeholder: t("البريد الإلكتروني", "Email"), autocomplete: "email" });
    const pass = node("input", { type: "password", placeholder: t("كلمة المرور", "Password"), autocomplete: "current-password" });
    const go = node("button", { class: "btn" });
    const toggle = node("button", { class: "lnk" });
    const msg = node("p", { class: "muted" });
    const paint = () => { go.textContent = signUp ? t("إنشاء حساب", "Create account") : t("تسجيل الدخول", "Sign in"); toggle.textContent = signUp ? t("لدي حساب", "I have an account") : t("حساب جديد", "New account"); };
    paint();
    toggle.onclick = () => { signUp = !signUp; paint(); };
    go.onclick = async () => {
      go.disabled = true; msg.textContent = "";
      try { await (signUp ? fb.createUserWithEmailAndPassword : fb.signInWithEmailAndPassword)(fb.auth, email.value.trim(), pass.value); }
      catch (e) { msg.textContent = errorText(e); }
      go.disabled = false;
    };
    stage.replaceChildren(node("div", { class: "center" },
      node("img", { src: ICON, alt: "" }), node("h2", {}, CONFIG.name), node("p", { class: "muted" }, t("سجّل دخولك للمتابعة", "Sign in to continue")),
      email, pass, go, toggle, msg));
  }

  fb.onAuthStateChanged(fb.auth, user => (user ? openShared(user) : loginView()));
}
