// wordlist/wordlist.js
import { getWords, deleteWord, togglePin } from "../shared/storage.js";

const grid = document.getElementById("grid");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const searchEl = document.getElementById("search");
const sortEl = document.getElementById("sort");

let allWords = [];
let keyword = "";
// 排序方式：date（建立日期，新→舊）/ alpha（字母順序）/ random（隨機）
let sortMode = localStorage.getItem("ocr_sort_mode") || "date";
let randKey = new Map(); // id -> 隨機值，讓隨機順序在重繪之間維持穩定

const esc = (s) =>
  String(s || "").replace(/[&<>"]/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])
  );

function fmtDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch (_) {
    return "";
  }
}

// 相似詞區塊：有資料才渲染，每列為「字＋語域小標＋中文」。
function synonymsHtml(syns) {
  if (!Array.isArray(syns) || syns.length === 0) return "";
  const items = syns
    .filter((s) => s && s.word)
    .map(
      (s) =>
        `<div class="syn-item"><span class="sw">${esc(s.word)}</span>${
          s.register ? `<span class="sr">${esc(s.register)}</span>` : ""
        }<span class="sm">${esc(s.meaning)}</span></div>`
    )
    .join("");
  return items ? `<div class="syn"><div class="syn-title">相似詞</div>${items}</div>` : "";
}

function cardHtml(w) {
  return `
    <article class="wcard ${w.pinned ? "pinned" : ""}" data-id="${esc(w.id)}">
      <div class="head">
        <span class="word">${esc(w.word)}</span>
        ${w.partOfSpeech ? `<span class="pos">${esc(w.partOfSpeech)}</span>` : ""}
        ${w.register ? `<span class="reg">${esc(w.register)}</span>` : ""}
      </div>
      <p class="trans">${esc(w.translation)}</p>
      ${
        w.exampleEN
          ? `<div class="ex">
               <div class="en">${esc(w.exampleEN)}</div>
               <div class="zh">${esc(w.exampleZH)}</div>
             </div>`
          : ""
      }
      ${synonymsHtml(w.synonyms)}
      <div class="foot">
        <span class="date">${fmtDate(w.createdAt)}</span>
        <button class="act pin ${w.pinned ? "on" : ""}" data-act="pin" data-id="${esc(w.id)}">
          ${w.pinned ? "📌 已置頂" : "📌 置頂"}
        </button>
        <button class="act del" data-act="del" data-id="${esc(w.id)}">刪除</button>
      </div>
    </article>
  `;
}

function applyFilter(list) {
  if (!keyword) return list;
  const k = keyword.toLowerCase();
  return list.filter(
    (w) =>
      (w.word || "").toLowerCase().includes(k) ||
      (w.translation || "").toLowerCase().includes(k) ||
      (Array.isArray(w.synonyms) &&
        w.synonyms.some((s) => (s.word || "").toLowerCase().includes(k)))
  );
}

function ensureRandomKeys(list) {
  list.forEach((w) => {
    if (!randKey.has(w.id)) randKey.set(w.id, Math.random());
  });
}
function reshuffle(list) {
  randKey = new Map();
  list.forEach((w) => randKey.set(w.id, Math.random()));
}

function compareBy(a, b) {
  if (sortMode === "alpha") {
    return (a.word || "").localeCompare(b.word || "", "en", { sensitivity: "base" });
  }
  if (sortMode === "random") {
    return (randKey.get(a.id) || 0) - (randKey.get(b.id) || 0);
  }
  // date：建立日期由新到舊
  return (b.createdAt || 0) - (a.createdAt || 0);
}

// 置頂卡片永遠固定在最前、不受排序方式影響；只有非置頂卡片才套用選定排序。
function applySort(list) {
  if (sortMode === "random") ensureRandomKeys(list);
  const pinned = list
    .filter((w) => w.pinned)
    .sort((a, b) => (b.pinnedAt || b.createdAt || 0) - (a.pinnedAt || a.createdAt || 0));
  const rest = list.filter((w) => !w.pinned).sort(compareBy);
  return pinned.concat(rest);
}

function render() {
  const filtered = applySort(applyFilter(allWords));
  countEl.textContent = `共 ${allWords.length} 個單字`;

  if (allWords.length === 0) {
    grid.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  if (filtered.length === 0) {
    grid.innerHTML = `<p style="color:#64748b;grid-column:1/-1;">找不到符合「${esc(keyword)}」的單字。</p>`;
    return;
  }
  grid.innerHTML = filtered.map(cardHtml).join("");
}

async function reload() {
  allWords = await getWords();
  render();
}

// 事件委派：置頂 / 刪除。
grid.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === "pin") {
    await togglePin(id);
  } else if (btn.dataset.act === "del") {
    await deleteWord(id);
  }
  await reload();
});

searchEl.addEventListener("input", () => {
  keyword = searchEl.value.trim();
  render();
});

// 還原上次選的排序方式，並監聽切換。
sortEl.value = sortMode;
sortEl.addEventListener("change", () => {
  sortMode = sortEl.value;
  localStorage.setItem("ocr_sort_mode", sortMode);
  if (sortMode === "random") reshuffle(allWords); // 每次選「隨機」重新洗牌
  render();
});

document.getElementById("openSettings").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings/settings.html") });
});

// 若在其他分頁新增單字，回到此頁時自動更新。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.words) reload();
});

reload();
