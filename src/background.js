function getGeminiEndpoint(model, apiKey, apiVersion = "v1") {
  const safeModel = encodeURIComponent(model);
  const safeKey = encodeURIComponent(apiKey);
  return `https://generativelanguage.googleapis.com/${apiVersion}/models/${safeModel}:generateContent?key=${safeKey}`;
}

function buildGeminiPrompt(quizText, questionCount) {
  const countHint =
    Number.isFinite(questionCount) && questionCount > 0
      ? `\n- Quiz có đúng ${questionCount} câu. Bạn PHẢI trả về đúng ${questionCount} dòng, từ 1 đến ${questionCount}, không được thiếu.`
      : "\n- Trả về đủ đáp án cho mọi câu hỏi trong nội dung quiz.";

  return `Bạn là trợ lý giải quiz Coursera.

Nhiệm vụ: đọc nội dung quiz và trả về CHỈ danh sách đáp án theo đúng định dạng từng dòng:
1. a
2. c
3. a,b
4. câu trả lời dạng text

Quy tắc:
- Chỉ trả về đáp án, không giải thích, không markdown.
- Với câu trắc nghiệm: dùng chữ cái a/b/c/d (in thường). Nếu chọn nhiều thì phân tách bằng dấu phẩy.
- Với câu điền ô trống / rich text: ghi nội dung text ngắn gọn sau số câu (ví dụ: 4. your answer text).
- Không bỏ qua câu nào. Nếu không chắc, chọn phương án hợp lý nhất.${countHint}

Nội dung quiz:
${quizText}`.trim();
}

async function callGeminiGenerateContent({ apiKey, model, quizText, questionCount }) {
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: buildGeminiPrompt(quizText, questionCount) }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  };

  const apiVersions = ["v1", "v1beta"];
  let lastError = null;

  for (const apiVersion of apiVersions) {
    const endpoint = getGeminiEndpoint(model, apiKey, apiVersion);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = await res.json();
      const text =
        json?.candidates?.[0]?.content?.parts
          ?.map((p) => p?.text)
          .filter(Boolean)
          .join("\n") || "";
      return String(text || "").trim();
    }

    const text = await res.text().catch(() => "");
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const err = new Error(`Gemini API error ${res.status}: ${text || res.statusText}`);
    err.status = res.status;
    err.rawText = text || "";
    err.parsed = parsed;
    err.apiVersion = apiVersion;
    lastError = err;

    if (res.status !== 404) break;
  }

  throw lastError || new Error("Gemini request failed.");
}

function extractRetrySeconds(err) {
  const retryDelay =
    err?.parsed?.error?.details?.find?.((d) => d?.["@type"]?.includes("RetryInfo"))?.retryDelay ||
    "";
  const secMatch = String(retryDelay).match(/(\d+)\s*s/i);
  if (secMatch) return Number(secMatch[1]);

  const rawMatch = String(err?.rawText || "").match(/retry in\s+([\d.]+)s/i);
  if (rawMatch) return Math.ceil(Number(rawMatch[1]));
  return null;
}

function humanizeGeminiError(err, model) {
  if (err?.status === 429) {
    const retrySec = extractRetrySeconds(err);
    const waitHint = retrySec ? `, thử lại sau ~${retrySec}s` : "";
    return `Model ${model} đã hết quota/tốc độ (429)${waitHint}.`;
  }
  if (err?.status === 400) {
    return `Request Gemini không hợp lệ (400). Kiểm tra API key/model.`;
  }
  if (err?.status === 404) {
    return `Model ${model} không tồn tại/không hỗ trợ ở API version hiện tại (404).`;
  }
  if (err?.status === 401 || err?.status === 403) {
    return `API key Gemini không hợp lệ hoặc chưa có quyền (${err.status}).`;
  }
  if (err?.status === 503) {
    return `Model ${model} đang quá tải tạm thời (503). Hệ thống sẽ thử model khác.`;
  }
  return err?.message || String(err);
}

function maskApiKey(key) {
  const s = String(key || "");
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function isKeyRotationError(err) {
  const status = err?.status;
  if (status === 429 || status === 401 || status === 403) return true;

  const blob = `${err?.rawText || ""} ${err?.message || ""} ${err?.parsed?.error?.message || ""}`.toLowerCase();
  return (
    blob.includes("quota") ||
    blob.includes("resource_exhausted") ||
    blob.includes("rate limit") ||
    blob.includes("exceeded") ||
    blob.includes("api key not valid") ||
    blob.includes("invalid api key") ||
    blob.includes("permission denied")
  );
}

function isModelFallbackError(err) {
  const status = err?.status;
  return status === 404 || status === 503;
}

async function getGeminiApiKeys() {
  const stored = await chrome.storage.local.get(["geminiApiKeys", "geminiApiKey"]);
  let keys = [];
  if (Array.isArray(stored.geminiApiKeys)) {
    keys = stored.geminiApiKeys.map((k) => String(k || "").trim()).filter(Boolean);
  }
  if (!keys.length) {
    const legacy = String(stored.geminiApiKey || "").trim();
    if (legacy) keys = [legacy];
  }
  return keys;
}

async function getGeminiKeyStartIndex(keyCount) {
  const stored = await chrome.storage.local.get(["geminiApiKeyIndex"]);
  let idx = Number(stored.geminiApiKeyIndex) || 0;
  if (!Number.isFinite(idx) || idx < 0 || idx >= keyCount) idx = 0;
  return idx;
}

async function saveGeminiKeyIndex(index) {
  try {
    await chrome.storage.local.set({ geminiApiKeyIndex: index });
  } catch {
    // ignore
  }
}

async function solveQuizWithGemini({ quizText, questionCount, model }) {
  const keys = await getGeminiApiKeys();
  if (!keys.length) {
    throw new Error("Missing Gemini API key (set it in popup).");
  }

  const fallbackModels = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"].filter(
    (m) => m !== model
  );
  const modelsToTry = [model, ...fallbackModels];
  const startKeyIndex = await getGeminiKeyStartIndex(keys.length);

  let lastError = null;
  let usedKeyIndex = startKeyIndex;
  let keyRotated = false;

  for (const modelToTry of modelsToTry) {
    for (let offset = 0; offset < keys.length; offset += 1) {
      const keyIndex = (startKeyIndex + offset) % keys.length;
      const apiKey = keys[keyIndex];
      try {
        const answersText = await callGeminiGenerateContent({
          apiKey,
          model: modelToTry,
          quizText,
          questionCount,
        });
        if (!answersText) {
          lastError = new Error(`Gemini returned empty output for ${modelToTry}.`);
          continue;
        }

        await saveGeminiKeyIndex(keyIndex);
        return {
          answersText,
          usedModel: modelToTry,
          fallback: modelToTry !== model,
          questionCount,
          usedKeyIndex: keyIndex,
          keyRotated: keyRotated || keyIndex !== startKeyIndex,
          usedKeyMask: maskApiKey(apiKey),
        };
      } catch (err) {
        lastError = err;
        if (isKeyRotationError(err)) {
          keyRotated = true;
          continue;
        }
        if (isModelFallbackError(err)) break;
        break;
      }
    }

    if (lastError && isModelFallbackError(lastError)) continue;
    if (lastError && isKeyRotationError(lastError)) continue;
    break;
  }

  const err = lastError || new Error("Gemini request failed.");
  err.keyRotated = keyRotated;
  throw err;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return;

  if (message.action === "geminiSolveQuiz") {
    (async () => {
      try {
        const { quizText, questionCount } = message;
        if (!quizText || !String(quizText).trim()) {
          sendResponse?.({ ok: false, error: "quizText is empty" });
          return;
        }

        const stored = await chrome.storage.local.get(["geminiModel"]);
        const model = String(stored.geminiModel || "gemini-2.5-flash").trim();

        const result = await solveQuizWithGemini({ quizText, questionCount, model });
        sendResponse?.({ ok: true, ...result });
      } catch (err) {
        sendResponse?.({
          ok: false,
          error: humanizeGeminiError(err, message?.model || "unknown"),
          details: err?.rawText || err?.message || String(err),
          keyRotated: !!err?.keyRotated,
        });
      }
    })();
    return true;
  }

  if (message.action === "openOnly") {
    (async () => {
      try {
        const url = String(message.url || "").trim();
        if (!url) {
          sendResponse?.({ ok: false, error: "Missing url" });
          return;
        }
        await chrome.tabs.create({ url });
        sendResponse?.({ ok: true });
      } catch (err) {
        sendResponse?.({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message.action === "performTransfer") {
    (async () => {
      try {
        const redirectUrl = String(message.redirectUrl || "").trim();
        if (!redirectUrl) {
          sendResponse?.({ ok: false, error: "Missing redirectUrl" });
          return;
        }
        await chrome.tabs.create({ url: redirectUrl });
        sendResponse?.({ ok: true });
      } catch (err) {
        sendResponse?.({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }
});
