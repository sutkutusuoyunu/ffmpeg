/**
 * account.js — reuses the same Firebase project as the main site/forum
 * to add login + a "My Files" panel that survives page refreshes and
 * lets signed-in users get back to a conversion before the 30-min
 * Cloudinary expiry.
 *
 * Data model: users/{uid}/files/{autoId}
 *   { url, filename, format, sizeBytes, createdAt, expiresAt }
 *
 * expiresAt is a client-computed timestamp (createdAt + 30 min) used
 * only to know when to stop showing/using the link and to prune the
 * Firestore record — it does NOT extend or control the actual
 * Cloudinary deletion, which is still enforced server-side by your
 * Worker's cron exactly as before.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc, getDoc,
  query, orderBy, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBafL4x-ANrbA8x9iPjIXvT57d6H0oJnuo",
  authDomain: "sutkutusuoyunu.firebaseapp.com",
  projectId: "sutkutusuoyunu",
  storageBucket: "sutkutusuoyunu.firebasestorage.app",
  messagingSenderId: "432642434528",
  appId: "1:432642434528:web:01701181fb552769cef785"
};

const LOGIN_URL = "https://sutkutusuoyunu.github.io/login/";
const THIRTY_MIN_MS = 30 * 60 * 1000;

const DEFAULT_AVATAR =
  'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
      <rect width="40" height="40" rx="20" fill="#16161e"/>
      <circle cx="20" cy="15.5" r="6.5" fill="#5c5c68"/>
      <path d="M8 34c1.5-8 8-11.5 12-11.5S30.5 26 32 34" fill="#5c5c68"/>
    </svg>`);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch((e) => console.warn("Persistence setup failed:", e));

let currentUser = null;
let unsubscribeFiles = null;

/* ---------------------------------------------------------
   LOGIN BUTTON / USER PILL (top-right, same pattern as main site)
--------------------------------------------------------- */
const loginBtn = document.getElementById("account-login-btn");
const userPill = document.getElementById("account-user-pill");
const userPillAvatar = document.getElementById("account-user-avatar");
const userPillNick = document.getElementById("account-user-nick");
const userPillLogout = document.getElementById("account-logout-btn");

userPillLogout.addEventListener("click", () => {
  if (confirm("Çıkış yapmak istediğine emin misin?")) signOut(auth);
});

/* ---------------------------------------------------------
   MY FILES PANEL
--------------------------------------------------------- */
const filesPanel = document.getElementById("my-files-panel");
const filesList = document.getElementById("my-files-list");
const filesEmpty = document.getElementById("my-files-empty");
const filesLocked = document.getElementById("my-files-locked");

function formatRemaining(ms) {
  if (ms <= 0) return "Süresi doldu";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")} kaldı`;
}

function renderFileRow(id, data) {
  const createdMs = data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now();
  const expiresMs = createdMs + THIRTY_MIN_MS;

  const li = document.createElement("li");
  li.className = "my-file-row";
  li.dataset.expires = String(expiresMs);

  li.innerHTML = `
    <div class="my-file-main">
      <div class="my-file-name">${escapeHtml(data.filename || "dosya")}</div>
      <div class="my-file-meta">${escapeHtml((data.format || "").toUpperCase())} · <span class="my-file-countdown"></span></div>
    </div>
    <div class="my-file-actions">
      <a class="primary-btn my-file-dl" href="${escapeHtml(data.url)}" target="_blank" rel="noopener">İNDİR</a>
      <button class="ghost my-file-remove" title="Listeden kaldır">✕</button>
    </div>
  `;

  li.querySelector(".my-file-remove").addEventListener("click", async () => {
    try {
      await deleteDoc(doc(db, "users", currentUser.uid, "files", id));
    } catch (e) {
      console.warn("Could not remove file record:", e);
    }
  });

  return li;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let tickInterval = null;
function startTicking() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    document.querySelectorAll(".my-file-row").forEach((li) => {
      const expiresMs = Number(li.dataset.expires);
      const remaining = expiresMs - Date.now();
      const countdownEl = li.querySelector(".my-file-countdown");
      if (countdownEl) countdownEl.textContent = formatRemaining(remaining);
      if (remaining <= 0) {
        li.classList.add("expired");
        li.querySelector(".my-file-dl").style.pointerEvents = "none";
      }
    });
  }, 1000);
}

function subscribeToFiles(uid) {
  if (unsubscribeFiles) unsubscribeFiles();
  const q = query(collection(db, "users", uid, "files"), orderBy("createdAt", "desc"));
  unsubscribeFiles = onSnapshot(q, (snap) => {
    filesList.innerHTML = "";
    if (snap.empty) {
      filesEmpty.hidden = false;
    } else {
      filesEmpty.hidden = true;
      snap.forEach((d) => {
        // Prune anything already past 30 minutes instead of showing a
        // dead link — the Cloudinary asset is gone by now anyway.
        const createdMs = d.data().createdAt && d.data().createdAt.toMillis ? d.data().createdAt.toMillis() : 0;
        if (Date.now() - createdMs >= THIRTY_MIN_MS) {
          deleteDoc(doc(db, "users", uid, "files", d.id)).catch(() => {});
          return;
        }
        filesList.appendChild(renderFileRow(d.id, d.data()));
      });
    }
    startTicking();
  }, (err) => {
    console.warn("My files listener error:", err);
  });
}

/* ---------------------------------------------------------
   PUBLIC API — called from app.js after a successful conversion
--------------------------------------------------------- */
window.FFAccount = {
  isSignedIn: () => !!currentUser,
  saveFileRecord: async ({ url, filename, format, sizeBytes }) => {
    if (!currentUser) return; // anonymous users just get the normal one-time link
    try {
      await addDoc(collection(db, "users", currentUser.uid, "files"), {
        url, filename: filename || "dosya", format: format || "", sizeBytes: sizeBytes || null,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Could not save file record:", e);
    }
  },
};

/* ---------------------------------------------------------
   AUTH STATE
--------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    loginBtn.hidden = false;
    userPill.classList.remove("show");
    filesPanel.hidden = false;
    filesList.innerHTML = "";
    filesEmpty.hidden = true;
    filesLocked.hidden = false;
    if (unsubscribeFiles) { unsubscribeFiles(); unsubscribeFiles = null; }
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    return;
  }

  let nickname = user.email || "Oyuncu";
  let photoURL = null;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const d = snap.data();
      nickname = d.nickname || nickname;
      photoURL = d.photoURL || null;
    }
  } catch (e) {
    console.warn("Profile load error:", e);
  }

  userPillAvatar.onerror = () => { userPillAvatar.onerror = null; userPillAvatar.src = DEFAULT_AVATAR; };
  userPillAvatar.src = photoURL || DEFAULT_AVATAR;
  userPillNick.textContent = nickname;
  loginBtn.hidden = true;
  userPill.classList.add("show");

  filesLocked.hidden = true;
  filesPanel.hidden = false;
  subscribeToFiles(user.uid);
});