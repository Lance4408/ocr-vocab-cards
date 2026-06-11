// shared/gemini.js
// 呼叫 Google Gemini API：給一個英文單字，回傳結構化的
// { word, partOfSpeech, translation, exampleEN, exampleZH }。

const ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Gemini 的 responseSchema：強制模型輸出固定欄位的 JSON，省去自行解析的風險。
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    word: { type: "STRING", description: "整理後的英文單字或片語（修正大小寫與拼字）" },
    partOfSpeech: { type: "STRING", description: "詞性，例如 noun、verb、adjective" },
    translation: { type: "STRING", description: "該字的目標語言釋義（可含多個常見意思）" },
    exampleEN: { type: "STRING", description: "一句生活常用的英文例句，使用到該單字" },
    exampleZH: { type: "STRING", description: "英文例句對應的自然目標語言翻譯" },
  },
  required: ["word", "partOfSpeech", "translation", "exampleEN", "exampleZH"],
};

function buildPrompt(word, targetLang) {
  return [
    `你是一位英語學習助理。針對英文單字或片語「${word}」，請輸出以下資訊，目標語言為「${targetLang}」：`,
    `1. word：修正拼字與大小寫後的標準形式。`,
    `2. partOfSpeech：詞性（若有多個取最常見者，用英文標示如 noun / verb / adjective）。`,
    `3. translation：以${targetLang}說明此字的常見意思，簡潔即可。`,
    `4. exampleEN：一句「日常生活常用」、自然口語的英文例句，必須包含此單字。`,
    `5. exampleZH：exampleEN 的${targetLang}翻譯，要通順自然。`,
    `請務必只輸出 JSON。`,
  ].join("\n");
}

// 呼叫 Gemini 取得單字資訊。
// settings: { geminiApiKey, model, targetLang }
export async function fetchWordInfo(word, settings) {
  const apiKey = settings?.geminiApiKey?.trim();
  if (!apiKey) {
    throw new Error("尚未設定 Gemini API Key，請先到設定頁輸入。");
  }
  const model = (settings?.model || "gemini-2.0-flash").trim();
  const targetLang = settings?.targetLang || "繁體中文";

  const url = `${ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt(word, targetLang) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.7,
    },
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`無法連線到 Gemini：${e.message}`);
  }

  if (!resp.ok) {
    let detail = "";
    try {
      const err = await resp.json();
      detail = err?.error?.message || "";
    } catch (_) {
      /* 忽略解析錯誤 */
    }
    throw new Error(`Gemini 回應錯誤（${resp.status}）${detail ? "：" + detail : ""}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini 沒有回傳內容，可能是被安全機制攔截或模型名稱有誤。");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error("無法解析 Gemini 回傳的 JSON。");
  }
  return {
    word: parsed.word || word,
    partOfSpeech: parsed.partOfSpeech || "",
    translation: parsed.translation || "",
    exampleEN: parsed.exampleEN || "",
    exampleZH: parsed.exampleZH || "",
  };
}

// 列出此 API Key 可用、且支援 generateContent 的模型名稱（已去除 "models/" 前綴）。
export async function listModels(settings) {
  const apiKey = settings?.geminiApiKey?.trim();
  if (!apiKey) throw new Error("請先輸入 API Key。");
  const url = `${ENDPOINT_BASE}?key=${encodeURIComponent(apiKey)}&pageSize=200`;
  const resp = await fetch(url);
  if (!resp.ok) {
    let detail = "";
    try {
      const err = await resp.json();
      detail = err?.error?.message || "";
    } catch (_) {
      /* 忽略 */
    }
    throw new Error(`無法取得模型清單（${resp.status}）${detail ? "：" + detail : ""}`);
  }
  const data = await resp.json();
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter(Boolean);
}

// 輕量「測試連線」：送一個極短請求驗證 API Key / 模型是否可用。
export async function testConnection(settings) {
  const apiKey = settings?.geminiApiKey?.trim();
  if (!apiKey) throw new Error("請先輸入 API Key。");
  const model = (settings?.model || "gemini-2.0-flash").trim();
  const url = `${ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
      generationConfig: { maxOutputTokens: 1 },
    }),
  });
  if (!resp.ok) {
    let detail = "";
    try {
      const err = await resp.json();
      detail = err?.error?.message || "";
    } catch (_) {
      /* 忽略 */
    }
    throw new Error(`連線失敗（${resp.status}）${detail ? "：" + detail : ""}`);
  }
  return true;
}

// ---- 句子翻譯（句子島用） ----

// 共用的 JSON 產生呼叫：組 body、送出、處理錯誤與解析，回傳已解析的物件。
// 錯誤訊息格式與 fetchWordInfo 一致（含 429 配額情境由設定頁加上引導）。
async function callGeminiJSON(settings, prompt, schema) {
  const apiKey = settings?.geminiApiKey?.trim();
  if (!apiKey) {
    throw new Error("尚未設定 Gemini API Key，請先到設定頁輸入。");
  }
  const model = (settings?.model || "gemini-2.0-flash").trim();
  const url = `${ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.7,
    },
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`無法連線到 Gemini：${e.message}`);
  }

  if (!resp.ok) {
    let detail = "";
    try {
      const err = await resp.json();
      detail = err?.error?.message || "";
    } catch (_) {
      /* 忽略 */
    }
    throw new Error(`Gemini 回應錯誤（${resp.status}）${detail ? "：" + detail : ""}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini 沒有回傳內容，可能是被安全機制攔截或模型名稱有誤。");
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("無法解析 Gemini 回傳的 JSON。");
  }
}

const NATURAL_EN_SCHEMA = {
  type: "OBJECT",
  properties: {
    en: { type: "STRING", description: "自然、口語、日常生活會用到的英文翻譯（單一句）" },
  },
  required: ["en"],
};

// 中文句子 → 母語者日常會說的自然口語英文。
export async function fetchNaturalEN(zh, settings) {
  const prompt = [
    `你是一位母語為英語的口語老師。請把下面這句中文翻成「日常生活中母語者真的會這樣說」的自然英文：`,
    `「${zh}」`,
    `要求：`,
    `1. 口語、自然，不要教科書式或過度正式、生硬的講法。`,
    `2. 只輸出一句最常用的說法；若原句是問句就用問句、是口語短句就保持口語。`,
    `3. 只輸出 JSON，en 欄位放英文句子。`,
  ].join("\n");
  const parsed = await callGeminiJSON(settings, prompt, NATURAL_EN_SCHEMA);
  return { en: String(parsed.en || "").trim() };
}

const SENTENCE_ZH_SCHEMA = {
  type: "OBJECT",
  properties: {
    zh: { type: "STRING", description: "通順自然的目標語言翻譯" },
  },
  required: ["zh"],
};

// OCR 收來的英文整句 → 通順自然的目標語言翻譯。
export async function fetchSentenceZH(en, settings) {
  const targetLang = settings?.targetLang || "繁體中文";
  const prompt = [
    `請把下面這句英文翻成通順自然的${targetLang}：`,
    `「${en}」`,
    `只輸出 JSON，zh 欄位放${targetLang}翻譯。`,
  ].join("\n");
  const parsed = await callGeminiJSON(settings, prompt, SENTENCE_ZH_SCHEMA);
  return { zh: String(parsed.zh || "").trim() };
}
