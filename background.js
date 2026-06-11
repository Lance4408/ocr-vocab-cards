// background.js (service worker, type: module)
// 流程編排核心：接收觸發 → 注入框選 UI → 截圖 → offscreen OCR → Gemini → 存檔 → 回傳結果。

import { getSettings, addWord, findWord, addSentence } from "./shared/storage.js";
import { fetchWordInfo, fetchSentenceZH } from "./shared/gemini.js";

const CONTEXT_MENU_ID = "ocr-select-word";
const SENTENCE_MENU_ID = "ocr-select-sentence";

// ---- 安裝時建立右鍵選單 ----
chrome.runtime.onInstalled.addListener(() => {
  // 先清空再建立，避免更新時 id 重複報錯。
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "OCR 選取單字",
      contexts: ["page", "selection", "image", "video", "link"],
    });
    chrome.contextMenus.create({
      id: SENTENCE_MENU_ID,
      title: "OCR 收錄句子",
      contexts: ["page", "selection", "image", "video", "link"],
    });
  });
});

// ---- 觸發來源：快捷鍵（單字模式）----
chrome.commands.onCommand.addListener((command) => {
  if (command === "start-ocr") {
    startSelectionInActiveTab("word");
  }
});

// ---- 觸發來源：右鍵選單 ----
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id == null) return;
  if (info.menuItemId === CONTEXT_MENU_ID) {
    startSelection(tab.id, "word");
  } else if (info.menuItemId === SENTENCE_MENU_ID) {
    startSelection(tab.id, "sentence");
  }
});

async function startSelectionInActiveTab(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) startSelection(tab.id, mode);
}

// 注入 content script 開始框選。content.js 內含重複注入保護，
// 重複觸發時會重新啟動框選而非重複註冊監聽。
// 先注入一個小函式設定 window.__ocrMode，content 會把它隨選取結果回傳，
// 不依賴 service worker 的記憶體狀態（避免 SW 被回收時遺失模式）。
async function startSelection(tabId, mode = "word") {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (m) => {
        window.__ocrMode = m;
      },
      args: [mode],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content.js"],
    });
  } catch (e) {
    // 例如 chrome:// 等受限頁面無法注入。
    console.warn("無法在此頁面啟動 OCR：", e.message);
  }
}

// ---- 接收 content script 的訊息 ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 略過要給 offscreen 的訊息（由 offscreen 的監聽器處理）。
  if (message?.target === "offscreen") return;

  if (message?.type === "OCR_REGION_SELECTED") {
    const tabId = sender?.tab?.id;
    const windowId = sender?.tab?.windowId;
    if (tabId != null) {
      handleRegion(tabId, windowId, message.rect, message.dpr, message.mode || "word");
    }
    return; // 非同步流程，不需回應 content。
  }
});

// 主流程：截圖 → 裁切 OCR → 翻譯 → 存檔 → 回報。依 mode 分流單字 / 句子。
async function handleRegion(tabId, windowId, rect, dpr, mode) {
  const notify = (msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});

  try {
    notify({ type: "OCR_STATUS", message: "辨識中…" });

    // 1) 截取可視區域。
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });

    // 2) 交給 offscreen 裁切 + OCR。
    await ensureOffscreen();
    const ocr = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "OCR_RUN",
      dataUrl,
      rect,
      dpr,
    });
    if (!ocr?.ok) {
      throw new Error(ocr?.error || "OCR 辨識失敗。");
    }

    if (mode === "sentence") {
      await handleSentence(ocr.text, notify);
    } else {
      await handleWord(ocr.text, notify);
    }
  } catch (e) {
    notify({ type: "OCR_ERROR", message: e.message || String(e) });
  }
}

// 單字模式：清理成查詢詞 → 去重 → Gemini → 存檔。
async function handleWord(text, notify) {
  const word = cleanWord(text);
  if (!word) {
    throw new Error("沒有辨識到英文字，請重新框選清楚一點的文字。");
  }

  // 已存在則直接顯示既有卡片，省一次 API 呼叫。
  const existing = await findWord(word);
  if (existing) {
    notify({ type: "OCR_RESULT", kind: "word", payload: existing, duplicate: true });
    return;
  }

  notify({ type: "OCR_STATUS", message: `「${word}」翻譯中…` });
  const settings = await getSettings();
  const info = await fetchWordInfo(word, settings);
  const { word: saved } = await addWord(info);
  notify({ type: "OCR_RESULT", kind: "word", payload: saved, duplicate: false });
}

// 句子模式：保留整句 → Gemini 翻成中文 → 存進句子島。
async function handleSentence(text, notify) {
  const en = cleanSentence(text);
  if (!en) {
    throw new Error("沒有辨識到文字，請重新框選清楚一點的句子。");
  }

  notify({ type: "OCR_STATUS", message: "翻譯句子中…" });
  const settings = await getSettings();
  const { zh } = await fetchSentenceZH(en, settings);
  const { sentence: saved, isNew } = await addSentence({ zh, en, source: "ocr" });
  notify({
    type: "OCR_RESULT",
    kind: "sentence",
    payload: { en: saved.en, zh: saved.zh },
    duplicate: !isNew,
  });
}

// 把 OCR 文字整理成一個查詢詞：取首段、去除前後非字母符號。
function cleanWord(text) {
  if (!text) return "";
  const firstLine = String(text).split(/\n/)[0].trim();
  // 允許英文字母、空白、連字號與撇號（如 well-known、it's）。
  const cleaned = firstLine
    .replace(/[^A-Za-z\s'’-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

// 把 OCR 多行文字整理成一句：換行併成空白、收斂多餘空白，保留標點。
function cleanSentence(text) {
  if (!text) return "";
  return String(text)
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Offscreen 文件管理 ----
async function ensureOffscreen() {
  // 較新 Chrome 提供 getContexts 判斷是否已存在。
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (contexts.length > 0) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: ["BLOBS"],
      justification: "對截圖進行裁切並以 Tesseract.js 做 OCR 文字辨識。",
    });
  } catch (e) {
    // 競態下可能已被其他流程建立，忽略「已存在」類錯誤。
    if (!String(e.message).includes("single offscreen")) throw e;
  }
}
