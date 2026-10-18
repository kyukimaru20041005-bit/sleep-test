// IndexedDB の読み書き。すべてのデータは端末内に閉じる(外部送信なし)。
// Phase 1 時点では「1晩分の記録」の開始・終了だけを扱う最小限の実装。
// カレンダー表示や夜間ログ、JSON書き出し/読み込みは Phase 2 で拡張する。

const DB_NAME = 'renight';
const DB_VERSION = 1;
const STORE_NIGHTS = 'nights';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NIGHTS)) {
        db.createObjectStore(STORE_NIGHTS, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function getDB() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

/**
 * night = { startTime, input, settings, isNoBeatNight }
 * 戻り値: 作成されたレコードの id
 */
async function saveNightStart(night) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NIGHTS, 'readwrite');
    const req = tx.objectStore(STORE_NIGHTS).add(Object.assign({ wakeTime: null }, night));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * wakeTime がまだ記録されていない、最新の夜レコードを1件返す(なければ null)。
 * ?wake=1 でページが再読み込みされたときに使う。
 */
async function getActiveNight() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NIGHTS, 'readonly');
    const req = tx.objectStore(STORE_NIGHTS).openCursor(null, 'prev');
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return resolve(null);
      if (cursor.value.wakeTime == null) return resolve(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

async function completeNight(id, wakeData) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NIGHTS, 'readwrite');
    const store = tx.objectStore(STORE_NIGHTS);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) return resolve(null);
      Object.assign(record, wakeData);
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

const Storage = { saveNightStart, getActiveNight, completeNight };
