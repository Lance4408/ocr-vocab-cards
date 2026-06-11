# OCR 單字卡 Chrome Extension

在任何網頁、圖片、PDF 或影片畫面上，用快捷鍵或右鍵選單框選英文單字，
透過本機 OCR 辨識文字，再由 Google Gemini 產生中文翻譯、詞性與例句，
並以卡片式列表收錄管理。

## 功能

- **劃詞 OCR**：快捷鍵（預設 `Ctrl+Shift+S`，Mac `Cmd+Shift+S`）或右鍵選單「OCR 選取單字」啟動，拖曳矩形框選。
- **AI 產生內容**：翻譯、詞性、生活化英文例句、中文例句翻譯。
- **本機收錄**：單字存於 `chrome.storage.local`，以卡片網格呈現。
- **卡片管理**：每張卡可「置頂」與「刪除」，並支援關鍵字搜尋。
- **離線 OCR**：使用內嵌的 Tesseract.js，文字辨識在本機進行，不上傳畫面。

## 安裝（載入未封裝項目）

1. 開啟 Chrome，網址列輸入 `chrome://extensions`。
2. 右上角開啟「開發人員模式」。
3. 點「載入未封裝項目」，選擇本專案資料夾（含 `manifest.json` 的這層）。
4. 安裝後在工具列點擊擴充圖示 →「開啟設定」。

## 設定

1. 到 [Google AI Studio](https://aistudio.google.com/app/apikey) 取得 Gemini API Key（有免費額度）。
2. 在設定頁貼上 API Key，可選擇模型（預設 `gemini-2.0-flash`）與翻譯目標語言（預設繁體中文）。
3. 按「測試連線」確認可用，再按「儲存設定」。

## 使用

1. 在任一網頁按快捷鍵或右鍵選單啟動 OCR。
2. 拖曳框選一個英文單字（盡量框緊、文字清楚）。
3. 畫面會顯示「辨識中 → 翻譯中」，完成後跳出翻譯浮卡，並自動收錄。
4. 點擊擴充圖示 →「開啟單字列表」查看與管理所有單字。

## 專案結構

```
manifest.json          MV3 設定
background.js           service worker：觸發 / 截圖 / 流程編排 / 存檔
content/content.js      框選遮罩 + 翻譯浮卡（Shadow DOM 隔離）
offscreen/              裁切截圖 + Tesseract.js OCR
shared/storage.js       chrome.storage.local 封裝
shared/gemini.js        Gemini API 呼叫與結構化解析
popup/                  工具列彈出面板（兩顆按鈕）
wordlist/               卡片式單字列表頁
settings/               API Key / 模型 / 語言設定頁
lib/                    內嵌的 Tesseract.js 與英文語言資料
icons/                  擴充圖示
```

## 注意事項

- API Key 僅存於本機 `chrome.storage.local`，不會傳給任何第三方伺服器（只會直接呼叫 Google Gemini）。
- 第一次 OCR 會載入 WASM 與語言資料，較慢；之後 worker 重用會快很多。
- 在 `chrome://`、Chrome 線上應用程式商店等受限頁面無法啟動 OCR。
- 同一個單字重複框選不會重複收錄，會直接顯示既有卡片。
- OCR 對小字、藝術字、低對比文字較不準；框選時盡量放大、框緊單字。

## 技術備註

- Tesseract.js 在 MV3 需設定 `workerBlobURL: false`（CSP 不允許 blob worker），
  並在 manifest 加入 `'wasm-unsafe-eval'` 以允許 WebAssembly。
- OCR 在 Offscreen Document 執行，避免將 worker 注入目標頁而踩到該頁 CSP。
