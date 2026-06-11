// shared/storage.js
// chrome.storage.local 的封裝：單字資料與設定的存取。
// 以 ES module 提供，供 background.js 與各頁面（type="module"）匯入使用。

const WORDS_KEY = "words";
const SENTENCES_KEY = "sentences";
const SETTINGS_KEY = "settings";

export const DEFAULT_SETTINGS = {
  geminiApiKey: "",
  // 預設使用 flash 等級模型；使用者可於設定頁自行更換為其他可用模型字串。
  model: "gemini-2.0-flash",
  targetLang: "繁體中文",
  // 學習迴圈相關：朗讀語速、英文語音名稱、練習來源。
  ttsRate: 1,
  ttsVoice: "",
  practiceSource: "all", // "sentence" | "word" | "all"
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

// ---- 複習狀態（單字與句子共用） ----

// 統一的 srs 子物件預設。MVP 只用到 wrong / lastResult / lastReviewed；
// box / dueAt 預留給第二階段的間隔複習排程。
function defaultSrs() {
  return { box: 0, wrong: 0, lastResult: "", lastReviewed: 0, dueAt: 0 };
}

// 既有資料可能沒有 srs，讀取時惰性補上預設（不寫回 storage）。
function withSrs(item) {
  return { ...defaultSrs(), ...(item.srs || {}) };
}

// ---- 句子（句子島） ----

// 取得所有句子，排序規則比照單字：置頂優先、其餘 createdAt 由新到舊。
export async function getSentences() {
  const list = (await storageGet(SENTENCES_KEY)) || [];
  return [...list].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

// 新增一句；以英文（不分大小寫）去重，已存在則直接回傳既有資料。
// entry: { zh, en, source?, note? }
export async function addSentence(entry) {
  const list = (await storageGet(SENTENCES_KEY)) || [];
  const key = normalize(entry.en);
  const existing = key ? list.find((s) => normalize(s.en) === key) : null;
  if (existing) {
    return { sentence: existing, isNew: false };
  }
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    zh: String(entry.zh || "").trim(),
    en: String(entry.en || "").trim(),
    source: entry.source || "manual",
    note: entry.note || "",
    srs: defaultSrs(),
    pinned: false,
    pinnedAt: 0,
    createdAt: Date.now(),
  };
  list.push(record);
  await storageSet({ [SENTENCES_KEY]: list });
  return { sentence: record, isNew: true };
}

// 局部更新一句（zh / en / note 等）。
export async function updateSentence(id, patch) {
  const list = (await storageGet(SENTENCES_KEY)) || [];
  const next = list.map((s) => (s.id === id ? { ...s, ...patch } : s));
  await storageSet({ [SENTENCES_KEY]: next });
}

export async function deleteSentence(id) {
  const list = (await storageGet(SENTENCES_KEY)) || [];
  const next = list.filter((s) => s.id !== id);
  await storageSet({ [SENTENCES_KEY]: next });
}

export async function toggleSentencePin(id) {
  const list = (await storageGet(SENTENCES_KEY)) || [];
  const next = list.map((s) =>
    s.id === id ? { ...s, pinned: !s.pinned, pinnedAt: !s.pinned ? Date.now() : 0 } : s
  );
  await storageSet({ [SENTENCES_KEY]: next });
}

// ---- 主動回想（練習） ----

// 記錄一次自評結果，更新對應集合該筆的 srs。
// kind: "word" | "sentence"；result: "right" | "wrong"
export async function recordReview(kind, id, result) {
  const key = kind === "sentence" ? SENTENCES_KEY : WORDS_KEY;
  const list = (await storageGet(key)) || [];
  const next = list.map((it) => {
    if (it.id !== id) return it;
    const srs = withSrs(it);
    srs.lastResult = result === "right" ? "right" : "wrong";
    srs.lastReviewed = Date.now();
    if (result !== "right") srs.wrong = (srs.wrong || 0) + 1;
    return { ...it, srs };
  });
  await storageSet({ [key]: next });
}

// 排序：上次答錯者優先 → 累積錯越多越優先 → 最久沒複習（含從未練過）優先。
function reviewCompare(a, b) {
  const aWrong = a.srs.lastResult === "wrong" ? 1 : 0;
  const bWrong = b.srs.lastResult === "wrong" ? 1 : 0;
  if (aWrong !== bWrong) return bWrong - aWrong;
  if ((b.srs.wrong || 0) !== (a.srs.wrong || 0)) return (b.srs.wrong || 0) - (a.srs.wrong || 0);
  return (a.srs.lastReviewed || 0) - (b.srs.lastReviewed || 0);
}

// 合併句子與單字成統一的複習佇列。
// source: "sentence" | "word" | "all"
// 回傳項目：{ kind, id, front(中), back(英), playText(英), srs, extra }
export async function getReviewQueue({ source = "all" } = {}) {
  const items = [];

  if (source === "sentence" || source === "all") {
    const sentences = (await storageGet(SENTENCES_KEY)) || [];
    for (const s of sentences) {
      if (!s.zh || !s.en) continue;
      items.push({
        kind: "sentence",
        id: s.id,
        front: s.zh,
        back: s.en,
        playText: s.en,
        srs: withSrs(s),
        extra: { note: s.note || "", source: s.source || "" },
      });
    }
  }

  if (source === "word" || source === "all") {
    const words = (await storageGet(WORDS_KEY)) || [];
    for (const w of words) {
      if (!w.word) continue;
      items.push({
        kind: "word",
        id: w.id,
        front: w.translation || w.word,
        back: w.word,
        playText: w.word,
        srs: withSrs(w),
        extra: {
          partOfSpeech: w.partOfSpeech || "",
          exampleEN: w.exampleEN || "",
          exampleZH: w.exampleZH || "",
        },
      });
    }
  }

  items.sort(reviewCompare);
  return items;
}
