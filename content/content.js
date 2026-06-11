// content/content.js
// 注入到目標頁，提供：1) 拖曳矩形框選 UI；2) 翻譯結果浮卡。
// 全部 UI 放在 Shadow DOM 內，與頁面樣式完全隔離。
// 含重複注入保護：第二次注入只會重新啟動框選，不重複註冊監聽。

(function () {
  if (window.__ocrWord) {
    window.__ocrWord.start();
    return;
  }

  const HOST_ID = "__ocrword_host";
  let host = null;
  let shadow = null;
  let selecting = false;
  let startPt = null;
  let lastRect = null;

  // ---- 建立 / 清除 host ----
  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText =
      "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif; }
        .overlay {
          position: fixed; inset: 0;
          background: rgba(15, 23, 42, 0.18);
          cursor: crosshair; pointer-events: auto;
        }
        .hint {
          position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
          background: rgba(15, 23, 42, 0.92); color: #fff;
          padding: 8px 16px; border-radius: 999px; font-size: 13px;
          pointer-events: none; white-space: nowrap;
        }
        .sel {
          position: fixed; border: 2px solid #38bdf8;
          background: rgba(56, 189, 248, 0.12);
          box-shadow: 0 0 0 100vmax rgba(15, 23, 42, 0.18);
          pointer-events: none;
        }
        .card {
          position: fixed; max-width: 360px; min-width: 240px;
          background: #ffffff; color: #0f172a;
          border-radius: 14px; pointer-events: auto;
          box-shadow: 0 12px 40px rgba(2, 6, 23, 0.28);
          border: 1px solid rgba(148, 163, 184, 0.25);
          padding: 14px 16px; font-size: 14px; line-height: 1.5;
          animation: pop .14s ease-out;
        }
        @keyframes pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .card .top { display: flex; align-items: baseline; gap: 8px; }
        .card .word { font-size: 19px; font-weight: 700; letter-spacing: .2px; }
        .card .pos {
          font-size: 12px; color: #2563eb; background: #eff6ff;
          padding: 1px 8px; border-radius: 999px; font-style: italic;
        }
        .card .close {
          margin-left: auto; cursor: pointer; border: none; background: none;
          font-size: 18px; color: #94a3b8; line-height: 1; padding: 0 2px;
        }
        .card .close:hover { color: #475569; }
        .card .trans { margin-top: 6px; font-size: 15px; color: #0f172a; }
        .card .ex { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #e2e8f0; }
        .card .ex .en { color: #334155; }
        .card .ex .zh { color: #64748b; margin-top: 2px; }
        .card .tag {
          display: inline-block; margin-top: 10px; font-size: 11px;
          color: #16a34a; background: #f0fdf4; padding: 1px 8px; border-radius: 999px;
        }
        .card .speak {
          border: none; background: #ecfeff; color: #0d9488; cursor: pointer;
          border-radius: 8px; padding: 1px 7px; font-size: 13px; margin-left: 6px;
          vertical-align: baseline;
        }
        .card .speak:hover { background: #cffafe; }
        .toast {
          position: fixed; min-width: 160px; max-width: 320px;
          background: #0f172a; color: #fff; border-radius: 12px;
          padding: 12px 14px; font-size: 14px; pointer-events: auto;
          box-shadow: 0 12px 40px rgba(2, 6, 23, 0.28);
          animation: pop .14s ease-out;
        }
        .toast.err { background: #7f1d1d; }
        .spinner {
          display: inline-block; width: 12px; height: 12px; margin-right: 8px;
          border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff;
          border-radius: 50%; vertical-align: -1px; animation: spin .7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
      <div class="layer"></div>
    `;
    (document.documentElement || document.body).appendChild(host);
  }

  function layer() {
    return shadow.querySelector(".layer");
  }

  function clearLayer() {
    if (shadow) layer().innerHTML = "";
  }

  function removeHost() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    shadow = null;
  }

  // ---- 框選 ----
  function start() {
    ensureHost();
    clearLayer();
    selecting = false;
    startPt = null;
    lastRect = null;

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const hint = document.createElement("div");
    hint.className = "hint";
    const mode = window.__ocrMode || "word";
    hint.textContent =
      (mode === "sentence" ? "拖曳框選英文句子" : "拖曳框選英文單字") + "　·　Esc 取消";
    const sel = document.createElement("div");
    sel.className = "sel";
    sel.style.display = "none";

    overlay.addEventListener("mousedown", onDown);
    overlay.addEventListener("mousemove", onMove);
    overlay.addEventListener("mouseup", onUp);

    layer().appendChild(overlay);
    layer().appendChild(sel);
    layer().appendChild(hint);

    document.addEventListener("keydown", onKey, true);

    function onDown(e) {
      selecting = true;
      startPt = { x: e.clientX, y: e.clientY };
      sel.style.display = "block";
      updateSel(e.clientX, e.clientY);
    }
    function onMove(e) {
      if (!selecting) return;
      updateSel(e.clientX, e.clientY);
    }
    function onUp(e) {
      if (!selecting) return;
      selecting = false;
      updateSel(e.clientX, e.clientY);
      document.removeEventListener("keydown", onKey, true);
      finishSelection();
    }
    function updateSel(cx, cy) {
      const x = Math.min(startPt.x, cx);
      const y = Math.min(startPt.y, cy);
      const w = Math.abs(cx - startPt.x);
      const h = Math.abs(cy - startPt.y);
      lastRect = { x, y, width: w, height: h };
      sel.style.left = x + "px";
      sel.style.top = y + "px";
      sel.style.width = w + "px";
      sel.style.height = h + "px";
    }
  }

  function onKey(e) {
    if (e.key === "Escape") {
      document.removeEventListener("keydown", onKey, true);
      removeHost();
    }
  }

  function finishSelection() {
    const r = lastRect;
    // 太小視為誤觸，直接取消。
    if (!r || r.width < 4 || r.height < 4) {
      removeHost();
      return;
    }
    // 移除框選層，改放 loading 浮卡（定位在選取區下方）。
    clearLayer();
    showToast("辨識中…", false, r);
    chrome.runtime.sendMessage({
      type: "OCR_REGION_SELECTED",
      rect: r,
      dpr: window.devicePixelRatio || 1,
      mode: window.__ocrMode || "word",
    });
  }

  // 用目標頁的 speechSynthesis 朗讀英文（純前端，不需權限）。
  function speakEN(text) {
    try {
      const synth = window.speechSynthesis;
      if (!synth || !text) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = "en-US";
      synth.speak(u);
    } catch (_) {
      /* 忽略 */
    }
  }

  // ---- 浮卡 / 提示 ----
  // anchor: 選取矩形，用來決定浮卡位置；省略則沿用上次位置。
  let anchorRect = null;

  function placeNear(el, r) {
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 先放到 DOM 才能量尺寸。
    el.style.visibility = "hidden";
    layer().appendChild(el);
    const rect = el.getBoundingClientRect();
    let left = r ? r.x : (vw - rect.width) / 2;
    let top = r ? r.y + r.height + margin : margin;
    if (top + rect.height > vh - margin) top = r ? r.y - rect.height - margin : margin;
    if (top < margin) top = margin;
    if (left + rect.width > vw - margin) left = vw - rect.width - margin;
    if (left < margin) left = margin;
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.visibility = "visible";
  }

  function showToast(text, isError, r) {
    ensureHost();
    clearLayer();
    if (r) anchorRect = r;
    const t = document.createElement("div");
    t.className = "toast" + (isError ? " err" : "");
    t.innerHTML = isError
      ? ""
      : '<span class="spinner"></span>';
    t.appendChild(document.createTextNode(text));
    if (isError) {
      const close = document.createElement("button");
      close.className = "close";
      close.textContent = " ✕";
      close.style.cssText = "border:none;background:none;color:#fecaca;cursor:pointer;font-size:14px;margin-left:8px;";
      close.addEventListener("click", removeHost);
      t.appendChild(close);
    }
    placeNear(t, anchorRect);
    if (isError) {
      bindOutsideClose();
      setTimeout(() => removeHost(), 6000);
    }
  }

  function showResult(payload, duplicate, kind) {
    ensureHost();
    clearLayer();
    const c = document.createElement("div");
    c.className = "card";
    const esc = (s) =>
      String(s || "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

    if (kind === "sentence") {
      c.innerHTML = `
        <div class="top">
          <span class="word">句子已收錄</span>
          <button class="close" title="關閉">✕</button>
        </div>
        <div class="trans">${esc(payload.zh)}</div>
        <div class="ex">
          <div class="en">${esc(payload.en)}<button class="speak" title="朗讀">🔊</button></div>
        </div>
        ${duplicate ? `<span class="tag">已在句子島中</span>` : `<span class="tag">已加入句子島</span>`}
      `;
      const sp = c.querySelector(".speak");
      if (sp) sp.addEventListener("click", () => speakEN(payload.en));
    } else {
      c.innerHTML = `
        <div class="top">
          <span class="word">${esc(payload.word)}</span>
          ${payload.partOfSpeech ? `<span class="pos">${esc(payload.partOfSpeech)}</span>` : ""}
          <button class="close" title="關閉">✕</button>
        </div>
        <div class="trans">${esc(payload.translation)}</div>
        ${
          payload.exampleEN
            ? `<div class="ex"><div class="en">${esc(payload.exampleEN)}</div><div class="zh">${esc(payload.exampleZH)}</div></div>`
            : ""
        }
        ${duplicate ? `<span class="tag">已在單字庫中</span>` : `<span class="tag">已加入單字庫</span>`}
      `;
    }
    c.querySelector(".close").addEventListener("click", removeHost);
    placeNear(c, anchorRect);
    bindOutsideClose();
  }

  // 點擊浮卡以外區域時關閉。
  function bindOutsideClose() {
    setTimeout(() => {
      const handler = (e) => {
        const path = e.composedPath ? e.composedPath() : [];
        if (host && !path.includes(host)) {
          document.removeEventListener("mousedown", handler, true);
          removeHost();
        }
      };
      document.addEventListener("mousedown", handler, true);
    }, 0);
  }

  // ---- 監聽 background 回傳（只註冊一次）----
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "OCR_STATUS") {
      showToast(message.message, false, null);
    } else if (message?.type === "OCR_RESULT") {
      showResult(message.payload, message.duplicate, message.kind);
    } else if (message?.type === "OCR_ERROR") {
      showToast(message.message, true, null);
    }
  });

  window.__ocrWord = { start };
  start();
})();
