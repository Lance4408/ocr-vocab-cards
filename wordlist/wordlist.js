// wordlist/wordlist.js
import { getWords, deleteWord, togglePin } from "../shared/storage.js";

const grid = document.getElementById("grid");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const searchEl = document.getElementById("search");

let allWords = [];
let keyword = "";

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

function cardHtml(w) {
  return `
    <article class="wcard ${w.pinned ? "pinned" : ""}" data-id="${esc(w.id)}">
      <div class="head">
        <span class="word">${esc(w.word)}</span>
        ${w.partOfSpeech ? `<span class="pos">${esc(w.partOfSpeech)}</span>` : ""}
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
      (w.translation || "").toLowerCase().includes(k)
  );
}

function render() {
  const filtered = applyFilter(allWords);
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

document.getElementById("openSettings").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings/settings.html") });
});

// 若在其他分頁新增單字，回到此頁時自動更新。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.words) reload();
});

reload();
