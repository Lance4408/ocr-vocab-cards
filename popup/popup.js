// popup/popup.js
document.getElementById("openList").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("wordlist/wordlist.html") });
  window.close();
});

document.getElementById("openSettings").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings/settings.html") });
  window.close();
});
