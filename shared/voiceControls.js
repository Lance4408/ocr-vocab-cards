// shared/voiceControls.js
// 共用「音色下拉 + 語速滑桿」控制：三個頁面（設定 / 句子島 / 練習）複用。
// 綁定後即時生效，並把選擇存回 settings，讓各頁互通。

import { getSettings, saveSettings } from "./storage.js";
import { listEnglishVoices } from "./tts.js";

// els: { voiceEl, rateEl, rateLabelEl }
// 回傳即時讀值的 getter：{ getRate, getVoice }。
export async function setupVoiceControls({ voiceEl, rateEl, rateLabelEl } = {}) {
  const s = await getSettings();
  let rate = clampRate(Number(s.ttsRate) || 1);
  let voice = s.ttsVoice || "";

  // ---- 語速滑桿（0.25–2，每 0.25 一格）----
  if (rateEl) {
    rateEl.value = String(rate);
    const showRate = () => {
      if (rateLabelEl) rateLabelEl.textContent = `${Number(rateEl.value).toFixed(2)}×`;
    };
    showRate();
    // input：拖動時即時更新顯示與當前值（朗讀立刻用新速度）。
    rateEl.addEventListener("input", () => {
      rate = clampRate(Number(rateEl.value) || 1);
      showRate();
    });
    // change：放開滑桿才寫入 storage，避免拖動時頻繁寫入。
    rateEl.addEventListener("change", () => {
      saveSettings({ ttsRate: rate });
    });
  }

  // ---- 音色下拉 ----
  if (voiceEl) {
    const voices = await listEnglishVoices();
    voiceEl.innerHTML = '<option value="">（系統預設語音）</option>';
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name}（${v.lang}）`;
      voiceEl.appendChild(opt);
    }
    if (voice && voices.some((v) => v.name === voice)) voiceEl.value = voice;
    voiceEl.addEventListener("change", () => {
      voice = voiceEl.value;
      saveSettings({ ttsVoice: voice });
    });
  }

  return {
    getRate: () => rate,
    getVoice: () => voice,
  };
}

function clampRate(r) {
  if (!Number.isFinite(r)) return 1;
  return Math.min(2, Math.max(0.25, r));
}
