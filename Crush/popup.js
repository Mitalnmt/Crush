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

let extractedLinks = [];
const SESSION_KEY = "hideCompletedEnabled";

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status${type ? ` ${type}` : ""}`;
}

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

    const answers = parseLetterAnswers(match[2]);
    if (answers.length === 0) continue;

    answersMap.push({ questionIndex, answers });
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

async function onAutoQuizClick() {
  let sourceText = quizAnswersInput?.value?.trim() || "";

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
