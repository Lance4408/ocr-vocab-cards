// settings/settings.js
import { getSettings, saveSettings } from "../shared/storage.js";
import { testConnection, listModels } from "../shared/gemini.js";
import { listEnglishVoices, speak } from "../shared/tts.js";

const $ = (id) => document.getElementById(id);
const apiKeyEl = $("apiKey");
const modelEl = $("model");
const targetLangEl = $("targetLang");
const ttsRateEl = $("ttsRate");
const ttsVoiceEl = $("ttsVoice");
const practiceSourceEl = $("practiceSource");
const statusEl = $("status");

function setStatus(text, kind = "info") {
  statusEl.textContent = text;
  statusEl.className = "status " + kind;
}

function readForm() {
  return {
    geminiApiKey: apiKeyEl.value.trim(),
    model: modelEl.value.trim() || "gemini-2.0-flash",
    targetLang: targetLangEl.value.trim() || "繁體中文",
    ttsRate: Number(ttsRateEl.value) || 1,
    ttsVoice: ttsVoiceEl.value,
    practiceSource: practiceSourceEl.value,
  };
}

// 把英文語音填進下拉清單，並還原已選的語音。
async function populateVoices(selected) {
  const voices = await listEnglishVoices();
  for (const v of voices) {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name}（${v.lang}）`;
    ttsVoiceEl.appendChild(opt);
  }
  if (selected && voices.some((v) => v.name === selected)) {
    ttsVoiceEl.value = selected;
  }
}

async function init() {
  const s = await getSettings();
  apiKeyEl.value = s.geminiApiKey || "";
  modelEl.value = s.model || "";
  targetLangEl.value = s.targetLang || "";
  ttsRateEl.value = String(s.ttsRate || 1);
  practiceSourceEl.value = s.practiceSource || "all";
  await populateVoices(s.ttsVoice || "");
}

$("testVoice").addEventListener("click", () => {
  speak("This is how the reading voice sounds.", {
    rate: Number(ttsRateEl.value) || 1,
    voice: ttsVoiceEl.value,
  });
});

$("toggleKey").addEventListener("click", () => {
  const showing = apiKeyEl.type === "text";
  apiKeyEl.type = showing ? "password" : "text";
  $("toggleKey").textContent = showing ? "顯示" : "隱藏";
});

$("save").addEventListener("click", async () => {
  await saveSettings(readForm());
  setStatus("已儲存設定。", "ok");
});

$("test").addEventListener("click", async () => {
  const form = readForm();
  if (!form.geminiApiKey) {
    setStatus("請先輸入 API Key。", "err");
    return;
  }
  setStatus("連線測試中…", "info");
  try {
    // 一併把當前表單存起來，避免使用者忘了按儲存。
    await saveSettings(form);
    await testConnection(form);
    setStatus("連線成功，API Key 與模型可用。", "ok");
  } catch (e) {
    let msg = e.message || "連線失敗。";
    // 429 / 配額為 0：金鑰有效，只是此模型沒有可用額度，引導使用者換模型。
    if (/\b429\b/.test(msg) || /quota|limit:\s*0/i.test(msg)) {
      msg += "（金鑰有效，但此模型沒有可用額度。請按「列出可用」改選其他模型，或更換 API Key。）";
    }
    setStatus(msg, "err");
  }
});

$("listModels").addEventListener("click", async () => {
  const form = readForm();
  if (!form.geminiApiKey) {
    setStatus("請先輸入 API Key。", "err");
    return;
  }
  setStatus("讀取可用模型中…", "info");
  try {
    await saveSettings(form);
    const models = await listModels(form);
    const dl = $("modelList");
    dl.innerHTML = "";
    models.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      dl.appendChild(opt);
    });
    if (models.length === 0) {
      setStatus("此金鑰沒有可用於產生內容的模型。", "err");
    } else {
      // 若目前填的模型不在清單中，自動帶入一個 flash 類模型方便使用。
      if (!models.includes(modelEl.value.trim())) {
        const prefer =
          models.find((m) => /1\.5-flash/.test(m)) ||
          models.find((m) => /flash/.test(m)) ||
          models[0];
        modelEl.value = prefer;
      }
      setStatus(`找到 ${models.length} 個可用模型，已填入下拉清單（點模型欄位可選）。`, "ok");
    }
  } catch (e) {
    setStatus(e.message || "讀取模型清單失敗。", "err");
  }
});

init();
