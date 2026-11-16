// Waraqa (formerly Daftari) on the web: sign in, open apps you own or joined (or join with a code from a link),
// and run them on their shared table. Same Firebase project and data as the Android app.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where, runTransaction, serverTimestamp, Bytes,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";
import { runApp } from "./render.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

// ---- Language ----
let lang = localStorage.getItem("lang") || (navigator.language || "ar").slice(0, 2);
if (lang !== "en") lang = "ar";
const t = (ar, en) => (lang === "en" ? en : ar);
function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
  document.title = t("ورقة", "Waraqa");
}
applyLang();

// ---- Small helpers ----
const $app = document.getElementById("app");
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}
let toastTimer;
function toast(message) {
  const box = document.getElementById("toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 3500);
}
function confirmBox(message) {
  return Promise.resolve(window.confirm(message));
}

/** Plain-language message for Firebase failures. */
function errorText(e) {
  const code = e?.code || "";
  if (code.includes("unavailable") || code.includes("network")) return t("لا يوجد اتصال بالإنترنت.", "No internet connection.");
  if (code.includes("permission-denied")) return t("ليست لديك صلاحية على هذا التطبيق.", "You don't have access to this app.");
  if (code === "not-found-code") return t("الرمز غير صحيح.", "That code doesn't exist.");
  if (code === "app-gone") return t("هذا التطبيق لم يعد موجودًا.", "This app no longer exists.");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return t("البريد أو كلمة المرور غير صحيحة.", "Wrong email or password.");
  if (code.includes("email-already-in-use")) return t("هذا البريد مسجّل مسبقًا. سجّل الدخول بدلًا من ذلك.", "This email already has an account. Sign in instead.");
  if (code.includes("weak-password")) return t("كلمة المرور ضعيفة: 6 أحرف على الأقل.", "Password too weak: at least 6 characters.");
  if (code.includes("invalid-email")) return t("اكتب بريدًا إلكترونيًا صحيحًا.", "Enter a valid email.");
  if (code.includes("too-many-requests")) return t("محاولات كثيرة. انتظر قليلًا.", "Too many attempts. Wait a little.");
  return t("حدث خطأ. حاول مرة أخرى.", "Something went wrong. Try again.") + (code ? ` (${code})` : "");
}
const fail = code => Object.assign(new Error(code), { code });

// Share code from the link: ?code=K7QP-M2XD
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function normalizeCode(input) {
  const clean = (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 8 || [...clean].some(ch => !ALPHABET.includes(ch))) return null;
  return clean.slice(0, 4) + "-" + clean.slice(4);
}
let pendingCode = normalizeCode(new URLSearchParams(location.search).get("code"));

// ---- Shared table (same layout as the Android app: apps/{id}/chunks/cNNNNN, 200 rows each) ----
const CHUNK = 200;
const chunkId = i => "c" + String(i).padStart(5, "0");
const chunkIndex = id => (/^c\d+$/.test(id) ? Number(id.slice(1)) : null);
const readRows = raw => (Array.isArray(raw) ? raw : []).map(m => ({ id: String(m?.id ?? ""), c: (m?.c || []).map(v => String(v ?? "")) }));

function cloudStore(appId, headers) {
  const col = collection(db, "apps", appId, "chunks");
  let snapshot = []; // { id, chunk, c } in table order; index 0 is row 2
  const photoCache = new Map();
  return {
    headers,
    async rows() {
      const docs = (await getDocs(col)).docs.sort((a, b) => (a.id < b.id ? -1 : 1));
      snapshot = docs.flatMap(d => readRows(d.data().rows).map(r => ({ ...r, chunk: d.id })));
      return [headers, ...snapshot.map(r => r.c)];
    },
    async append(values) {
      const width = Math.max(headers.length, ...Object.keys(values).map(k => Number(k) + 1));
      const cells = Array.from({ length: width }, (_, i) => values[i] ?? "");
      const ids = (await getDocs(col)).docs.map(d => chunkIndex(d.id)).filter(i => i != null);
      const last = ids.length ? Math.max(...ids) : null;
      const row = { id: crypto.randomUUID(), c: cells };
      await runTransaction(db, async tx => {
        const lastRows = last == null ? [] : readRows((await tx.get(doc(col, chunkId(last)))).data()?.rows);
        const target = last == null ? 0 : lastRows.length >= CHUNK ? last + 1 : last;
        const existing = target === last ? lastRows : readRows((await tx.get(doc(col, chunkId(target)))).data()?.rows);
        tx.set(doc(col, chunkId(target)), { rows: [...existing, row], updatedAt: serverTimestamp() });
      });
      return (await this.rows()).length;
    },
    async update(number, values) {
      await change(number, cells => {
        const out = [...cells];
        for (const [k, v] of Object.entries(values)) { while (out.length <= Number(k)) out.push(""); out[Number(k)] = v; }
        return out;
      });
    },
    async delete(number) {
      await change(number, () => null);
    },
    // Photos: one compressed JPEG per document, shown from a small in-memory cache.
    async savePhoto(name, jpeg) {
      await setDoc(doc(db, "apps", appId, "photos", name), { data: Bytes.fromUint8Array(jpeg), createdAt: serverTimestamp() });
      photoCache.set(name, URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" })));
    },
    async loadPhoto(name) {
      if (!photoCache.has(name)) {
        photoCache.set(name, (async () => {
          const snap = await getDoc(doc(db, "apps", appId, "photos", name));
          const data = snap.data()?.data;
          if (!data) return null;
          const blob = new Blob([data.toUint8Array()], { type: "image/jpeg" });
          return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        })());
      }
      return await photoCache.get(name);
    },
  };
  async function change(number, transform) {
    const target = snapshot[number - 2];
    if (!target) throw fail("app-gone");
    const ref = doc(col, target.chunk);
    await runTransaction(db, async tx => {
      const rows = readRows((await tx.get(ref)).data()?.rows);
      const edited = [];
      for (const r of rows) {
        if (r.id !== target.id) edited.push(r);
        else { const c = transform(r.c); if (c) edited.push({ id: r.id, c }); }
      }
      tx.set(ref, { rows: edited, updatedAt: serverTimestamp() });
    });
  }
}

// ---- Sharing ----
async function join(user, code) {
  const codeDoc = await getDoc(doc(db, "shareCodes", code));
  if (!codeDoc.exists()) throw fail("not-found-code");
  const { appId, ownerUid } = codeDoc.data();
  if (ownerUid !== user.uid) {
    // Already a member: joining again keeps the membership (and the access the owner gave).
    const member = await getDoc(doc(db, "apps", appId, "members", user.uid)).catch(() => null);
    if (!member?.exists()) await setDoc(doc(db, "apps", appId, "members", user.uid), { code, email: user.email || "", joinedAt: Date.now() });
  }
  const app = await getDoc(doc(db, "apps", appId));
  if (!app.exists()) throw fail("app-gone");
  if (app.data().ownerUid !== user.uid) {
    await setDoc(doc(db, "users", user.uid, "joined", appId), {
      name: app.data().name || "", ownerEmail: app.data().ownerEmail || "", joinedAt: Date.now(),
    });
  }
  return appId;
}

// ---- Views ----
function header(user) {
  return el("header", {},
    el("div", { class: "brand" }, el("img", { class: "logo", src: "icon.svg", alt: "" }), el("b", {}, t("ورقة", "Waraqa"))),
    el("div", { class: "spacer" }),
    el("button", { class: "link", onclick: () => { lang = lang === "en" ? "ar" : "en"; localStorage.setItem("lang", lang); applyLang(); route(); } }, lang === "en" ? "العربية" : "English"),
    user ? el("button", { class: "link", onclick: () => signOut(auth) }, t("خروج", "Sign out")) : null,
  );
}

function loginView() {
  let signUp = false;
  const email = el("input", { type: "email", placeholder: t("البريد الإلكتروني", "Email"), autocomplete: "email", dir: "ltr" });
  const pass = el("input", { type: "password", placeholder: t("كلمة المرور", "Password"), autocomplete: "current-password", dir: "ltr" });
  const confirm = el("input", { type: "password", placeholder: t("تأكيد كلمة المرور", "Confirm password"), dir: "ltr", hidden: true });
  const title = el("h2", {}, t("تسجيل الدخول", "Sign in"));
  const submit = el("button", { class: "primary" }, t("دخول", "Sign in"));
  const swap = el("button", { class: "link" }, t("ليس لديك حساب؟ أنشئ حسابًا", "No account? Create one"));
  const forgot = el("button", { class: "link" }, t("نسيت كلمة المرور؟", "Forgot password?"));
  const note = pendingCode ? el("p", { class: "note" }, t(`سجّل الدخول لفتح التطبيق (${pendingCode}).`, `Sign in to open the app (${pendingCode}).`)) : null;
  swap.onclick = () => {
    signUp = !signUp;
    confirm.hidden = !signUp;
    forgot.hidden = signUp;
    title.textContent = signUp ? t("إنشاء حساب", "Create account") : t("تسجيل الدخول", "Sign in");
    submit.textContent = signUp ? t("إنشاء الحساب", "Create account") : t("دخول", "Sign in");
    swap.textContent = signUp ? t("لديك حساب؟ سجّل الدخول", "Have an account? Sign in") : t("ليس لديك حساب؟ أنشئ حسابًا", "No account? Create one");
  };
  submit.onclick = async () => {
    submit.disabled = true;
    try {
      if (signUp) {
        if (pass.value !== confirm.value) return toast(t("كلمتا المرور غير متطابقتين.", "Passwords do not match."));
        await createUserWithEmailAndPassword(auth, email.value.trim(), pass.value);
      } else {
        await signInWithEmailAndPassword(auth, email.value.trim(), pass.value);
      }
    } catch (e) { toast(errorText(e)); } finally { submit.disabled = false; }
  };
  forgot.onclick = async () => {
    try { await sendPasswordResetEmail(auth, email.value.trim()); toast(t("أرسلنا رابط إعادة التعيين إلى بريدك.", "We sent a reset link to your email.")); }
    catch (e) { toast(errorText(e)); }
  };
  return el("main", { class: "narrow" }, el("div", { class: "card" }, title, note, email, pass, confirm, submit, swap, forgot));
}

async function homeView(user) {
  const codeInput = el("input", { placeholder: "ABCD-EF23", dir: "ltr", maxlength: "12" });
  const joinBtn = el("button", { class: "primary" }, t("انضمام", "Join"));
  joinBtn.onclick = async () => {
    const code = normalizeCode(codeInput.value);
    if (!code) return toast(t("الرمز غير صحيح.", "That code doesn't exist."));
    try { openApp(await join(user, code)); } catch (e) { toast(errorText(e)); }
  };
  const list = el("div", { class: "list" }, el("p", { class: "muted" }, t("جارٍ التحميل…", "Loading…")));
  const main = el("main", { class: "narrow" },
    el("div", { class: "card" }, el("h3", {}, t("الانضمام برمز", "Join with a code")), el("div", { class: "row" }, codeInput, joinBtn)),
    el("h3", {}, t("تطبيقاتي", "My apps")), list);
  (async () => {
    try {
      const mine = (await getDocs(query(collection(db, "apps"), where("ownerUid", "==", user.uid)))).docs
        .map(d => ({ id: d.id, name: d.data().name, sub: t("الرمز: ", "Code: ") + d.data().shareCode }));
      const joined = (await getDocs(collection(db, "users", user.uid, "joined"))).docs
        .map(d => ({ id: d.id, name: d.data().name, sub: t("من: ", "From: ") + d.data().ownerEmail }));
      const all = [...mine, ...joined];
      list.replaceChildren(...(all.length ? all.map(a => el("button", { class: "app", onclick: () => openApp(a.id) },
        el("b", {}, a.name || "—"), el("small", {}, a.sub))) : [el("p", { class: "muted" }, t("لا توجد تطبيقات بعد. اكتب رمزًا أرسله لك صاحب التطبيق.", "No apps yet. Type a code someone sent you."))]));
    } catch (e) { list.replaceChildren(el("p", { class: "muted" }, errorText(e))); }
  })();
  return main;
}

let cleanup = null;
async function openApp(appId) {
  history.replaceState(null, "", location.pathname + "?app=" + encodeURIComponent(appId));
  route();
}

async function appView(user, appId) {
  const stage = el("div", { class: "stage" });
  const close = el("button", { class: "close", onclick: () => { history.replaceState(null, "", location.pathname); route(); } }, "✕ " + t("إغلاق", "Close"));
  const wrap = el("div", { class: "runner" }, close, stage);
  stage.append(el("p", { class: "muted" }, t("جارٍ فتح التطبيق…", "Opening the app…")));
  (async () => {
    try {
      const snap = await getDoc(doc(db, "apps", appId));
      if (!snap.exists()) throw fail("app-gone");
      const data = snap.data();
      const project = JSON.parse(data.json);
      document.title = project.name;
      // The owner and members the owner made editors may change records; other members only look.
      const canEdit = data.ownerUid === user.uid || (await getDoc(doc(db, "apps", appId, "members", user.uid))).data()?.role === "editor";
      const requestAccess = () => setDoc(doc(db, "apps", appId, "requests", user.uid), { email: user.email || "", at: Date.now() });
      const app = runApp(stage, project, cloudStore(appId, data.headers || []), {
        lang, t, toast, confirm: confirmBox, errorText, canEdit, requestAccess,
        onScreen: screen => { wrap.style.background = cssBackground(screen); },
      });
      cleanup = app.cleanup;
    } catch (e) {
      stage.replaceChildren(el("p", { class: "muted" }, errorText(e)));
    }
  })();
  return wrap;
}

function cssBackground(screen) {
  const hex = ((screen.properties || {}).backgroundColor || "#FFF7FAF8").replace("#", "");
  if (hex.length !== 8) return "#" + hex;
  const a = parseInt(hex.slice(0, 2), 16) / 255;
  return `rgba(${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${parseInt(hex.slice(6, 8), 16)},${a})`;
}

let currentUser = null;
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const user = currentUser;
  if (!user) {
    $app.replaceChildren(header(null), loginView());
    return;
  }
  if (pendingCode) {
    const code = pendingCode;
    pendingCode = null;
    try { return openApp(await join(user, code)); } catch (e) { toast(errorText(e)); }
  }
  const appId = new URLSearchParams(location.search).get("app");
  if (appId) $app.replaceChildren(await appView(user, appId));
  else $app.replaceChildren(header(user), await homeView(user));
}

onAuthStateChanged(auth, user => { currentUser = user; route(); });
