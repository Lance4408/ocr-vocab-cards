// sentences/sentences.js
import {
  getSentences,
  addSentence,
  updateSentence,
  deleteSentence,
  toggleSentencePin,
  getSettings,
} from "../shared/storage.js";
import { fetchNaturalEN } from "../shared/gemini.js";
import { speak, isSupported } from "../shared/tts.js";
import { setupVoiceControls } from "../shared/voiceControls.js";

const grid = document.getElementById("grid");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const searchEl = document.getElementById("search");
const zhInput = document.getElementById("zhInput");
const enPreview = document.getElementById("enPreview");
const translateBtn = document.getElementById("translate");
const playPreviewBtn = document.getElementById("playPreview");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");

let allSentences = [];
let keyword = "";
let editingId = null;
let settings = {}; // 供 fetchNaturalEN 取用 API Key / 模型
let voiceCtl = { getRate: () => 1, getVoice: () => "" };

const esc = (s) =>
  String(s || "").replace(/[&<>"]/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])
  );

function setStatus(text, kind = "info") {
  statusEl.textContent = text;
  statusEl.className = "status " + kind;
}

function fmtDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch (_) {
    return "";
  }
}

function play(text) {
  if (!isSupported()) {
    setStatus("此瀏覽器不支援朗讀。", "err");
    return;
  }
  speak(text, { rate: voiceCtl.getRate(), voice: voiceCtl.getVoice() });
}

function cardHtml(s) {
  if (s.id === editingId) {
    return `
      <article class="scard" data-id="${esc(s.id)}">
        <textarea data-edit="zh">${esc(s.zh)}</textarea>
        <textarea data-edit="en">${esc(s.en)}</textarea>
        <div class="foot">
          <button class="act" data-act="save-edit" data-id="${esc(s.id)}">儲存</button>
          <button class="act" data-act="cancel-edit" data-id="${esc(s.id)}">取消</button>
        </div>
      </article>`;
  }
  const isOcr = s.source === "ocr";
  return `
    <article class="scard ${s.pinned ? "pinned" : ""}" data-id="${esc(s.id)}">
      <div class="zh">${esc(s.zh)}</div>
      <div class="en">${esc(s.en)}</div>
      <div class="meta">
        <span class="src ${isOcr ? "ocr" : ""}">${isOcr ? "OCR" : "手動"}</span>
        <span class="date">${fmtDate(s.createdAt)}</span>
      </div>
      <div class="foot">
        <button class="act play" data-act="play" data-id="${esc(s.id)}" title="朗讀">🔊 朗讀</button>
        <span class="act spacer"></span>
        <button class="act" data-act="edit" data-id="${esc(s.id)}">編輯</button>
        <button class="act pin ${s.pinned ? "on" : ""}" data-act="pin" data-id="${esc(s.id)}">
          ${s.pinned ? "📌 已置頂" : "📌 置頂"}
        </button>
        <button class="act del" data-act="del" data-id="${esc(s.id)}">刪除</button>
      </div>
    </article>`;
}

function applyFilter(list) {
  if (!keyword) return list;
  const k = keyword.toLowerCase();
  return list.filter(
    (s) => (s.zh || "").toLowerCase().includes(k) || (s.en || "").toLowerCase().includes(k)
  );
}

function render() {
  const filtered = applyFilter(allSentences);
  countEl.textContent = `共 ${allSentences.length} 句`;

  if (allSentences.length === 0) {
    grid.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  if (filtered.length === 0) {
    grid.innerHTML = `<p style="color:#64748b;grid-column:1/-1;">找不到符合「${esc(keyword)}」的句子。</p>`;
    return;
  }
  grid.innerHTML = filtered.map(cardHtml).join("");
}

async function reload() {
  allSentences = await getSentences();
  render();
}

// ---- 新增句子 ----
translateBtn.addEventListener("click", async () => {
  const zh = zhInput.value.trim();
  if (!zh) {
    setStatus("請先輸入中文句子。", "err");
    return;
  }
  translateBtn.disabled = true;
  setStatus("AI 轉英文中…", "info");
  try {
    const { en } = await fetchNaturalEN(zh, settings);
    enPreview.value = en;
    saveBtn.disabled = !en;
    setStatus("已產生英文，可手動微調後儲存。", "ok");
  } catch (e) {
    let msg = e.message || "轉換失敗。";
    if (/\b429\b/.test(msg) || /quota|limit:\s*0/i.test(msg)) {
      msg += "（金鑰有效，但此模型沒有可用額度，請到設定頁改選其他模型。）";
    }
    setStatus(msg, "err");
  } finally {
    translateBtn.disabled = false;
  }
});

playPreviewBtn.addEventListener("click", () => {
  const text = enPreview.value.trim();
  if (text) play(text);
});

enPreview.addEventListener("input", () => {
  saveBtn.disabled = !enPreview.value.trim();
});

saveBtn.addEventListener("click", async () => {
  const zh = zhInput.value.trim();
  const en = enPreview.value.trim();
  if (!zh || !en) {
    setStatus("中文與英文都要有才能儲存。", "err");
    return;
  }
  const { isNew } = await addSentence({ zh, en, source: "manual" });
  zhInput.value = "";
  enPreview.value = "";
  saveBtn.disabled = true;
  setStatus(isNew ? "已加入句子島。" : "這句英文已在句子島中。", isNew ? "ok" : "info");
  await reload();
});

// ---- 卡片事件委派 ----
grid.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const s = allSentences.find((x) => x.id === id);

  if (act === "play") {
    if (s) play(s.en);
    return;
  }
  if (act === "edit") {
    editingId = id;
    render();
    return;
  }
  if (act === "cancel-edit") {
    editingId = null;
    render();
    return;
  }
  if (act === "save-edit") {
    const card = btn.closest(".scard");
    const zh = card.querySelector('[data-edit="zh"]').value.trim();
    const en = card.querySelector('[data-edit="en"]').value.trim();
    if (!zh || !en) {
      setStatus("中文與英文都不能空白。", "err");
      return;
    }
    await updateSentence(id, { zh, en });
    editingId = null;
    await reload();
    return;
  }
  if (act === "pin") {
    await toggleSentencePin(id);
    await reload();
    return;
  }
  if (act === "del") {
    await deleteSentence(id);
    await reload();
    return;
  }
});

searchEl.addEventListener("input", () => {
  keyword = searchEl.value.trim();
  render();
});

document.getElementById("openPractice").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("practice/practice.html") });
});
document.getElementById("openSettings").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings/settings.html") });
});

// 其他分頁（含 OCR 收句）更新時自動刷新。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.sentences && editingId === null) reload();
});

(async function init() {
  settings = await getSettings();
  voiceCtl = await setupVoiceControls({
    voiceEl: document.getElementById("voiceSel"),
    rateEl: document.getElementById("rateSlider"),
    rateLabelEl: document.getElementById("rateLabel"),
  });
  await reload();
})();
