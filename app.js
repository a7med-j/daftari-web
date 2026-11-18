// Waraqa (formerly Daftari) on the web: sign in, open apps you own or joined (or join with a code from a link),
// and run them on their shared table. Same Firebase project and data as the Android app.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile, reauthenticateWithCredential, EmailAuthProvider, updatePassword,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, deleteDoc, collection, getDocs, getDocsFromServer,
  query, where, runTransaction, serverTimestamp, Bytes,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";
import { runApp, useAppManifest, offlineTable, isStrongPassword, rememberPassword, securityGate, lockChoice, lockSettings } from "./render.js";

// Pages kept in this browser, so the site also opens without a connection.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
// Asks the browser to keep this site's data (sign-in, saved records) even when space runs low.
navigator.storage?.persist?.().catch(() => {});

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
// Data read once stays in this browser, so apps open and work without a connection.
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

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
const readRows = raw => (Array.isArray(raw) ? raw : []).map(m => ({ ...(m || {}), id: String(m?.id ?? ""), c: (m?.c || []).map(v => String(v ?? "")) }));
/** Who adds a record (kept with it, so the owner can count each member's records). */
const authorOf = user => ({ by: user?.uid || "", byName: (user?.displayName || "").trim() || user?.email || "", at: String(Date.now()) });

function cloudStore(appId, headers, fileId = "", offline = true) {
  // Extra files of the project keep their records under tables/{fileId}.
  const col = fileId ? collection(db, "apps", appId, "tables", fileId, "chunks") : collection(db, "apps", appId, "chunks");
  const photoCache = new Map();
  const table = offlineTable({ db, doc, getDocs, getDocsFromServer, runTransaction, serverTimestamp }, col, headers, () => authorOf(auth.currentUser), offline);
  return Object.assign(table, {
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
  });
}

// ---- Sharing ----
async function join(user, code) {
  const codeDoc = await getDoc(doc(db, "shareCodes", code));
  if (!codeDoc.exists()) throw fail("not-found-code");
  const { appId, ownerUid } = codeDoc.data();
  if (ownerUid !== user.uid) {
    // Already a member: joining again keeps the membership (and the access the owner gave).
    const member = await getDoc(doc(db, "apps", appId, "members", user.uid)).catch(() => null);
    if (!member?.exists()) {
      const fields = { code, email: user.email || "", name: (user.displayName || "").trim(), joinedAt: Date.now() };
      // Editors at once when the owner chose so (the rules refuse it otherwise, then as a viewer).
      await setDoc(doc(db, "apps", appId, "members", user.uid), { ...fields, role: "editor" })
        .catch(e => { if (!String(e.code).includes("permission-denied")) throw e; return setDoc(doc(db, "apps", appId, "members", user.uid), fields); });
    }
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
  const firstName = el("input", { placeholder: t("الاسم الأول", "First name"), autocomplete: "given-name", maxlength: "40", hidden: true });
  const title = el("h2", {}, t("تسجيل الدخول", "Sign in"));
  const submit = el("button", { class: "primary" }, t("دخول", "Sign in"));
  const swap = el("button", { class: "link" }, t("ليس لديك حساب؟ أنشئ حسابًا", "No account? Create one"));
  const forgot = el("button", { class: "link" }, t("نسيت كلمة المرور؟", "Forgot password?"));
  const note = pendingCode ? el("p", { class: "note" }, t(`سجّل الدخول لفتح التطبيق (${pendingCode}).`, `Sign in to open the app (${pendingCode}).`)) : null;
  swap.onclick = () => {
    signUp = !signUp;
    confirm.hidden = !signUp;
    firstName.hidden = !signUp;
    forgot.hidden = signUp;
    title.textContent = signUp ? t("إنشاء حساب", "Create account") : t("تسجيل الدخول", "Sign in");
    submit.textContent = signUp ? t("إنشاء الحساب", "Create account") : t("دخول", "Sign in");
    swap.textContent = signUp ? t("لديك حساب؟ سجّل الدخول", "Have an account? Sign in") : t("ليس لديك حساب؟ أنشئ حسابًا", "No account? Create one");
  };
  submit.onclick = async () => {
    submit.disabled = true;
    try {
      if (signUp) {
        if (!firstName.value.trim()) return toast(t("اكتب اسمك الأول.", "Enter your first name."));
        if (!isStrongPassword(pass.value)) return toast(t("كلمة المرور ضعيفة: 8 خانات على الأقل، فيها حروف وأرقام.", "Password too weak: at least 8 characters, with letters and digits."));
        if (pass.value !== confirm.value) return toast(t("كلمتا المرور غير متطابقتين.", "Passwords do not match."));
        signingIn = true;
        const made = await createUserWithEmailAndPassword(auth, email.value.trim(), pass.value).finally(() => { signingIn = false; });
        await updateProfile(made.user, { displayName: firstName.value.trim() });
        await rememberPassword(made.user.uid, pass.value);
        route();
      } else {
        signingIn = true; // the page opens once the password is remembered
        try {
          const signed = await signInWithEmailAndPassword(auth, email.value.trim(), pass.value);
          await rememberPassword(signed.user.uid, pass.value);
        } finally { signingIn = false; route(); }
      }
    } catch (e) { toast(errorText(e)); } finally { submit.disabled = false; }
  };
  forgot.onclick = async () => {
    try { await sendPasswordResetEmail(auth, email.value.trim()); toast(t("أرسلنا رابط إعادة التعيين إلى بريدك.", "We sent a reset link to your email.")); }
    catch (e) { toast(errorText(e)); }
  };
  return el("main", { class: "narrow" }, el("div", { class: "card" }, title, note, firstName, email, pass, confirm, submit, swap, forgot));
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
      // The owner's security settings (My apps → Security): lock and working offline.
      const security = { strongPasswords: true, lock: true, lockAfterMinutes: 2, offline: true, ...(data.security || {}) };
      const locks = lockChoice(appId, user.uid, security);
      if ((locks.device || locks.password) && lockedApps.get(appId) !== user.uid) {
        await securityGate({
          uid: user.uid, email: user.email, name: user.displayName, el: stage, t, lang, checkPassword: false,
          device: locks.device, password: locks.password, lockAfterMs: security.lockAfterMinutes * 60000,
          verify: pw => reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw)),
          change: pw => updatePassword(user, pw), signOut: () => signOut(auth),
        });
        lockedApps.set(appId, user.uid);
      }
      // Each member picks the locks they want for this app (the owner's required ones stay on).
      wrap.append(el("button", { class: "close", style: "inset-inline-start:auto;inset-inline-end:10px",
        onclick: () => lockSettings({ appId, uid: user.uid, security, t, lang, onSaved: () => toast(t("تم حفظ إعدادات القفل.", "Lock settings saved.")) }) }, "🔒 " + t("القفل", "Lock")));
      // "Add to home screen" now opens this app directly.
      useAppManifest(project.name, location.pathname + "?app=" + encodeURIComponent(appId), project.icon || "icon-512.png");
      // The owner and members the owner made editors may change records; other members only look.
      const owner = data.ownerUid === user.uid;
      const editor = owner || (await getDoc(doc(db, "apps", appId, "members", user.uid))).data()?.role === "editor";
      const canEdit = editor;
      const canDelete = owner || (editor && security.whoDeletes !== "owner");
      const who = security.whoExports || "everyone";
      const canExport = owner || who === "everyone" || (who === "editors" && editor);
      const requestAccess = security.allowRequests === false ? null : () => setDoc(doc(db, "apps", appId, "requests", user.uid), { email: user.email || "", name: (user.displayName || "").trim(), at: Date.now() });
      const storeFor = id => { const f = (project.files || []).find(x => x.id === id); return f ? cloudStore(appId, f.link.headers || [], id, security.offline) : null; };
      const app = runApp(stage, project, cloudStore(appId, data.headers || [], "", security.offline), {
        storeFor,
        user: { uid: user.uid, name: (user.displayName || "").trim(), email: user.email || "" },
        lang, t, toast, confirm: confirmBox, errorText, canEdit, canDelete, canExport, requestAccess,
        onScreen: screen => { wrap.style.background = cssBackground(screen); },
      });
      cleanup = app.cleanup;
    } catch (e) {
      // Paused by its owner: show the owner's message.
      const info = (await getDoc(doc(db, "publicApps", appId)).catch(() => null))?.data();
      stage.replaceChildren(el("p", { class: "muted" }, info?.paused ? (info.pausedMessage || t("التطبيق متوقف مؤقتًا من صاحبه.", "The app is paused by its owner.")) : errorText(e)));
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

function nameView(user) {
  const input = el("input", { placeholder: t("الاسم الأول", "First name"), autocomplete: "given-name", maxlength: "40" });
  const save = el("button", { class: "primary" }, t("حفظ", "Save"));
  save.onclick = async () => {
    const name = input.value.trim();
    if (!name) return toast(t("اكتب اسمك الأول.", "Enter your first name."));
    save.disabled = true;
    try {
      await updateProfile(user, { displayName: name });
      // The apps already joined show the owner this name too.
      const joined = (await getDocs(collection(db, "users", user.uid, "joined"))).docs;
      await Promise.all(joined.map(d => setDoc(doc(db, "apps", d.id, "members", user.uid), { name }, { merge: true }).catch(() => {})));
      route();
    } catch (e) { toast(errorText(e)); save.disabled = false; }
  };
  return el("main", { class: "narrow" }, el("div", { class: "card" },
    el("h2", {}, t("اكتب اسمك الأول", "Enter your first name")),
    el("p", { class: "note" }, t("حتى يعرفك صاحب التطبيق ويرى ما أضفته.", "So app owners know who you are and what you added.")),
    input, save));
}

let currentUser = null;
let unlockedUid = null;
const lockedApps = new Map(); // shared apps already unlocked in this page
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const user = currentUser;
  if (!user) {
    $app.replaceChildren(header(null), loginView());
    return;
  }
  // Accounts made before first names were asked for give one, so app owners know who they are.
  if (!(user.displayName || "").trim()) {
    $app.replaceChildren(header(user), nameView(user));
    return;
  }
  // A one-time password check (weak ones replaced), then the lock: fingerprint/face/PIN or the password.
  if (unlockedUid !== user.uid) {
    await securityGate({
      uid: user.uid, email: user.email, name: user.displayName, el: $app, t, lang,
      verify: pw => reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw)),
      change: pw => updatePassword(user, pw),
      signOut: () => signOut(auth),
      lock: false, // Waraqa's own pages don't lock; each shared app follows its owner's settings
    });
    if (currentUser !== user) return;
    unlockedUid = user.uid;
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

let signingIn = false;
onAuthStateChanged(auth, user => { currentUser = user; if (!signingIn) route(); });
