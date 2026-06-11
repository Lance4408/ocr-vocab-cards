// practice/practice.js
import { getReviewQueue, recordReview, getSettings } from "../shared/storage.js";
import { speak, stop, isSupported } from "../shared/tts.js";

const $ = (id) => document.getElementById(id);
const sourceEl = $("source");
const barFill = $("barFill");
const progressLabel = $("progressLabel");
const tallyRight = $("tallyRight");
const tallyWrong = $("tallyWrong");
const stageEl = $("stage");
const ktagEl = $("ktag");
const frontEl = $("front");
const answerEl = $("answer");
const backEl = $("back");
const extraEl = $("extra");
const revealBtn = $("reveal");
const gradersEl = $("graders");
const doneEl = $("done");
const doneSummary = $("doneSummary");
const emptyqEl = $("emptyq");

const SLOW_RATE = 0.6;

let settings = { ttsRate: 1, ttsVoice: "" };
let source = "all";
let queue = [];
let index = 0;
let total = 0;
let completed = 0;
let wrongAttempts = 0;
let revealed = false;

const esc = (s) =>
  String(s || "").replace(/[&<>"]/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])
  );

function play(text, slow) {
  if (!isSupported() || !text) return;
  speak(text, { rate: slow ? SLOW_RATE : Number(settings.ttsRate) || 1, voice: settings.ttsVoice });
}

function updateProgress() {
  const pct = total ? Math.round((completed / total) * 100) : 0;
  barFill.style.width = pct + "%";
  progressLabel.textContent = `完成 ${completed} / ${total}`;
  tallyRight.textContent = `✅ ${completed}`;
  tallyWrong.textContent = `❌ ${wrongAttempts}`;
}

function extraHtml(item) {
  if (item.kind === "word") {
    const parts = [];
    if (item.extra.partOfSpeech) parts.push(`<span class="pos">${esc(item.extra.partOfSpeech)}</span>`);
    if (item.extra.exampleEN) {
      parts.push(`<div class="ex-en">${esc(item.extra.exampleEN)}</div>`);
      if (item.extra.exampleZH) parts.push(`<div>${esc(item.extra.exampleZH)}</div>`);
    }
    return parts.join("");
  }
  return item.extra.note ? esc(item.extra.note) : "";
}

function showCard() {
  const item = queue[index];
  revealed = false;
  ktagEl.textContent = item.kind === "sentence" ? "句子" : "單字";
  frontEl.textContent = item.front;
  backEl.textContent = "";
  extraEl.innerHTML = "";
  answerEl.hidden = true;
  gradersEl.hidden = true;
  revealBtn.hidden = false;
}

function reveal() {
  if (revealed) return;
  const item = queue[index];
  backEl.textContent = item.back;
  extraEl.innerHTML = extraHtml(item);
  answerEl.hidden = false;
  revealBtn.hidden = true;
  gradersEl.hidden = false;
  revealed = true;
  play(item.playText, false);
}

async function grade(result) {
  if (!revealed) return;
  const item = queue[index];
  await recordReview(item.kind, item.id, result);
  if (result === "right") {
    completed++;
  } else {
    wrongAttempts++;
    queue.push(item); // 答錯：本回合稍後再出現
  }
  index++;
  updateProgress();
  if (completed >= total) {
    showDone();
  } else {
    showCard();
  }
}

function showDone() {
  stop();
  stageEl.hidden = true;
  emptyqEl.hidden = true;
  doneEl.hidden = false;
  doneSummary.textContent =
    wrongAttempts === 0
      ? `共 ${total} 題，全部一次就記得，太強了！`
      : `共 ${total} 題，過程中答錯 ${wrongAttempts} 次。答錯的下次會優先出現。`;
}

function showEmpty() {
  stop();
  stageEl.hidden = true;
  doneEl.hidden = true;
  emptyqEl.hidden = false;
  updateProgress();
}

async function buildSession() {
  queue = await getReviewQueue({ source });
  total = queue.length;
  index = 0;
  completed = 0;
  wrongAttempts = 0;
  revealed = false;

  if (total === 0) {
    showEmpty();
    return;
  }
  doneEl.hidden = true;
  emptyqEl.hidden = true;
  stageEl.hidden = false;
  updateProgress();
  showCard();
}

// ---- 事件 ----
revealBtn.addEventListener("click", reveal);
$("replay").addEventListener("click", () => play(queue[index]?.playText, false));
$("slow").addEventListener("click", () => play(queue[index]?.playText, true));
$("wrong").addEventListener("click", () => grade("wrong"));
$("right").addEventListener("click", () => grade("right"));
$("again").addEventListener("click", buildSession);

sourceEl.addEventListener("change", () => {
  source = sourceEl.value;
  localStorage.setItem("ocr_practice_source", source);
  buildSession();
});

const openSentences = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("sentences/sentences.html") });
$("openSentences").addEventListener("click", openSentences);
$("goSentences").addEventListener("click", openSentences);
$("openSettings").addEventListener("click", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("settings/settings.html") })
);

document.addEventListener("keydown", (e) => {
  if (!doneEl.hidden || !emptyqEl.hidden || stageEl.hidden) return;
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    if (!revealed) reveal();
    return;
  }
  if (revealed) {
    if (e.key === "1" || e.key === "ArrowLeft") grade("wrong");
    else if (e.key === "2" || e.key === "ArrowRight") grade("right");
  }
});

(async function init() {
  settings = await getSettings();
  source = localStorage.getItem("ocr_practice_source") || settings.practiceSource || "all";
  sourceEl.value = source;
  await buildSession();
})();
