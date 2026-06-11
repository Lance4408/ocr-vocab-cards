// dashboard/dashboard.js
import { getDashboardData } from "../shared/storage.js";

const $ = (id) => document.getElementById(id);
const open = (path) => chrome.tabs.create({ url: chrome.runtime.getURL(path) });

$("goPractice").addEventListener("click", () => open("practice/practice.html"));
$("openSentences").addEventListener("click", () => open("sentences/sentences.html"));
$("openList").addEventListener("click", () => open("wordlist/wordlist.html"));
$("openSettings").addEventListener("click", () => open("settings/settings.html"));

function renderChart(last7) {
  const max = Math.max(1, ...last7.map((x) => x.reviews));
  $("chart").innerHTML = last7
    .map((x) => {
      const h = x.reviews ? Math.max(Math.round((x.reviews / max) * 100), 8) : 0;
      const label = x.date.slice(5); // MM-DD
      return `
        <div class="bar-col">
          <div class="bar-val">${x.reviews || ""}</div>
          <div class="bar-wrap"><div class="bar" style="height:${h}%"></div></div>
          <div class="bar-day">${label}</div>
        </div>`;
    })
    .join("");
}

(async function init() {
  const d = await getDashboardData();

  $("streak").textContent = d.streak;
  $("streakSub").textContent = d.studiedToday
    ? "今天已練，保持住！"
    : d.streak > 0
    ? "今天還沒練，別斷了！"
    : "今天就開始第一天吧！";

  $("due").textContent = d.dueToday;
  $("dueSub").textContent = d.dueToday > 0 ? '點「去練習」開始' : "今天清空了 🎉";

  $("mastered").textContent = d.masteredCount;
  $("totSent").textContent = d.totalSentences;
  $("totWord").textContent = d.totalWords;

  if (d.startDate) {
    $("wfill").style.width = d.progressPct + "%";
    $("milestone").textContent = d.milestone;
    $("weekMeta").textContent = `學習第 ${d.daysSinceStart} 天 · 第 ${d.week} 週 · 起始 ${d.startDate}`;
  } else {
    $("wfill").style.width = "0%";
    $("milestone").textContent = "完成第一次練習後，這裡會開始追蹤你的 6 週進度。";
    $("weekMeta").textContent = "";
  }

  renderChart(d.last7);
  const rate = d.todayReviews ? Math.round((d.todayRight / d.todayReviews) * 100) : 0;
  $("todayMeta").textContent = d.todayReviews
    ? `今天練了 ${d.todayReviews} 題，答對率 ${rate}%。`
    : "今天還沒開始練習。";
})();
