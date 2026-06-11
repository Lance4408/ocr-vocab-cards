// shared/tts.js
// 朗讀封裝：使用瀏覽器內建的 Web Speech API（speechSynthesis）。
// 免 API Key、免額度、免 manifest 權限；音質依作業系統內建的英文語音而定。

const synth = typeof speechSynthesis !== "undefined" ? speechSynthesis : null;

// 是否支援朗讀（少數環境可能沒有 speechSynthesis）。
export function isSupported() {
  return !!synth;
}

// 取得英文語音清單。getVoices() 在頁面剛載入時可能為空，
// 需等 voiceschanged 事件，故以 Promise 回傳並設逾時保險。
export function listEnglishVoices() {
  return new Promise((resolve) => {
    if (!synth) return resolve([]);

    const pick = () =>
      synth.getVoices().filter((v) => /^en/i.test(v.lang || ""));

    const first = pick();
    if (first.length) return resolve(first);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener("voiceschanged", finish);
      resolve(pick());
    };
    synth.addEventListener("voiceschanged", finish);
    // 保險：部分瀏覽器不觸發 voiceschanged，逾時後直接回傳目前結果。
    setTimeout(finish, 1000);
  });
}

// 依名稱找語音物件；找不到回傳 null（讓引擎用預設）。
function findVoice(name) {
  if (!synth || !name) return null;
  return synth.getVoices().find((v) => v.name === name) || null;
}

// 朗讀一段英文。opts: { rate=1, voice }（voice 為語音名稱字串）。
export function speak(text, opts = {}) {
  if (!synth || !text) return;
  // 先取消佇列中的朗讀，避免快速連點時疊音。
  synth.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.lang = "en-US";
  u.rate = typeof opts.rate === "number" ? opts.rate : 1;
  const v = findVoice(opts.voice);
  if (v) {
    u.voice = v;
    u.lang = v.lang || u.lang;
  }
  synth.speak(u);
}

// 停止目前朗讀。
export function stop() {
  if (synth) synth.cancel();
}
