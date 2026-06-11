// shared/storage.js
// chrome.storage.local 的封裝：單字資料與設定的存取。
// 以 ES module 提供，供 background.js 與各頁面（type="module"）匯入使用。

const WORDS_KEY = "words";
const SENTENCES_KEY = "sentences";
const SETTINGS_KEY = "settings";
const ACTIVITY_KEY = "activity";

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

// ---- 間隔複習（Leitner）工具 ----

// box 索引 → 答對後隔幾天再到期。答錯一律回 box 0（當天再練）。
const SRS_INTERVALS = [0, 1, 3, 7, 14, 30, 60];
const MAX_BOX = SRS_INTERVALS.length - 1;
const DAY_MS = 86400000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfTomorrow() {
  return startOfToday() + DAY_MS;
}
// dueAt=0（從未練過）或 dueAt 在明天 00:00 之前 → 今天該複習。
function isDue(srs) {
  return ((srs && srs.dueAt) || 0) < startOfTomorrow();
}
// 本機日期鍵 YYYY-MM-DD（不用 locale 字串，避免格式飄移）。
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

// 記錄一次自評結果：升降 Leitner 箱、算下次到期日、並記錄當日學習活動。
// kind: "word" | "sentence"；result: "right" | "wrong"
export async function recordReview(kind, id, result) {
  const key = kind === "sentence" ? SENTENCES_KEY : WORDS_KEY;
  const list = (await storageGet(key)) || [];
  const right = result === "right";
  const next = list.map((it) => {
    if (it.id !== id) return it;
    const srs = withSrs(it);
    srs.box = right ? Math.min((srs.box || 0) + 1, MAX_BOX) : 0;
    if (!right) srs.wrong = (srs.wrong || 0) + 1;
    srs.lastResult = right ? "right" : "wrong";
    srs.lastReviewed = Date.now();
    srs.dueAt = startOfToday() + SRS_INTERVALS[srs.box] * DAY_MS;
    return { ...it, srs };
  });
  await storageSet({ [key]: next });
  await bumpActivity(right);
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
// dueOnly: 預設 true，只回傳今天該複習（到期或從未練過）的項目。
// 回傳項目：{ kind, id, front(中), back(英), playText(英), srs, extra }
export async function getReviewQueue({ source = "all", dueOnly = true } = {}) {
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

  const filtered = dueOnly ? items.filter((it) => isDue(it.srs)) : items;
  filtered.sort(reviewCompare);
  return filtered;
}

// ---- 學習活動與儀表板 ----

const MILESTONES = [
  "第 1 週：撐過摩擦期，Excel 滿江紅是正常的，學習正在發生。",
  "第 2 週：開始記得 20–30%，出現愈來愈多打勾的句子。",
  "第 3 週：鏈接時刻，突然有句子能脫口而出，信心大增。",
  "第 4 週：能用庫存句子做簡單的一問一答。",
  "第 5 週：句子變靈活，開始能自由組合、替換。",
  "第 6 週：能真正用這語言思考與溝通。",
];

export async function getActivity() {
  return (await storageGet(ACTIVITY_KEY)) || { startDate: "", days: {} };
}

// 記錄今天的一次複習（reviews +1、答對則 right +1），並在首次練習時設起始日。
async function bumpActivity(right) {
  const act = await getActivity();
  if (!act.days) act.days = {};
  const today = ymd(new Date());
  if (!act.startDate) act.startDate = today;
  const rec = act.days[today] || { reviews: 0, right: 0 };
  rec.reviews += 1;
  if (right) rec.right += 1;
  act.days[today] = rec;
  await storageSet({ [ACTIVITY_KEY]: act });
}

// 一次算好儀表板要的所有數據，讓 dashboard.js 只負責填畫面。
export async function getDashboardData() {
  const sentences = (await storageGet(SENTENCES_KEY)) || [];
  const words = (await storageGet(WORDS_KEY)) || [];
  const act = await getActivity();
  const days = act.days || {};

  // 句子 + 單字的彙總：已掌握數、今日到期數、下一個到期時間。
  let masteredCount = 0;
  let dueToday = 0;
  let nextDueAt = null;
  for (const it of [...sentences, ...words]) {
    const srs = withSrs(it);
    if ((srs.box || 0) >= 5) masteredCount++;
    if (isDue(srs)) {
      dueToday++;
    } else if (srs.dueAt && (nextDueAt === null || srs.dueAt < nextDueAt)) {
      nextDueAt = srs.dueAt;
    }
  }

  // 今日活動與連續天數（streak）。
  const todayRec = days[ymd(new Date())] || { reviews: 0, right: 0 };
  const studiedToday = todayRec.reviews > 0;
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!studiedToday) cursor.setDate(cursor.getDate() - 1); // 今天還沒練，從昨天起算既有連續
  while (true) {
    const k = ymd(cursor);
    if (days[k] && days[k].reviews > 0) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  // 最近 7 天（舊→新）。
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const dd = new Date();
    dd.setHours(0, 0, 0, 0);
    dd.setDate(dd.getDate() - i);
    const k = ymd(dd);
    last7.push({ date: k, reviews: (days[k] && days[k].reviews) || 0 });
  }

  // 6 週進度。
  let daysSinceStart = 0;
  let week = 0;
  let progressPct = 0;
  let milestone = "";
  if (act.startDate) {
    const [y, m, dnum] = act.startDate.split("-").map(Number);
    const startMs = new Date(y, m - 1, dnum).setHours(0, 0, 0, 0);
    daysSinceStart = Math.floor((startOfToday() - startMs) / DAY_MS) + 1;
    week = Math.max(1, Math.ceil(daysSinceStart / 7));
    progressPct = Math.min((daysSinceStart / 42) * 100, 100);
    milestone = MILESTONES[Math.min(week, MILESTONES.length) - 1];
  }

  return {
    totalSentences: sentences.length,
    totalWords: words.length,
    masteredCount,
    dueToday,
    nextDueAt,
    streak,
    studiedToday,
    todayReviews: todayRec.reviews,
    todayRight: todayRec.right,
    last7,
    startDate: act.startDate || "",
    daysSinceStart,
    week,
    milestone,
    progressPct,
  };
}
