// offscreen/offscreen.js
// 在 offscreen 文件中對截圖裁切，並用 Tesseract.js 辨識英文文字。
// 由 background 透過 chrome.runtime.sendMessage({target:"offscreen", ...}) 呼叫。

let workerPromise = null;

// 建立並重用單一 Tesseract worker（首次初始化較慢，之後重用）。
// 採 Tesseract.js v5 的 createWorker(langs, oem, options) 介面。
function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = Tesseract.createWorker("eng", 1, {
    workerPath: chrome.runtime.getURL("lib/worker.min.js"),
    corePath: chrome.runtime.getURL("lib/tesseract-core.wasm.js"),
    langPath: chrome.runtime.getURL("lib/"),
    // MV3 的 CSP (script-src 'self') 會擋掉 blob URL 建立的 worker，
    // 因此關閉 blob 模式，直接用擴充內的 worker.min.js（同源）。
    workerBlobURL: false,
  }).catch((e) => {
    workerPromise = null; // 失敗則允許下次重試。
    throw e;
  });
  return workerPromise;
}

// 載入 dataUrl 成可繪製的影像。
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("截圖載入失敗。"));
    img.src = dataUrl;
  });
}

// 依矩形（CSS px）與 dpr 裁切出選取區，並做放大 + 灰階前處理。
async function cropAndPreprocess(dataUrl, rect, dpr) {
  const img = await loadImage(dataUrl);
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.max(1, Math.round(rect.width * dpr));
  const sh = Math.max(1, Math.round(rect.height * dpr));

  // 文字偏小時放大，提升辨識率。
  const scale = sh < 60 ? 3 : sh < 120 ? 2 : 1;
  const dw = sw * scale;
  const dh = sh * scale;

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  // 白底，避免透明區域變黑影響辨識。
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dw, dh);
  ctx.filter = "grayscale(1) contrast(1.25)";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas;
}

async function runOcr(dataUrl, rect, dpr) {
  const canvas = await cropAndPreprocess(dataUrl, rect, dpr || 1);
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  return (data?.text || "").trim();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") return;
  if (message.type === "OCR_RUN") {
    runOcr(message.dataUrl, message.rect, message.dpr)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true; // 保持訊息通道開啟以便非同步回應。
  }
});
