const inputEl = document.getElementById("input");
const parseBtn = document.getElementById("parseBtn");
const openBtn = document.getElementById("openBtn");
const clearBtn = document.getElementById("clearBtn");
const previewEl = document.getElementById("preview");
const countEl = document.getElementById("count");
const linkListEl = document.getElementById("linkList");
const statusEl = document.getElementById("status");
const hideCompletedToggle = document.getElementById("hideCompletedToggle");
const quizAnswersInput = document.getElementById("quizAnswersInput");
const copyQuizBtn = document.getElementById("copyQuizBtn");
const autoQuizBtn = document.getElementById("autoQuizBtn");
const geminiApiKeysList = document.getElementById("geminiApiKeysList");
const addGeminiApiKeyBtn = document.getElementById("addGeminiApiKeyBtn");
const geminiModelSelect = document.getElementById("geminiModelSelect");
const geminiAutoToggle = document.getElementById("geminiAutoToggle");

let extractedLinks = [];
let saveGeminiKeysTimer = null;
const SESSION_KEY = "hideCompletedEnabled";
const GEMINI_KEY_STORAGE = "geminiApiKey";
const GEMINI_KEYS_STORAGE = "geminiApiKeys";
const GEMINI_KEY_INDEX_STORAGE = "geminiApiKeyIndex";
const GEMINI_MODEL_STORAGE = "geminiModel";
const GEMINI_AUTO_STORAGE = "geminiAutoEnabled";
const ALLOWED_GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"];
const KEYMAP_STORAGE = "qlo_tool_panel_keymap";
const keymapFieldsEl = document.getElementById("keymapFields");
const keymapResetBtn = document.getElementById("keymapResetBtn");
const keymapSaveBtn = document.getElementById("keymapSaveBtn");
const keymapStatusEl = document.getElementById("keymapStatus");

const DEFAULT_TOOL_KEYMAP = {
  jump: "alt+j",
  quiz: "alt+q",
  paste: "alt+v",
  skip: "alt+s",
  fastQuiz: "alt+f",
  stop: "alt+x",
  togglePanel: "alt+c",
};

const TOOL_KEYMAP_LABELS = {
  jump: "Nhảy bài chưa hoàn thành",
  quiz: "Quiz",
  paste: "Paste đáp án",
  skip: "Skip video/reading",
  fastQuiz: "Fast Quiz",
  stop: "Dừng Fast Quiz",
  togglePanel: "Thu gọn / mở rộng menu",
};

function normalizeKeyCombo(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return "";
  const parts = raw
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const mods = [];
  let key = "";
  for (const part of parts) {
    if (part === "ctrl" || part === "control") {
      if (!mods.includes("ctrl")) mods.push("ctrl");
      continue;
    }
    if (part === "alt" || part === "option") {
      if (!mods.includes("alt")) mods.push("alt");
      continue;
    }
    if (part === "shift") {
      if (!mods.includes("shift")) mods.push("shift");
      continue;
    }
    if (part === "meta" || part === "cmd" || part === "command" || part === "win") {
      if (!mods.includes("meta")) mods.push("meta");
      continue;
    }
    key = part.length === 1 ? part : part.replace(/\s+/g, "");
  }
  return [...mods, key].filter(Boolean).join("+");
}

function mergeKeymapWithDefaults(stored) {
  const next = {};
  for (const action of Object.keys(DEFAULT_TOOL_KEYMAP)) {
    const custom = normalizeKeyCombo(stored?.[action] || "");
    next[action] = custom || DEFAULT_TOOL_KEYMAP[action];
  }
  return next;
}

function setKeymapStatus(message, isError = false) {
  if (!keymapStatusEl) return;
  keymapStatusEl.textContent = message || "";
  keymapStatusEl.style.color = isError ? "#dc2626" : "#059669";
}

function renderKeymapFields(keymap) {
  if (!keymapFieldsEl) return;
  keymapFieldsEl.innerHTML = "";
  for (const action of Object.keys(DEFAULT_TOOL_KEYMAP)) {
    const row = document.createElement("label");
    row.className = "popup-keymap-row";
    const span = document.createElement("span");
    span.textContent = TOOL_KEYMAP_LABELS[action] || action;
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.action = action;
    input.value = keymap[action] || "";
    row.appendChild(span);
    row.appendChild(input);
    keymapFieldsEl.appendChild(row);
  }
}

async function loadKeymapForPopup() {
  try {
    const stored = await chrome.storage.local.get(KEYMAP_STORAGE);
    return mergeKeymapWithDefaults(stored[KEYMAP_STORAGE] || {});
  } catch {
    return mergeKeymapWithDefaults({});
  }
}

async function saveKeymapFromPopup(map) {
  const payload = {};
  for (const action of Object.keys(DEFAULT_TOOL_KEYMAP)) {
    payload[action] = normalizeKeyCombo(map?.[action] || "");
  }
  await chrome.storage.local.set({ [KEYMAP_STORAGE]: payload });
  return mergeKeymapWithDefaults(payload);
}

async function initKeymapUi() {
  if (!keymapFieldsEl) return;
  const keymap = await loadKeymapForPopup();
  renderKeymapFields(keymap);

  keymapResetBtn?.addEventListener("click", async () => {
    renderKeymapFields(DEFAULT_TOOL_KEYMAP);
    await saveKeymapFromPopup(DEFAULT_TOOL_KEYMAP);
    setKeymapStatus("Đã reset keymap mặc định.");
  });

  keymapSaveBtn?.addEventListener("click", async () => {
    const next = {};
    keymapFieldsEl.querySelectorAll("input[data-action]").forEach((input) => {
      next[input.dataset.action] = normalizeKeyCombo(input.value || "");
    });
    try {
      const merged = await saveKeymapFromPopup(next);
      renderKeymapFields(merged);
      setKeymapStatus("Đã lưu keymap.");
    } catch {
      setKeymapStatus("Không lưu được keymap.", true);
    }
  });
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status${type ? ` ${type}` : ""}`;
}

statusEl?.addEventListener("click", async () => {
  const text = String(statusEl?.textContent || "").trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Đã copy thông báo vào clipboard.", "success");
  } catch {
    // ignore
  }
});

function isCourseraUrl(url) {
  // Only apply to pages on coursera.org domain.
  return /^https?:\/\/([\w-]+\.)*coursera\.org\//i.test(url || "");
}

function parseLetterAnswers(answerPart) {
  let part = String(answerPart || "").trim();
  if (!part) return [];

  if (part.includes(",")) {
    return part
      .split(",")
      .map((s) => s.replace(/^[/\s]+/, "").trim().toLowerCase())
      .filter((s) => /^[a-z]$/.test(s));
  }

  part = part.replace(/^[/\s]+/, "");

  const letter = part.match(/[a-z]/i)?.[0]?.toLowerCase();
  return letter && /^[a-z]$/.test(letter) ? [letter] : [];
}

function parseQuizAnswers(text) {
  const answersMap = [];
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Examples: "1. c", "2) a", "4. a,b", "5. c,d"
    const match = line.match(/^\s*(\d+)\s*[.)]?\s*(.*)$/);
    if (!match) continue;

    const questionIndex = Number(match[1]);
    if (!Number.isFinite(questionIndex) || questionIndex <= 0) continue;

    const rawAnswer = String(match[2] || "").trim();
    if (!rawAnswer) continue;

    const answers = parseLetterAnswers(rawAnswer);
    if (answers.length > 0) {
      answersMap.push({ questionIndex, answers, text: "" });
      continue;
    }

    // Hỗ trợ câu điền text/richtext.
    answersMap.push({ questionIndex, answers: [], text: rawAnswer });
  }

  return answersMap;
}

function formatQuizForCopy(quizData) {
  const prompt =
    "Trả lời các câu hỏi dưới đây và đưa ra đáp án (A,B,C,D) theo định dạng 1/A xong xuống dòng 2/B. Nếu câu hỏi là câu chọn nhiều có thể viết giống như sau: 1/A,B.\n\n";
  let output = prompt;

  for (let i = 0; i < quizData.length; i += 1) {
    const q = quizData[i];
    output += `Câu ${i + 1}: ${q.questionText}\n`;
    for (let optIdx = 0; optIdx < q.options.length; optIdx += 1) {
      const optionLetter = String.fromCharCode(65 + optIdx);
      output += `${optionLetter}. ${q.options[optIdx]}\n`;
    }
    output += "\n";
  }

  return output;
}

async function copyQuizContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus("Lỗi: không tìm thấy tab đang mở.", "error");
    return;
  }
  if (!tab.url || !isCourseraUrl(tab.url)) {
    setStatus("Lỗi: tab hiện tại không phải Coursera.", "error");
    return;
  }

  setStatus("Đang lấy nội dung quiz...");

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "getQuizContent" });
    if (!response || !response.quizData || response.quizData.length === 0) {
      setStatus("Không tìm thấy câu hỏi nào trên trang này.", "error");
      return;
    }

    const formatted = formatQuizForCopy(response.quizData);
    await navigator.clipboard.writeText(formatted);
    setStatus(`Đã copy ${response.quizData.length} câu hỏi vào clipboard.`, "success");
  } catch (err) {
    setStatus(`Lỗi khi lấy nội dung quiz: ${err?.message || err}`, "error");
  }
}

async function sendFillQuiz(answersMap) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus("Lỗi: không tìm thấy tab đang mở.", "error");
    return;
  }
  if (!tab.url || !isCourseraUrl(tab.url)) {
    setStatus("Lỗi: tab hiện tại không phải Coursera.", "error");
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "fillQuiz", answersMap });
    setStatus(`Đã gửi ${answersMap.length} đáp án sang trang Coursera.`, "success");
  } catch (err) {
    setStatus(`Lỗi khi gửi đáp án: ${err?.message || err}`, "error");
  }
}

async function sendSubmitQuiz() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus("Lỗi: không tìm thấy tab đang mở.", "error");
    return;
  }
  if (!tab.url || !isCourseraUrl(tab.url)) {
    setStatus("Lỗi: tab hiện tại không phải Coursera.", "error");
    return;
  }

  try {
    setStatus("Đang nộp bài...");
    await chrome.tabs.sendMessage(tab.id, { action: "submitQuiz" });
    setStatus("Đã gửi yêu cầu nộp bài.", "success");
  } catch (err) {
    setStatus(`Lỗi khi gửi lệnh nộp bài: ${err?.message || err}`, "error");
  }
}

async function sendHideCompleted(enabled) {
  if (!hideCompletedToggle) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  if (!tab.url || !isCourseraUrl(tab.url)) return;

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "SET_HIDE_COMPLETED",
      enabled: !!enabled,
    });
  } catch {
    // content.js might not be ready yet; ignore.
  }
}

function setSessionEnabled(enabled) {
  try {
    chrome.storage.session.set({ [SESSION_KEY]: !!enabled });
  } catch {
    // Ignore if storage is unavailable.
  }
}

function initHideCompletedToggle() {
  if (!hideCompletedToggle) return;

  // Default OFF every time popup opens.
  hideCompletedToggle.checked = false;
  setSessionEnabled(false);
  sendHideCompleted(false);

  hideCompletedToggle.addEventListener("change", () => {
    const enabled = hideCompletedToggle.checked;
    setSessionEnabled(enabled);
    sendHideCompleted(hideCompletedToggle.checked);
  });
}

function cleanUrl(rawUrl) {
  return rawUrl
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[)\]},.;!?]+$/g, "")
    .trim();
}

function extractLinks(text) {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  const seen = new Set();
  const links = [];

  for (const match of matches) {
    const url = cleanUrl(match);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    links.push(url);
  }

  return links;
}

function renderPreview(links) {
  extractedLinks = links;
  linkListEl.innerHTML = "";

  if (links.length === 0) {
    previewEl.classList.add("hidden");
    openBtn.disabled = true;
    countEl.textContent = "0";
    return;
  }

  previewEl.classList.remove("hidden");
  countEl.textContent = String(links.length);
  openBtn.disabled = false;

  links.forEach((url, index) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = url;
    link.textContent = `${index + 1}. ${url}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.appendChild(link);
    linkListEl.appendChild(item);
  });
}

function parseInput() {
  const links = extractLinks(inputEl.value);
  renderPreview(links);

  if (links.length === 0) {
    setStatus("Không tìm thấy link nào. Hãy dán lại nội dung có URL.", "error");
    return;
  }

  setStatus(`Đã tìm thấy ${links.length} link theo thứ tự.`, "success");
}

async function openAllTabs() {
  if (extractedLinks.length === 0) {
    parseInput();
    if (extractedLinks.length === 0) {
      return;
    }
  }

  openBtn.disabled = true;
  setStatus(`Đang mở ${extractedLinks.length} tab...`);

  try {
    for (let i = 0; i < extractedLinks.length; i += 1) {
      await chrome.tabs.create({
        url: extractedLinks[i],
        active: i === 0,
      });
    }

    setStatus(`Đã mở ${extractedLinks.length} tab theo thứ tự.`, "success");
    window.close();
  } catch (error) {
    setStatus(`Lỗi khi mở tab: ${error.message}`, "error");
    openBtn.disabled = false;
  }
}

function clearAll() {
  inputEl.value = "";
  extractedLinks = [];
  renderPreview([]);
  setStatus("");
  inputEl.focus();
}

async function onAutoQuizClick(sourceTextOverride) {
  let sourceText = "";
  if (typeof sourceTextOverride === "string") {
    sourceText = sourceTextOverride.trim();
  }

  if (!sourceText) {
    sourceText = quizAnswersInput?.value?.trim() || "";
  }

  if (!sourceText) {
    try {
      sourceText = (await navigator.clipboard.readText()).trim();
      if (sourceText && quizAnswersInput) {
        quizAnswersInput.value = sourceText;
      }
    } catch {
      setStatus("Không đọc được clipboard. Hãy dán đáp án vào ô text.", "error");
      return;
    }
  }

  if (!sourceText) {
    setStatus("Ô đáp án trống và clipboard không có nội dung.", "error");
    return;
  }

  if (quizAnswersInput && !quizAnswersInput.value?.trim()) {
    quizAnswersInput.value = sourceText;
  }

  const answersMap = parseQuizAnswers(sourceText);
  if (answersMap.length === 0) {
    setStatus("Không có đáp án hợp lệ. Ví dụ: 1. c hoặc 4. a,b", "error");
    return;
  }
  await sendFillQuiz(answersMap);
}

parseBtn.addEventListener("click", parseInput);
openBtn.addEventListener("click", openAllTabs);
clearBtn.addEventListener("click", clearAll);
copyQuizBtn?.addEventListener("click", copyQuizContent);
autoQuizBtn?.addEventListener("click", onAutoQuizClick);

inputEl.addEventListener("input", () => {
  if (inputEl.value.trim()) {
    parseInput();
  } else {
    clearAll();
  }
});

inputEl.addEventListener("paste", () => {
  setTimeout(parseInput, 0);
});

inputEl.focus();

initHideCompletedToggle();

function normalizeGeminiKeys(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((k) => String(k || "").trim()).filter(Boolean);
}

async function loadGeminiKeysFromStorage() {
  try {
    const stored = await chrome.storage.local.get([GEMINI_KEYS_STORAGE, GEMINI_KEY_STORAGE]);
    let keys = normalizeGeminiKeys(stored[GEMINI_KEYS_STORAGE]);
    if (!keys.length) {
      const legacy = String(stored[GEMINI_KEY_STORAGE] || "").trim();
      if (legacy) keys = [legacy];
    }
    return keys.length ? keys : [""];
  } catch {
    return [""];
  }
}

async function saveGeminiKeysFromUi() {
  if (!geminiApiKeysList) return;
  const keys = normalizeGeminiKeys(
    Array.from(geminiApiKeysList.querySelectorAll(".gemini-api-key-input")).map((el) => el.value)
  );
  const payload = {
    [GEMINI_KEYS_STORAGE]: keys,
    [GEMINI_KEY_STORAGE]: keys[0] || "",
  };
  try {
    const stored = await chrome.storage.local.get([GEMINI_KEY_INDEX_STORAGE]);
    const idx = Number(stored[GEMINI_KEY_INDEX_STORAGE]) || 0;
    if (idx >= keys.length) {
      payload[GEMINI_KEY_INDEX_STORAGE] = 0;
    }
    await chrome.storage.local.set(payload);
  } catch {
    // ignore
  }
}

function scheduleSaveGeminiKeys() {
  if (saveGeminiKeysTimer) window.clearTimeout(saveGeminiKeysTimer);
  saveGeminiKeysTimer = window.setTimeout(() => {
    void saveGeminiKeysFromUi();
  }, 250);
}

function createGeminiApiKeyRow(value = "") {
  const row = document.createElement("div");
  row.className = "api-key-row";

  const input = document.createElement("input");
  input.type = "password";
  input.className = "gemini-api-key-input";
  input.placeholder = "Gemini API key";
  input.value = value;
  input.autocomplete = "off";
  input.addEventListener("input", scheduleSaveGeminiKeys);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-remove-key";
  removeBtn.title = "Xóa key";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    const rows = geminiApiKeysList?.querySelectorAll(".api-key-row") || [];
    if (rows.length <= 1) {
      input.value = "";
      scheduleSaveGeminiKeys();
      return;
    }
    row.remove();
    scheduleSaveGeminiKeys();
  });

  row.appendChild(input);
  row.appendChild(removeBtn);
  return row;
}

function renderGeminiApiKeys(keys) {
  if (!geminiApiKeysList) return;
  geminiApiKeysList.innerHTML = "";
  const list = keys.length ? keys : [""];
  for (const key of list) {
    geminiApiKeysList.appendChild(createGeminiApiKeyRow(key));
  }
}

async function initGeminiSettings() {
  try {
    const stored = await chrome.storage.local.get([
      GEMINI_KEYS_STORAGE,
      GEMINI_KEY_STORAGE,
      GEMINI_MODEL_STORAGE,
      GEMINI_AUTO_STORAGE,
    ]);
    let keys = normalizeGeminiKeys(stored[GEMINI_KEYS_STORAGE]);
    if (!keys.length) {
      const legacy = String(stored[GEMINI_KEY_STORAGE] || "").trim();
      keys = legacy ? [legacy] : [""];
    }
    renderGeminiApiKeys(keys);
    if (geminiModelSelect) {
      const rawModel = String(stored[GEMINI_MODEL_STORAGE] || "gemini-2.5-flash");
      const model = ALLOWED_GEMINI_MODELS.includes(rawModel) ? rawModel : "gemini-2.5-flash";
      geminiModelSelect.value = model;
    }
    if (geminiAutoToggle) {
      geminiAutoToggle.checked = !!stored[GEMINI_AUTO_STORAGE];
    }
  } catch {
    // ignore
  }
}

function wireGeminiSettings() {
  addGeminiApiKeyBtn?.addEventListener("click", () => {
    if (!geminiApiKeysList) return;
    geminiApiKeysList.appendChild(createGeminiApiKeyRow(""));
    const inputs = geminiApiKeysList.querySelectorAll(".gemini-api-key-input");
    inputs[inputs.length - 1]?.focus?.();
    scheduleSaveGeminiKeys();
  });

  if (geminiModelSelect) {
    geminiModelSelect.addEventListener("change", async () => {
      try {
        await chrome.storage.local.set({ [GEMINI_MODEL_STORAGE]: geminiModelSelect.value });
      } catch {
        // ignore
      }
    });
  }
  if (geminiAutoToggle) {
    geminiAutoToggle.addEventListener("change", async () => {
      try {
        await chrome.storage.local.set({ [GEMINI_AUTO_STORAGE]: !!geminiAutoToggle.checked });
      } catch {
        // ignore
      }
    });
  }
}

initGeminiSettings();
wireGeminiSettings();
void initKeymapUi();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return;

  if (message.action === "pasteAndSubmit") {
    (async () => {
      try {
        await onAutoQuizClick(message.answersText);
        await sendSubmitQuiz();
        sendResponse?.({ ok: true });
      } catch (err) {
        sendResponse?.({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true; // Keep message channel open for async sendResponse.
  }

  if (message.action === "copyQuizContent") {
    (async () => {
      try {
        await copyQuizContent();
        sendResponse?.({ ok: true });
      } catch (err) {
        sendResponse?.({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }
});
