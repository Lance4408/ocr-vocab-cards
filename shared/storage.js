// shared/storage.js
// chrome.storage.local 的封裝：單字資料與設定的存取。
// 以 ES module 提供，供 background.js 與各頁面（type="module"）匯入使用。

const WORDS_KEY = "words";
const SETTINGS_KEY = "settings";

export const DEFAULT_SETTINGS = {
  geminiApiKey: "",
  // 預設使用 flash 等級模型；使用者可於設定頁自行更換為其他可用模型字串。
  model: "gemini-2.0-flash",
  targetLang: "繁體中文",
};

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result[key]));
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

// ---- 設定 ----

export async function getSettings() {
  const stored = await storageGet(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await storageSet({ [SETTINGS_KEY]: next });
  return next;
}

// ---- 單字 ----

function normalize(word) {
  return String(word || "").trim().toLowerCase();
}

// 取得所有單字，依「置頂優先、其餘 createdAt 由新到舊」排序後回傳。
export async function getWords() {
  const list = (await storageGet(WORDS_KEY)) || [];
  return [...list].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

// 找出與指定字（不分大小寫）相同的既有單字，沒有則回傳 null。
export async function findWord(word) {
  const list = (await storageGet(WORDS_KEY)) || [];
  const key = normalize(word);
  return list.find((w) => normalize(w.word) === key) || null;
}

// 新增一張單字卡；若同字已存在則不重複新增，直接回傳既有資料。
// entry: { word, translation, partOfSpeech, exampleEN, exampleZH }
export async function addWord(entry) {
  const list = (await storageGet(WORDS_KEY)) || [];
  const key = normalize(entry.word);
  const existing = list.find((w) => normalize(w.word) === key);
  if (existing) {
    return { word: existing, isNew: false };
  }
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    word: String(entry.word || "").trim(),
    translation: entry.translation || "",
    partOfSpeech: entry.partOfSpeech || "",
    exampleEN: entry.exampleEN || "",
    exampleZH: entry.exampleZH || "",
    pinned: false,
    createdAt: Date.now(),
  };
  list.push(record);
  await storageSet({ [WORDS_KEY]: list });
  return { word: record, isNew: true };
}

export async function deleteWord(id) {
  const list = (await storageGet(WORDS_KEY)) || [];
  const next = list.filter((w) => w.id !== id);
  await storageSet({ [WORDS_KEY]: next });
}

// 切換置頂狀態；置頂時更新 pinnedAt 以維持置頂群組內的順序穩定。
export async function togglePin(id) {
  const list = (await storageGet(WORDS_KEY)) || [];
  const next = list.map((w) =>
    w.id === id ? { ...w, pinned: !w.pinned, pinnedAt: !w.pinned ? Date.now() : 0 } : w
  );
  await storageSet({ [WORDS_KEY]: next });
}
