/*
 * Google-Anmeldung + Synchronisierung über Firebase/Firestore.
 *
 * Firestore-Struktur (pro Google-Konto):
 *   tipTracker/{uid}                  { settings, updatedAt }
 *   tipTracker/{uid}/months/{YYYY-MM} { entries: [...], updatedAt }
 *
 * Neue Einträge werden per arrayUnion angehängt, Löschungen per arrayRemove –
 * dadurch überschreiben sich Handy und PC nicht gegenseitig. Offline-Änderungen
 * werden von Firestore zwischengespeichert und später hochgeladen.
 */
import { firebaseConfig, firestoreDatabaseId } from './firebase-config.js';

const V = '12.6.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;
const T = window.TGTracker;

function friendly(e) {
  const code = (e && e.code) || '';
  if (code === 'permission-denied' || code === 'firestore/permission-denied')
    return 'Keine Berechtigung – die Firestore-Regel für „tipTracker“ ist noch nicht veröffentlicht.';
  if (code === 'auth/unauthorized-domain')
    return `Domain ${location.hostname} ist in Firebase nicht freigegeben.`;
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request')
    return 'Anmeldung abgebrochen';
  if (code === 'auth/network-request-failed' || code === 'unavailable')
    return 'Keine Verbindung – bitte später erneut versuchen.';
  return 'Fehler: ' + ((e && e.message) || code || 'unbekannt');
}

async function main() {
  let appM, authM, fsM;
  try {
    [appM, authM, fsM] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`)
    ]);
  } catch (e) {
    T.setAccount({ state: 'unavailable', message: 'Firebase konnte nicht geladen werden (offline?)' });
    return;
  }

  const { initializeApp } = appM;
  const {
    getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
    getRedirectResult, onAuthStateChanged, signOut
  } = authM;
  const {
    initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
    doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
    onSnapshot, arrayUnion, arrayRemove, serverTimestamp
  } = fsM;

  const app = initializeApp(firebaseConfig);
  let db;
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true
    }, firestoreDatabaseId);
  } catch (e) {
    db = getFirestore(app, firestoreDatabaseId);
  }
  const auth = getAuth(app);

  // Nur für lokale Tests: http://localhost:…/?emulator verbindet mit dem Firebase-Emulator.
  if (location.hostname === 'localhost' && new URLSearchParams(location.search).has('emulator')) {
    authM.connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    fsM.connectFirestoreEmulator(db, 'localhost', 8080);
    window.__tgEmu = { auth, authM };
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  let session = null; // { user, unsubs[] }

  function accountBase(user) {
    return { email: user.email, name: user.displayName, signedIn: true };
  }

  function fail(e) {
    console.error('[sync]', e);
    if (!session) return;
    T.setAccount({ ...accountBase(session.user), state: 'error', message: friendly(e) });
  }

  function stopSync() {
    if (session) session.unsubs.forEach((u) => u());
    session = null;
    T.setRemote(null);
  }

  async function startSync(user) {
    stopSync();
    const me = (session = { user, unsubs: [] });
    T.setAccount({ ...accountBase(user), state: 'in', pending: true });

    const userRef = doc(db, 'tipTracker', user.uid);
    const monthsCol = collection(userRef, 'months');
    const monthRef = (key) => doc(monthsCol, key);

    // 1) Daten, die vorher nur auf diesem Gerät lagen, ins Konto übernehmen.
    const local = T.getLocal();
    const hasLocal = Object.values(local.months || {}).some((m) => m.entries && m.entries.length);
    if (local.owner == null && hasLocal) {
      try {
        const [uSnap, mSnap] = await Promise.all([getDoc(userRef), getDocs(monthsCol)]);
        if (session !== me) return;
        const cloudIds = {};
        mSnap.forEach((d) => { cloudIds[d.id] = new Set((d.data().entries || []).map((e) => e.id)); });
        const batch = writeBatch(db);
        let n = 0;
        for (const [key, m] of Object.entries(local.months)) {
          const known = cloudIds[key] || new Set();
          const add = (m.entries || []).filter((e) => !known.has(e.id));
          if (add.length) {
            batch.set(monthRef(key), { entries: arrayUnion(...add), updatedAt: serverTimestamp() }, { merge: true });
            n += add.length;
          }
        }
        if (!uSnap.exists() || !uSnap.data().settings) {
          batch.set(userRef, { settings: local.settings, updatedAt: serverTimestamp() }, { merge: true });
        }
        batch.commit().catch(fail); // nicht warten: offline wird später hochgeladen
        if (n) T.toast(n + ' Einträge von diesem Gerät ins Konto übernommen');
      } catch (e) {
        fail(e);
        return; // lokale Daten bleiben unverändert erhalten
      }
    }

    // 2) Live-Abgleich
    let settings = null, months = null;
    let pendU = false, pendM = false, cacheU = true, cacheM = true;
    const push = () => {
      if (session !== me || months === null || settings === undefined) return;
      T.setFromCloud({ settings: settings || T.getLocal().settings, months }, user.uid);
      T.setAccount({ ...accountBase(user), state: 'in', pending: pendU || pendM, offline: cacheU && cacheM });
    };
    settings = undefined;
    me.unsubs.push(onSnapshot(userRef, { includeMetadataChanges: true }, (snap) => {
      settings = snap.exists() ? snap.data().settings || null : null;
      pendU = snap.metadata.hasPendingWrites;
      cacheU = snap.metadata.fromCache;
      push();
    }, fail));
    me.unsubs.push(onSnapshot(monthsCol, { includeMetadataChanges: true }, (snap) => {
      const m = {};
      snap.forEach((d) => { m[d.id] = { entries: d.data().entries || [] }; });
      months = m;
      pendM = snap.metadata.hasPendingWrites;
      cacheM = snap.metadata.fromCache;
      push();
    }, fail));

    // 3) Änderungen aus der App ins Konto schreiben
    T.setRemote({
      add: (key, e) =>
        setDoc(monthRef(key), { entries: arrayUnion(e), updatedAt: serverTimestamp() }, { merge: true }).catch(fail),
      remove: (key, e) =>
        updateDoc(monthRef(key), { entries: arrayRemove(e), updatedAt: serverTimestamp() }).catch(fail),
      saveSettings: (s) =>
        setDoc(userRef, { settings: s, updatedAt: serverTimestamp() }, { merge: true }).catch(fail),
      resetMonth: (key) => deleteDoc(monthRef(key)).catch(fail),
      replaceAll: (store) => {
        const b = writeBatch(db);
        Object.keys(months || {}).forEach((k) => { if (!store.months[k]) b.delete(monthRef(k)); });
        Object.entries(store.months).forEach(([k, m]) =>
          b.set(monthRef(k), { entries: m.entries || [], updatedAt: serverTimestamp() }));
        b.set(userRef, { settings: store.settings, updatedAt: serverTimestamp() }, { merge: true });
        b.commit().catch(fail);
      }
    });
  }

  T.setAuthApi({
    login: async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await signInWithRedirect(auth, provider);
          return;
        }
        e.userMessage = friendly(e);
        throw e;
      }
    },
    logout: async () => {
      stopSync();
      await signOut(auth);
      T.clearLocal();
    }
  });

  getRedirectResult(auth).catch((e) => T.toast(friendly(e)));

  onAuthStateChanged(auth, (user) => {
    if (user) {
      startSync(user);
    } else {
      stopSync();
      // Lokale Kopie gehörte zu einem Konto, das nicht mehr angemeldet ist -> entfernen
      if (T.getLocal().owner) T.clearLocal();
      T.setAccount({ state: 'out' });
    }
  });
}

main();
