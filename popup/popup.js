// popup/popup.js
function open(path) {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

document.getElementById("openPractice").addEventListener("click", () => open("practice/practice.html"));
document.getElementById("openDashboard").addEventListener("click", () => open("dashboard/dashboard.html"));
document.getElementById("openSentences").addEventListener("click", () => open("sentences/sentences.html"));
document.getElementById("openList").addEventListener("click", () => open("wordlist/wordlist.html"));
document.getElementById("openSettings").addEventListener("click", () => open("settings/settings.html"));
