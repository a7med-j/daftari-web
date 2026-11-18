// The standalone runner of an exported web app (one app, no Waraqa screens around it): offline with
// its data in this browser, or signed in to the team's cloud table. Used by app.html (hosted link)
// and inlined into exported .html files by the Waraqa app (WebExport.kt), so keep it self-contained.
import { runApp, offlineTable, isStrongPassword, rememberPassword, securityGate, lockChoice, lockSettings } from "./render.js";

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
  // "Share the app": the phone's share sheet with the app's link, or the link copied.
  const appLink = () => (/^https?:$/.test(location.protocol) ? location.href.split("#")[0] : CONFIG.link || "");
  const shareApp = async () => {
    const url = appLink();
    if (!url) return toast(t("لا يوجد رابط لهذا التطبيق بعد.", "This app has no link yet."));
    const text = t(`افتح تطبيق «${CONFIG.name}»:`, `Open the "${CONFIG.name}" app:`);
    try {
      if (navigator.share) return await navigator.share({ title: CONFIG.name, text, url });
    } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); toast(t("تم نسخ رابط التطبيق، أرسله لمن تريد.", "The app's link was copied; send it to anyone.")); }
    catch (e) { prompt(t("انسخ رابط التطبيق:", "Copy the app's link:"), url); }
  };
  const shareItem = [t("مشاركة التطبيق", "Share the app"), shareApp];
  menuBtn.onclick = () => { menu.style.display = menu.style.display === "block" ? "none" : "block"; };
  document.addEventListener("click", e => { if (e.target !== menuBtn && !menu.contains(e.target)) menu.style.display = "none"; });

  // A file opened from a phone's storage runs with no web address: the browser gives it no storage
  // and Firebase can't sign in. Then the app's link (when it has one) is the way to open it.
  const fromFile = !/^https?:$/.test(location.protocol);
  const storageWorks = () => new Promise(resolve => {
    try {
      const req = indexedDB.open("waraqa-check");
      req.onsuccess = () => { req.result.close(); resolve(true); };
      req.onerror = req.onblocked = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    } catch (e) { resolve(false); }
  });
  if (fromFile && (CONFIG.mode === "cloud" || !(await storageWorks()))) {
    stage.replaceChildren(node("div", { class: "center" },
      node("img", { src: ICON, alt: "" }), node("h2", {}, CONFIG.name),
      node("p", { class: "muted" }, CONFIG.mode === "cloud"
        ? t("هذا التطبيق مشترك ويحتاج تسجيل الدخول، وهذا لا يعمل من ملف على الجهاز. افتحه من رابطه:", "This shared app needs sign-in, which doesn't work from a file on the device. Open it from its link:")
        : t("المتصفح لا يسمح لهذا الملف بحفظ البيانات على هذا الجهاز. افتحه من رابطه:", "The browser won't let this file save data on this device. Open it from its link:")),
      CONFIG.link ? node("a", { class: "btn", href: CONFIG.link, style: "text-decoration:none" }, t("افتح التطبيق", "Open the app")) : null));
    return;
  }

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
  function localStore(fileId = "") {
    const file = (project.files || []).find(f => f.id === fileId);
    const headers = file ? file.link.headers || [] : CONFIG.headers || [];
    const dbName = "waraqa-" + CONFIG.id + (fileId ? "-" + fileId : "");
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
    const extra = {};
    setMenu([shareItem, [t("تصدير البيانات إلى Excel", "Export data to Excel"), () => exportExcel(store)]]);
    runApp(stage, project, store, {
      lang, t, toast, confirm: confirmBox, errorText,
      storeFor: id => (project.files || []).some(f => f.id === id) ? (extra[id] ||= localStore(id)) : null,
      onScreen: screen => { document.body.style.background = bg(screen); },
    });
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
    // Data read once stays in this browser, so the app opens and works without a connection.
    try { fb.db = fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }) }); }
    catch (e) { fb.db = fsMod.getFirestore(app); }
  } catch (e) {
    stage.replaceChildren(node("div", { class: "center" }, node("p", {}, t("هذا التطبيق يحتاج اتصالًا بالإنترنت.", "This app needs an internet connection."))));
    return;
  }
  const { db } = fb;
  const CHUNK = 200;
  const chunkId = i => "c" + String(i).padStart(5, "0");
  const chunkIndex = id => (/^c\d+$/.test(id) ? Number(id.slice(1)) : null);
  const readRows = raw => (Array.isArray(raw) ? raw : []).map(m => ({ ...(m || {}), id: String(m?.id ?? ""), c: (m?.c || []).map(v => String(v ?? "")) }));
  // Who adds a record (kept with it, so the owner can count each member's records).
  const authorOf = user => ({ by: user?.uid || "", byName: (user?.displayName || "").trim() || user?.email || "", at: String(Date.now()) });

  function cloudStore(appId, headers, fileId = "", offline = true) {
    const col = fileId ? fb.collection(db, "apps", appId, "tables", fileId, "chunks") : fb.collection(db, "apps", appId, "chunks");
    const photoCache = new Map();
    // Works offline too: changes wait in this browser and go up when the connection is back.
    const table = offlineTable({ db, doc: fb.doc, getDocs: fb.getDocs, getDocsFromServer: fb.getDocsFromServer, getDocsFromCache: fb.getDocsFromCache, runTransaction: fb.runTransaction, serverTimestamp: fb.serverTimestamp },
      col, headers, () => authorOf(fb.auth.currentUser), offline);
    return Object.assign(table, {
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
    });
  }

  async function join(user) {
    const codeDoc = await fb.getDoc(fb.doc(db, "shareCodes", CONFIG.shareCode));
    if (!codeDoc.exists() || codeDoc.data().appId !== CONFIG.appId) throw fail("not-found-code");
    if (codeDoc.data().ownerUid !== user.uid) {
      const fields = { code: CONFIG.shareCode, email: user.email || "", name: (user.displayName || "").trim(), joinedAt: Date.now() };
      const ref = fb.doc(db, "apps", CONFIG.appId, "members", user.uid);
      // Editors at once when the owner chose so (the rules refuse it otherwise, then as a viewer).
      await fb.setDoc(ref, { ...fields, role: "editor" })
        .catch(e => { if (!String(e.code).includes("permission-denied")) throw e; return fb.setDoc(ref, fields); });
    }
  }

  let unlockedUid = null;
  /** A document from this browser's kept copy when there is one (opens at once), otherwise from the server. */
  const keptDoc = async ref => { try { const c = await fb.getDocFromCache(ref); if (c.exists()) return c; } catch (e) {} return null; };

  async function openShared(user, fromServer = false) {
    stage.replaceChildren(node("div", { class: "center" }, node("p", { class: "muted" }, t("جارٍ الفتح…", "Opening…"))));
    try {
      const appRef = fb.doc(db, "apps", CONFIG.appId);
      let snap = fromServer ? null : await keptDoc(appRef);
      const kept = !!snap;
      if (!snap) {
        try { snap = await fb.getDoc(appRef); }
        catch (e) { if (!String(e.code).includes("permission-denied")) throw e; await join(user); snap = await fb.getDoc(appRef); }
      }
      if (!snap.exists()) throw fail("not-found-code");
      // Opened from the kept copy: the server is asked in the background. A new design or settings
      // are kept for next time; if access was removed or the app paused, it opens again from the server
      // (which shows why).
      if (kept) fb.getDocFromServer(appRef).then(s => { if (!s.exists()) openShared(user, true); })
        .catch(e => { if (String(e.code).includes("permission-denied")) openShared(user, true); });
      const data = snap.data();
      const latest = JSON.parse(data.json); // the owner's latest published design
      // The owner's security settings (My apps → Security): password check, lock, working offline.
      const security = { strongPasswords: true, lock: true, lockAfterMinutes: 2, offline: true, ...(data.security || {}) };
      try { localStorage.setItem("waraqa-sec:" + CONFIG.appId, JSON.stringify(security)); } catch (e) {}
      const locks = lockChoice(CONFIG.appId, user.uid, security);
      if (unlockedUid !== user.uid && !user.isAnonymous) {
        await securityGate({
          uid: user.uid, email: user.email, name: user.displayName, el: stage, t, lang,
          checkPassword: security.strongPasswords, device: locks.device, password: locks.password, lockAfterMs: security.lockAfterMinutes * 60000,
          verify: pw => fb.reauthenticateWithCredential(user, fb.EmailAuthProvider.credential(user.email, pw)),
          change: pw => fb.updatePassword(user, pw),
          signOut: () => fb.signOut(fb.auth),
        });
        if (fb.auth.currentUser !== user) return;
        unlockedUid = user.uid;
      }
      const store = cloudStore(CONFIG.appId, data.headers || [], "", security.offline);
      const storeFor = id => { const f = (latest.files || []).find(x => x.id === id); return f ? cloudStore(CONFIG.appId, f.link.headers || [], id, security.offline) : null; };
      // The owner and members the owner made editors may change records; other members only look.
      const owner = data.ownerUid === user.uid;
      const memberRef = fb.doc(db, "apps", CONFIG.appId, "members", user.uid);
      const member = owner ? null : (await keptDoc(memberRef)) || await fb.getDoc(memberRef).catch(() => null);
      if (!owner && kept) fb.getDocFromServer(memberRef).catch(() => {}); // the role, fresh for next time
      const editor = owner || member?.data()?.role === "editor";
      const canEdit = editor;
      // The owner's choices: who deletes, who exports, whether viewers may ask for rights.
      const canDelete = owner || (editor && security.whoDeletes !== "owner");
      const who = security.whoExports || "everyone";
      const canExport = owner || who === "everyone" || (who === "editors" && editor);
      const requestAccess = security.allowRequests === false ? null : () => fb.setDoc(fb.doc(db, "apps", CONFIG.appId, "requests", user.uid), { email: user.email || "", name: (user.displayName || "").trim(), at: Date.now() });
      setMenu([
        shareItem,
        canExport ? [t("تصدير البيانات إلى Excel", "Export data to Excel"), () => exportExcel(store)] : null,
        // Each member picks the locks they want on their device (the owner's required ones stay on).
        user.isAnonymous ? null : [t("قفل التطبيق", "App lock"), () => lockSettings({ appId: CONFIG.appId, uid: user.uid, security, t, lang,
          onSaved: () => toast(t("تم حفظ إعدادات القفل.", "Lock settings saved.")) })],
        [user.isAnonymous ? t("خروج الضيف", "Leave as guest") : t("تسجيل الخروج", "Sign out"), () => { guestLeft = true; fb.signOut(fb.auth); }],
      ].filter(Boolean));
      runApp(stage, latest, store, { lang, t, toast, confirm: confirmBox, errorText, canEdit, canDelete, canExport, requestAccess, storeFor,
        user: { uid: user.uid, name: (user.displayName || pendingName || "").trim(), email: user.email || "" }, onScreen: screen => { document.body.style.background = bg(screen); } });
    } catch (e) {
      // Paused, or no longer open to guests: say so plainly.
      const info = await publicInfo();
      const text = info?.paused ? (info.pausedMessage || t("التطبيق متوقف مؤقتًا من صاحبه.", "The app is paused by its owner."))
        : user.isAnonymous && !info?.guests ? t("صاحب التطبيق أوقف الدخول بدون حساب. سجّل دخولك بحسابك.", "The owner no longer allows guests. Sign in with your account.")
        : errorText(e);
      stage.replaceChildren(node("div", { class: "center" }, node("p", {}, text),
        node("button", { class: "lnk", onclick: () => { guestLeft = true; fb.signOut(fb.auth); } }, t("تسجيل الخروج", "Sign out"))));
    }
  }

  /** What anyone may know before signing in: guests allowed, paused. */
  async function publicInfo() {
    try { return (await fb.getDoc(fb.doc(db, "publicApps", CONFIG.appId))).data() || null; } catch (e) { return null; }
  }
  let guestLeft = false; // a guest who left sees the sign-in page instead of entering again

  function loginView() {
    setMenu([]);
    document.body.style.background = "";
    let signUp = false;
    const email = node("input", { type: "email", placeholder: t("البريد الإلكتروني", "Email"), autocomplete: "email" });
    const pass = node("input", { type: "password", placeholder: t("كلمة المرور", "Password"), autocomplete: "current-password" });
    const firstName = node("input", { placeholder: t("الاسم الأول", "First name"), autocomplete: "given-name", maxlength: "40" });
    firstName.hidden = true;
    const go = node("button", { class: "btn" });
    const toggle = node("button", { class: "lnk" });
    const msg = node("p", { class: "muted" });
    const forgot = node("button", { class: "lnk" }, t("نسيت كلمة المرور؟", "Forgot password?"));
    forgot.onclick = async () => {
      if (!email.value.trim()) { msg.textContent = t("اكتب بريدك الإلكتروني أولًا ثم اضغط «نسيت كلمة المرور».", "Type your email first, then tap \"Forgot password\"."); return; }
      try { await fb.sendPasswordResetEmail(fb.auth, email.value.trim()); msg.textContent = t("أرسلنا رابط إعادة تعيين كلمة المرور إلى بريدك (تحقق من البريد غير الهام).", "We sent a password reset link to your email (check spam too)."); }
      catch (e) { msg.textContent = errorText(e); }
    };
    const paint = () => { go.textContent = signUp ? t("إنشاء حساب", "Create account") : t("تسجيل الدخول", "Sign in"); toggle.textContent = signUp ? t("لدي حساب", "I have an account") : t("حساب جديد", "New account"); };
    paint();
    toggle.onclick = () => { signUp = !signUp; forgot.hidden = signUp; firstName.hidden = !signUp; paint(); };
    go.onclick = async () => {
      if (signUp && !firstName.value.trim()) { msg.textContent = t("اكتب اسمك الأول.", "Enter your first name."); return; }
      const strongRule = (() => { try { return JSON.parse(localStorage.getItem("waraqa-sec:" + CONFIG.appId) || "{}").strongPasswords !== false; } catch (e) { return true; } })();
      if (signUp && strongRule && !isStrongPassword(pass.value)) { msg.textContent = t("كلمة المرور ضعيفة: 8 خانات على الأقل، فيها حروف وأرقام.", "Password too weak: at least 8 characters, with letters and digits."); return; }
      go.disabled = true; msg.textContent = "";
      try {
        if (signUp) {
          pendingName = firstName.value.trim();
          const made = await fb.createUserWithEmailAndPassword(fb.auth, email.value.trim(), pass.value);
          await fb.updateProfile(made.user, { displayName: pendingName });
          await rememberPassword(made.user.uid, pass.value);
          openShared(made.user);
        } else {
          pendingName = "\u0000"; // opens after the password is remembered
          const signed = await fb.signInWithEmailAndPassword(fb.auth, email.value.trim(), pass.value);
          await rememberPassword(signed.user.uid, pass.value);
          pendingName = "";
          (signed.user.displayName || "").trim() ? openShared(signed.user) : nameView(signed.user);
        }
      }
      catch (e) { pendingName = ""; msg.textContent = errorText(e); }
      go.disabled = false;
    };
    stage.replaceChildren(node("div", { class: "center" },
      node("img", { src: ICON, alt: "" }), node("h2", {}, CONFIG.name), node("p", { class: "muted" }, t("سجّل دخولك للمتابعة", "Sign in to continue")),
      firstName, email, pass, go, toggle, forgot, msg));
  }
  let pendingName = "";

  /** Accounts made before first names were asked for give one, so the app's owner knows who they are. */
  function nameView(user) {
    const input = node("input", { placeholder: t("الاسم الأول", "First name"), autocomplete: "given-name", maxlength: "40" });
    const save = node("button", { class: "btn" }, t("حفظ", "Save"));
    const msg = node("p", { class: "muted" });
    save.onclick = async () => {
      const name = input.value.trim();
      if (!name) { msg.textContent = t("اكتب اسمك الأول.", "Enter your first name."); return; }
      save.disabled = true;
      try {
        await fb.updateProfile(user, { displayName: name });
        await fb.setDoc(fb.doc(db, "apps", CONFIG.appId, "members", user.uid), { name }, { merge: true }).catch(() => {});
        openShared(user);
      } catch (e) { msg.textContent = errorText(e); save.disabled = false; }
    };
    stage.replaceChildren(node("div", { class: "center" }, node("img", { src: ICON, alt: "" }),
      node("h2", {}, t("اكتب اسمك الأول", "Enter your first name")),
      node("p", { class: "muted" }, t("حتى يعرفك صاحب التطبيق ويرى ما أضفته.", "So the app's owner knows who you are and what you added.")),
      input, save, msg));
  }

  fb.onAuthStateChanged(fb.auth, async user => {
    if (!user) {
      // Apps open to guests skip the sign-in page: a guest account, then the first name.
      const info = guestLeft ? null : await publicInfo();
      if (info?.guests) {
        try { await fb.signInAnonymously(fb.auth); return; } catch (e) { /* guests not enabled in Firebase: sign in instead */ }
      }
      return loginView();
    }
    if (pendingName) return; // the new account's name is being saved, then it opens
    (user.displayName || "").trim() ? openShared(user) : nameView(user);
  });
}
