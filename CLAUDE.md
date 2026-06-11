# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

Manifest V3 Chrome 擴充功能：在任何畫面（含圖片/影片/PDF 等不可選取文字）用快捷鍵或右鍵選單拖曳框選英文單字 → 本機 Tesseract.js OCR 辨識 → Google Gemini 產生翻譯/詞性/例句 → 存入 `chrome.storage.local`，以卡片列表管理。純 Vanilla JS，**無建置流程、無套件管理**。

## 開發與測試

沒有 build / lint / test 框架，也沒有 `package.json`。開發循環如下：

- **載入擴充**：`chrome://extensions` → 開「開發人員模式」→「載入未封裝項目」→ 選專案根目錄。
- **套用改動**：改 `manifest.json`、`background.js`、`offscreen/` 後，務必到 `chrome://extensions` 對此擴充按**重新載入**（🔄）；只改頁面（`popup/`、`settings/`、`wordlist/`）則重新開啟該分頁即可。
- **看 log**：
  - background（service worker）/ offscreen：`chrome://extensions` → 此擴充的「Service Worker」與「檢視畫面」連結。
  - content script：在**目標網頁**的 DevTools console。
- **語法檢查**（唯一可在 CLI 跑的驗證，需 Node）：
  - 一般 script：`node --check content/content.js`（同理 `offscreen/offscreen.js`、`popup/popup.js`）
  - ES module 檔（`background.js`、`shared/*.js`、`settings/settings.js`、`wordlist/wordlist.js`）含 `import`/`export`，須以 `.mjs` 副檔名才會被當 ESM 檢查：複製到暫存改名 `*.mjs` 後再 `node --check`。

> Windows PowerShell 5.1 傳中文給原生程式（如 `git commit -m`）易亂碼，commit 訊息用英文；`ConvertFrom-Json` 讀 UTF-8 檔可能誤報，驗 JSON 改用 `node -e "JSON.parse(require('fs').readFileSync(p,'utf8'))"`。

## 架構：一次 OCR 的完整資料流

跨四個執行 context 協作，理解這條鏈是理解全專案的關鍵：

1. **觸發** → `background.js` 監聽 `chrome.commands`（快捷鍵 `Ctrl+Shift+S`）與 `chrome.contextMenus`。
2. **注入框選 UI**：background 用 `chrome.scripting.executeScript` **動態注入** `content/content.js`（非靜態 content_scripts，較不干擾一般瀏覽）。content.js 以 `window.__ocrWord` 做**重複注入保護**——再次注入只會重啟框選，不重複註冊監聽。
3. **框選**：content 在 **Shadow DOM** 內畫半透明 overlay（與目標頁樣式完全隔離），放開滑鼠後把矩形（CSS px，相對 viewport）+ `devicePixelRatio` 用 `chrome.runtime.sendMessage({type:"OCR_REGION_SELECTED"})` 回傳。
4. **截圖 + OCR**：background `chrome.tabs.captureVisibleTab()` 截可視區 PNG → `ensureOffscreen()` → 送 offscreen 做裁切（rect × dpr）與 Tesseract 辨識。
5. **翻譯 + 存檔**：background `cleanWord()` 整理文字 → `findWord()` 去重（已存在則直接回傳，省一次 API）→ `fetchWordInfo()`（Gemini）→ `addWord()` → 用 `chrome.tabs.sendMessage` 回 tab 顯示浮卡（`OCR_RESULT` / `OCR_STATUS` / `OCR_ERROR`）。

### 訊息協定的關鍵約定
- 同一個 `chrome.runtime.onMessage` 通道由 background 與 offscreen 共用，**靠 `message.target === "offscreen"` 區分**：offscreen 只處理該標記、background 直接略過該標記。
- 方向不對稱：**content → background** 用 `chrome.runtime.sendMessage`；**background → content** 必須用 `chrome.tabs.sendMessage(tabId, …)`（content script 收不到 runtime.sendMessage）。

## MV3 下 Tesseract.js 的硬性限制（改動 OCR 前必讀）

這些是踩過的坑，破壞任一項 OCR 就會靜默失敗：
- **OCR 只能在 Offscreen Document**：service worker 無 DOM/canvas 無法跑；放 content script 會踩目標頁 CSP。
- `manifest.json` 的 `content_security_policy.extension_pages` **必須含 `'wasm-unsafe-eval'`**，否則 WebAssembly 無法編譯。
- `Tesseract.createWorker` **必須設 `workerBlobURL: false`**，否則它預設用 blob URL 建 worker，會被 MV3 CSP（`script-src 'self'`）擋下。
- `corePath` 指向**具體檔** `lib/tesseract-core.wasm.js`（非目錄），避免 v5 自動偵測 SIMD 去找不存在的 `*-simd` 檔。
- `lib/` 是 **vendored** 的 Tesseract.js v5 資產（`tesseract.min.js`、`worker.min.js`、`tesseract-core.wasm(.js)`、`eng.traineddata.gz`），供離線使用，並列於 `web_accessible_resources`。`offscreen.html` 以 `<script src>` 載入 `tesseract.min.js`（offscreen 是普通 script，不可用 ESM import）。

## ES Module 邊界

- **是 module**（`type="module"`，可 `import`）：`background.js`、`shared/storage.js`、`shared/gemini.js`、`settings/settings.js`、`wordlist/wordlist.js`。
- **是普通 script**（不可 import）：`content/content.js`（注入到目標頁）、`offscreen/offscreen.js`、`popup/popup.js`。
- 新增共用邏輯時：能被 module 端共用的放 `shared/`；content 與 offscreen 因不能 import，需自帶或透過 `<script>` 載入。

## 資料模型（`chrome.storage.local`，封裝於 `shared/storage.js`）

- `words`：`{ id, word, translation, partOfSpeech, exampleEN, exampleZH, pinned, createdAt }[]`。`getWords()` 排序規則 = **置頂優先，再依 `createdAt` 由新到舊**；去重以 word 轉小寫比對。
- `settings`：`{ geminiApiKey, model, targetLang }`，含 `DEFAULT_SETTINGS`（預設模型 `gemini-2.0-flash`、目標語言繁體中文）。

## Gemini 整合（`shared/gemini.js`）

- 端點 `…/v1beta/models/{model}:generateContent`，以 `responseMimeType:"application/json"` + `responseSchema` 強制結構化輸出，避免解析自由文字。
- 模型名稱由設定頁提供、可更換。`listModels()`（呼叫 ListModels API）用於排查「429 / `free_tier_requests limit: 0`」這類配額問題——該錯誤代表金鑰有效但該模型無免費額度，需換模型或換金鑰，**不是程式 bug**。
