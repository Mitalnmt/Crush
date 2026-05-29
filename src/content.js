(() => {
  /**
   * Coursera DOM thay đổi động: tick có thể xuất hiện bằng cách đổi class/attributes
   * (không nhất thiết thêm node mới). Vì vậy observer phải theo dõi cả `attributes`.
   */

  const SESSION_KEY = "hideCompletedEnabled";

  // Dấu hiệu "đã hoàn thành" (tick). Coursera có thể đổi markup theo thời gian,
  // nên dùng nhiều selector dự phòng.
  const COMPLETED_MARK_SELECTORS = [
    'svg[data-testid="learn-item-success-icon"]',
    '[data-testid="learn-item-success-icon"]',
    ".cds-icon-success",
    "svg.cds-icon-success",
  ];

  // Một số container hay gặp cho danh sách tuần/bài học.
  const LIST_CONTAINER_SELECTORS = [
    ".rc-WeekViewList",
    ".rc-NestedItem",
    '[role="main"]',
  ];

  const TOOL_PANEL_ID = "coursera-tool-panel";
  const TOOL_PANEL_TOGGLE_ID = "coursera-tool-panel-toggle";
  const FAST_QUIZ_STATUS_ID = "coursera-qlo-fast-quiz-status";
  const FAST_QUIZ_OVERLAY_ID = "coursera-qlo-fast-quiz-overlay";
  const PENDING_GRADE_CHECK_KEY = "qlo_pending_check_bai_lam";
  const ACTIVE_RUN_KEY = "qlo_active_run";
  const FAST_QUIZ_ENABLED_KEY = "qlo_fast_quiz_enabled";
  const FAST_QUIZ_LIST_URL_KEY = "qlo_fast_quiz_list_url";
  const FAST_QUIZ_AFTER_NHAY_KEY = "qlo_fast_quiz_after_nhay";
  const TOOL_PANEL_KEYMAP_STORAGE_KEY = "qlo_tool_panel_keymap";
  const MENU_HELP_ROW_ID = "coursera-qlo-menu-help";
  const QUIZ_ROW_ANSWERS_ID = "coursera-qlo-row-answers";
  const QUIZ_ROW_ACTIONS_ID = "coursera-qlo-row-actions";
  const QUIZ_ANSWERS_TEXTAREA_ID = "coursera-qlo-answers-textarea";
  const GEMINI_AUTO_STORAGE = "geminiAutoEnabled";
  const TOAST_ID = "coursera-qlo-toast";
  const TOAST_STACK_ID = "coursera-qlo-toast-stack";
  const SKIP_PROGRESS_TOAST_ID = "coursera-qlo-skip-progress";
  const GEMINI_WAIT_OVERLAY_ID = "coursera-qlo-gemini-overlay";
  const EXTENSION_ICON_PATH = "image/crush.png";

  let hideCompletedEnabled = false;
  const hiddenLis = new Set();
  let observer = null;
  let quizPageWatchTimer = null;
  let lastWatchedPathname = "";
  let activeRunId = "";
  let fastQuizStatusTimer = null;
  let fastQuizStatusRunId = "";
  let fastQuizStepText = "";
  let fastQuizStepStartedAt = 0;
  let fastQuizAdvancing = false;
  let toolPanelKeyListenerBound = false;
  let cachedToolKeymap = null;
  const panelActionHandlers = {};
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

  function getExtensionIconUrl() {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        return chrome.runtime.getURL(EXTENSION_ICON_PATH);
      }
    } catch {
      // ignore
    }
    return "";
  }

  function applyPanelToggleIcon(toggleBtn) {
    if (!toggleBtn) return;
    const iconUrl = getExtensionIconUrl();
    if (!iconUrl) return;
    toggleBtn.innerHTML = `<img class="qlo-panel-toggle-icon-img" src="${iconUrl}" alt="Crush" draggable="false" />`;
    const img = toggleBtn.querySelector(".qlo-panel-toggle-icon-img");
    img?.addEventListener("dragstart", (e) => e.preventDefault());
  }

  function getCompletedMarkSelector() {
    return COMPLETED_MARK_SELECTORS.join(", ");
  }

  function findObserveRoot() {
    for (const selector of LIST_CONTAINER_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return document.documentElement;
  }

  function isElement(node) {
    return node && node.nodeType === Node.ELEMENT_NODE;
  }

  function hasCompletedMark(el) {
    if (!el || !isElement(el)) return false;
    return !!el.querySelector(getCompletedMarkSelector());
  }

  function isCompletedLi(li) {
    if (!li || !isElement(li)) return false;
    return hasCompletedMark(li);
  }

  function hideLi(li) {
    if (!li || !isElement(li)) return;
    if (hiddenLis.has(li)) return;

    // Restore chính xác display inline nếu Coursera đang set trực tiếp.
    li.dataset.qloPrevDisplay = li.style.display;
    li.style.display = "none";
    hiddenLis.add(li);
  }

  function restoreLi(li) {
    if (!li || !isElement(li)) return;
    li.style.display = li.dataset.qloPrevDisplay ?? "";
    delete li.dataset.qloPrevDisplay;
    hiddenLis.delete(li);
  }

  function restoreAllHidden() {
    // Copy ra array để tránh mutate set khi lặp.
    Array.from(hiddenLis).forEach((li) => {
      if (!li || !li.isConnected) {
        hiddenLis.delete(li);
        return;
      }
      restoreLi(li);
    });
  }

  function applyHideCompletedToSubtree(root) {
    if (!root || !root.querySelectorAll) return;

    const lis = root.querySelectorAll("li");
    lis.forEach((li) => {
      if (!isElement(li)) return;
      if (hideCompletedEnabled && isCompletedLi(li)) {
        hideLi(li);
      } else if (!hideCompletedEnabled && hiddenLis.has(li)) {
        restoreLi(li);
      }
    });

    // Trường hợp root chính là <li>
    if (isElement(root) && root.tagName === "LI") {
      const li = root;
      if (hideCompletedEnabled && isCompletedLi(li)) hideLi(li);
      if (!hideCompletedEnabled && hiddenLis.has(li)) restoreLi(li);
    }
  }

  function applyHideCompletedFull() {
    if (hideCompletedEnabled) {
      applyHideCompletedToSubtree(document);
    } else {
      restoreAllHidden();
    }
  }

  // ==== CLB: Coursera locking browser bypass (content side) ====

  function injectClbPageHook() {
    try {
      if (!document.documentElement) return;
      if (document.getElementById("qlo-clb-page-hook")) return;

      const script = document.createElement("script");
      script.id = "qlo-clb-page-hook";
      script.src = chrome.runtime.getURL("src/script.js");
      script.async = false;
      (document.head || document.documentElement).appendChild(script);
    } catch {
      // ignore
    }
  }

  function isCourseraLockUrl(raw) {
    if (!raw) return false;
    const s = String(raw);
    return /^coursera-lock:\/\//i.test(s);
  }

  function convertCourseraLockUrl(raw) {
    try {
      if (!raw) return null;
      const replaced = String(raw).replace(/^coursera-lock:/i, "https:");
      const url = new URL(replaced);
      const token = url.searchParams.get("token") || "";
      if (token) url.searchParams.delete("token");
      return { redirectUrl: url.toString(), token };
    } catch {
      return null;
    }
  }

  function handleCourseraLockUrl(raw) {
    const converted = convertCourseraLockUrl(raw);
    if (!converted || !converted.redirectUrl) return;

    const payload = converted.token
      ? { action: "performTransfer", token: converted.token, redirectUrl: converted.redirectUrl }
      : { action: "openOnly", url: converted.redirectUrl };

    try {
      chrome.runtime.sendMessage(payload).catch(() => {
        // fallback: navigate in-page if background fails
        if (!converted.token) {
          window.location.href = converted.redirectUrl;
        }
      });
    } catch {
      if (!converted.token) {
        window.location.href = converted.redirectUrl;
      }
    }
  }

  function attachClbClickInterceptor() {
    document.addEventListener(
      "click",
      (event) => {
        try {
          const target = event.target;
          if (!target) return;

          let el = target;
          while (el && el !== document.body) {
            if (el.tagName === "A") break;
            el = el.parentElement;
          }
          if (!el || el.tagName !== "A") return;

          const href = el.getAttribute("href") || "";
          if (!isCourseraLockUrl(href)) return;

          event.preventDefault();
          event.stopPropagation();
          handleCourseraLockUrl(href);
        } catch {
          // ignore
        }
      },
      true
    );
  }

  function attachClbMutationObserver() {
    try {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== "childList") continue;
          mutation.addedNodes.forEach((node) => {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
            const root = /** @type {HTMLElement} */ (node);
            const anchors = root.matches("a[href^='coursera-lock://']")
              ? [root]
              : Array.from(root.querySelectorAll("a[href^='coursera-lock://']"));
            for (const a of anchors) {
              if (a.dataset.qloClbBound === "true") continue;
              a.dataset.qloClbBound = "true";
              a.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                handleCourseraLockUrl(a.getAttribute("href") || "");
              });
            }
          });
        }
      });

      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    } catch {
      // ignore
    }
  }

  function attachClbEventBridge() {
    try {
      window.addEventListener("BypassCoursera_Intercept", (ev) => {
        try {
          const detail = ev && /** @type {CustomEvent} */ (ev).detail;
          if (detail && isCourseraLockUrl(detail)) {
            handleCourseraLockUrl(detail);
          }
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  }

  async function clbHandleLockedStartPage() {
    try {
      if (!/coursera-locked-browser-start/i.test(window.location.href)) return;
      if (!document.body) return;
      document.body.style.visibility = "hidden";

      const tryFind = () => {
        const html = document.body.innerHTML || "";
        const match = html.match(/coursera-lock:\/\/[^\s"'<>]+/i);
        return match ? match[0] : "";
      };

      const maxTries = 10;
      for (let i = 0; i < maxTries; i += 1) {
        const url = tryFind();
        if (url) {
          handleCourseraLockUrl(url);
          return;
        }
        await sleep(500);
      }
      document.body.style.visibility = "";
    } catch {
      // ignore
    }
  }

  function isLockedStartPage() {
    return /coursera-locked-browser-start/i.test(window.location.href || "");
  }

  function observeMutations() {
    if (observer) return;

    const root = findObserveRoot();
    observer = new MutationObserver((mutations) => {
      // Khi tắt, vẫn giữ observer chạy nhưng chỉ cần "unhide" khi có item từng bị ẩn.
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node && node.nodeType === Node.ELEMENT_NODE) {
              applyHideCompletedToSubtree(node);
            }
          });
        } else if (mutation.type === "attributes") {
          const target = mutation.target;
          if (isElement(target)) {
            // Tick thường xuất hiện qua đổi class/attributes; re-check <li> gần nhất.
            const li = target.closest?.("li") || (target.tagName === "LI" ? target : null);
            if (li) applyHideCompletedToSubtree(li);
          }
        }
      }
    });

    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "data-current-item", "aria-checked", "data-testid"],
    });
  }

  function setHideCompletedEnabled(next) {
    hideCompletedEnabled = !!next;
    applyHideCompletedFull();
    observeMutations();
  }

  function ensureToastStack() {
    let stack = document.getElementById(TOAST_STACK_ID);
    if (stack) return stack;
    stack = document.createElement("div");
    stack.id = TOAST_STACK_ID;
    stack.style.position = "fixed";
    stack.style.right = "20px";
    stack.style.bottom = "20px";
    stack.style.zIndex = "10000";
    stack.style.maxWidth = "70vw";
    stack.style.display = "flex";
    stack.style.flexDirection = "column";
    stack.style.gap = "8px";
    stack.style.pointerEvents = "none";
    document.body.appendChild(stack);
    return stack;
  }

  function showToast(message, type = "info") {
    const text = String(message || "").trim();
    const stack = ensureToastStack();
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.textContent = text || "Đã có thông báo.";
    toast.style.padding = "10px 12px";
    toast.style.borderRadius = "10px";
    toast.style.background =
      type === "success" ? "rgba(34, 197, 94, 0.96)" : "rgba(17, 24, 39, 0.95)";
    toast.style.color = "#fff";
    toast.style.fontSize = "13px";
    toast.style.boxShadow = "0 10px 30px rgba(0,0,0,0.25)";
    toast.style.pointerEvents = "auto";
    toast.style.cursor = "pointer";
    toast.title = "Bấm để copy thông báo";

    toast.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text || "");
        toast.textContent = "Đã copy thông báo";
      } catch {
        // ignore
      }
    });

    stack.appendChild(toast);
    // giữ tối đa 6 toast để không đầy màn hình
    while (stack.children.length > 6) {
      stack.firstChild?.remove?.();
    }
    const timeout = /lỗi|error|fail/i.test(text) ? 8000 : 4500;
    window.setTimeout(() => toast.remove(), timeout);
  }

  function setFastQuizWaitStatus(message = "", type = "idle") {
    const el = document.getElementById(FAST_QUIZ_STATUS_ID);
    const text = String(message || "").trim();
    if (el) {
      if (!text) {
        el.textContent = "";
        el.classList.add("qlo-hidden");
      } else {
        el.textContent = text;
        el.classList.remove("qlo-hidden");
        el.dataset.state = type;
      }
    }
    updateFastQuizOverlayStatus(text, type);
  }

  function ensureFastQuizOverlay() {
    let overlay = document.getElementById(FAST_QUIZ_OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = FAST_QUIZ_OVERLAY_ID;
    overlay.className = "qlo-hidden";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "10020";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "rgba(15, 23, 42, 0.28)";

    const panel = document.createElement("div");
    panel.className = "qlo-fast-quiz-panel";

    const title = document.createElement("div");
    title.className = "qlo-fast-quiz-title";
    title.textContent = "Fast Quiz đang chạy";

    const status = document.createElement("div");
    status.id = `${FAST_QUIZ_OVERLAY_ID}-status`;
    status.className = "qlo-fast-quiz-status";
    status.textContent = "Đang khởi động...";

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "qlo-fast-quiz-stop";
    stopBtn.textContent = "Dừng";
    stopBtn.addEventListener("click", () => {
      setFastQuizEnabled(false);
      cancelRun("user stop");
    });

    panel.appendChild(title);
    panel.appendChild(status);
    panel.appendChild(stopBtn);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    return overlay;
  }

  function showFastQuizOverlay() {
    if (!isFastQuizEnabled()) return;
    const overlay = ensureFastQuizOverlay();
    overlay.classList.remove("qlo-hidden");
    overlay.style.display = "flex";
  }

  function hideFastQuizOverlay() {
    const overlay = document.getElementById(FAST_QUIZ_OVERLAY_ID);
    if (!overlay) return;
    overlay.style.display = "none";
    overlay.classList.add("qlo-hidden");
  }

  function updateFastQuizOverlayStatus(message = "", type = "idle") {
    if (!isFastQuizEnabled()) return;
    const text = String(message || "").trim();
    if (!text) return;
    const overlay = ensureFastQuizOverlay();
    overlay.classList.remove("qlo-hidden");
    overlay.style.display = "flex";
    const panel = overlay.querySelector(".qlo-fast-quiz-panel");
    const status = document.getElementById(`${FAST_QUIZ_OVERLAY_ID}-status`);
    if (status) {
      status.textContent = text.replace(/^Fast Quiz:\s*/i, "");
    }
    if (panel) panel.dataset.state = type || "waiting";
  }

  function setPanelLoading(visible) {
    const loaderEl = document.getElementById("coursera-qlo-loader");
    if (!loaderEl) return;
    loaderEl.classList.toggle("qlo-hidden", !visible);
  }

  function forceHideGeminiOverlay() {
    try {
      const overlay = document.getElementById(GEMINI_WAIT_OVERLAY_ID);
      if (overlay) overlay.remove();
    } catch {
      // ignore
    }
    // fallback: ensure it is hidden if recreated later
    setGeminiWaitOverlay(false);
  }

  function startRun(kind) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    activeRunId = id;
    try {
      sessionStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify({ id, kind, href: location.href }));
    } catch {
      // ignore
    }
    return id;
  }

  function getStoredRun() {
    try {
      const raw = sessionStorage.getItem(ACTIVE_RUN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.id ? parsed : null;
    } catch {
      return null;
    }
  }

  function isRunActive(runId) {
    if (!runId) return false;
    if (activeRunId && runId !== activeRunId) return false;
    const stored = getStoredRun();
    return !!(stored && stored.id === runId);
  }

  function cancelRun(reason = "") {
    activeRunId = "";
    fastQuizAdvancing = false;
    try {
      sessionStorage.removeItem(ACTIVE_RUN_KEY);
      sessionStorage.removeItem(PENDING_GRADE_CHECK_KEY);
      sessionStorage.removeItem("qlo_fast_quiz_pending_check");
      sessionStorage.removeItem(FAST_QUIZ_AFTER_NHAY_KEY);
      sessionStorage.removeItem(FAST_QUIZ_LIST_URL_KEY);
    } catch {
      // ignore
    }
    setPanelLoading(false);
    forceHideGeminiOverlay();
    hideFastQuizOverlay();
    setFastQuizWaitStatus(reason ? `Fast Quiz: dừng (${reason})` : "", "idle");
    if (fastQuizStatusTimer) {
      window.clearInterval(fastQuizStatusTimer);
      fastQuizStatusTimer = null;
      fastQuizStatusRunId = "";
    }
  }

  function cleanupStaleUi() {
    // Nếu bị kẹt overlay/loading do điều hướng/reload, luôn dọn để không "treo giả".
    forceHideGeminiOverlay();
    setPanelLoading(false);
  }

  function urlHasAttempt(href = location.href) {
    const raw = String(href || "").toLowerCase();
    return raw.includes("/attempt") || /[?&]attempt=/i.test(raw);
  }

  /**
   * Sau nộp bài Coursera thường chuyển URL từ .../attempt... sang trang không còn attempt.
   * Chỉ bắt đầu đếm ngược khi URL đã mất attempt.
   */
  async function waitForAttemptUrlGone(runId, timeoutMs = 120000) {
    if (!urlHasAttempt()) return true;

    setFastQuizStep("đang đợi URL mất attempt sau khi nộp...");
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (!isRunActive(runId) || !isFastQuizEnabled()) return false;
      if (!urlHasAttempt()) return true;

      const leftSec = Math.max(0, Math.ceil((timeoutMs - (Date.now() - startedAt)) / 1000));
      setFastQuizStep(`đang đợi URL mất attempt... (~${leftSec}s)`);
      await sleep(400);
    }
    return !urlHasAttempt();
  }

  async function waitFastQuizCountdown(runId, totalSeconds = 4) {
    for (let left = totalSeconds; left >= 1; left--) {
      if (!isRunActive(runId) || !isFastQuizEnabled()) return false;
      setFastQuizStep(`đã nộp xong — chờ ${left}s rồi chuyển bài tiếp...`);
      setFastQuizWaitStatus(
        `Fast Quiz: đã nộp xong — chờ ${left}s rồi chuyển bài tiếp...`,
        "success"
      );
      await sleep(1000);
    }
    return isRunActive(runId) && isFastQuizEnabled();
  }

  async function advanceFastQuizAfterSubmit(runId) {
    if (!runId || fastQuizAdvancing) return;
    fastQuizAdvancing = true;
    try {
      if (!isRunActive(runId) || !isFastQuizEnabled()) return;
      setPanelLoading(false);
      showToast("Đã submit. Đang đợi URL mất attempt rồi đếm 4s...", "success");

      const attemptGone = await waitForAttemptUrlGone(runId);
      if (!attemptGone) {
        showToast("Chưa thấy URL mất attempt. Vẫn thử chuyển bài tiếp...");
      }

      const waited = await waitFastQuizCountdown(runId, 4);
      if (!waited) return;

      setFastQuizStep("đang nhảy tới bài tiếp theo...");
      const listPrep = await ensureAssignmentListForNhay(runId);
      if (listPrep?.navigated) return;
      await runFastQuizCycle(runId);
    } catch {
      // ignore
    } finally {
      fastQuizAdvancing = false;
    }
  }

  async function startFastQuizRun() {
    try {
      sessionStorage.removeItem("qlo_fast_quiz_pending_check");
    } catch {
      // ignore
    }
    setFastQuizEnabled(true);
    showFastQuizOverlay();
    const runId = startRun("fast_quiz");
    await runFastQuizCycle(runId);
  }

  function isFastQuizEnabled() {
    try {
      return sessionStorage.getItem(FAST_QUIZ_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setFastQuizEnabled(enabled) {
    try {
      if (enabled) sessionStorage.setItem(FAST_QUIZ_ENABLED_KEY, "1");
      else sessionStorage.removeItem(FAST_QUIZ_ENABLED_KEY);
    } catch {
      // ignore
    }
  }

  function setFastQuizStep(stepText) {
    fastQuizStepText = String(stepText || "").trim();
    fastQuizStepStartedAt = Date.now();
    if (!fastQuizStepText) return;
    setFastQuizWaitStatus(`Fast Quiz: ${fastQuizStepText}`, "waiting");
  }

  function startFastQuizRealtimeStatus(runId) {
    if (!runId) return;
    if (fastQuizStatusTimer && fastQuizStatusRunId === runId) return;
    if (fastQuizStatusTimer) window.clearInterval(fastQuizStatusTimer);
    fastQuizStatusRunId = runId;
    if (!fastQuizStepStartedAt) fastQuizStepStartedAt = Date.now();
    fastQuizStatusTimer = window.setInterval(() => {
      try {
        if (!isRunActive(runId)) return;
        const seconds = Math.max(0, Math.floor((Date.now() - (fastQuizStepStartedAt || Date.now())) / 1000));
        const base = fastQuizStepText ? `Fast Quiz: ${fastQuizStepText}` : "Fast Quiz: đang chạy...";
        setFastQuizWaitStatus(`${base} (${seconds}s)`, "waiting");
      } catch {
        // ignore
      }
    }, 1000);
  }

  function consumeFastQuizAfterNhayFlag() {
    try {
      const on = sessionStorage.getItem(FAST_QUIZ_AFTER_NHAY_KEY) === "1";
      if (on) {
        sessionStorage.removeItem(FAST_QUIZ_AFTER_NHAY_KEY);
        sessionStorage.removeItem("qlo_fast_quiz_pending_check");
      }
      return on;
    } catch {
      return false;
    }
  }

  async function runFastQuizCycle(runId) {
    if (!isRunActive(runId) || !isFastQuizEnabled()) return false;
    showFastQuizOverlay();
    startFastQuizRealtimeStatus(runId);

    const resumeAfterNhay = consumeFastQuizAfterNhayFlag();

    if (!resumeAfterNhay) {
      setFastQuizStep("đang tìm bài chưa done...");
      const jumped = await nhay_bai_chua_done();
      if (!jumped?.ok) return false;
      if (jumped.navigated) return true;
    } else {
      setFastQuizStep("đã nhảy tới bài — đang đợi Start + no-grade...");
    }

    const checked = await check_nhay_bai_chua_done(runId);
    if (!checked?.ok) return false;

    setFastQuizStep("đã check OK, đợi 1s rồi chạy Quiz...");
    await sleep(1000);
    setFastQuizStep("đang chạy Quiz (GMN/Paste/Submit)...");
    const quizOk = await runQuizFeaturesFlow(runId);
    if (!quizOk) return false;
    await advanceFastQuizAfterSubmit(runId);
    return true;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function clickUnderstandIfNeeded() {
    // Coursera sometimes shows guidelines modal/button.
    const btn = document.querySelector('[data-action="acknowledge-guidelines"]');
    if (!btn) return false;

    const rect = btn.getBoundingClientRect?.();
    const visible = rect && rect.width > 0 && rect.height > 0;
    if (!visible) return false;

    try {
      btn.click();
      await sleep(500);
      return true;
    } catch {
      return false;
    }
  }

  function answersLetterToIndex(letter) {
    const l = String(letter || "").toLowerCase();
    if (l.length !== 1 || l < "a" || l > "z") return -1;
    return l.charCodeAt(0) - "a".charCodeAt(0);
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

  function parseAnswerEntry(answerPart) {
    const raw = String(answerPart || "").trim();
    if (!raw) return null;

    const answers = parseLetterAnswers(raw);
    if (answers.length > 0) {
      return { answers, text: "" };
    }

    // Fallback cho câu điền text/rich text.
    return { answers: [], text: raw };
  }

  function parseQuizAnswers(text) {
    const byIndex = new Map();
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      let questionIndex = null;
      let answerPart = "";

      const standard = line.match(/^\s*(\d+)\s*[.)]?\s*(.*)$/i);
      const vietnamese = line.match(/^\s*câu\s*(\d+)\s*[:.)-]?\s*(.*)$/i);

      if (standard) {
        questionIndex = Number(standard[1]);
        answerPart = standard[2];
      } else if (vietnamese) {
        questionIndex = Number(vietnamese[1]);
        answerPart = vietnamese[2];
      }

      if (!Number.isFinite(questionIndex) || questionIndex <= 0) continue;

      const parsed = parseAnswerEntry(answerPart);
      if (!parsed) continue;

      byIndex.set(questionIndex, {
        questionIndex,
        answers: parsed.answers,
        text: parsed.text,
      });
    }

    return Array.from(byIndex.values()).sort((a, b) => a.questionIndex - b.questionIndex);
  }

  function countParsedAnswers(text) {
    return parseQuizAnswers(text).length;
  }

  function sortByDocumentOrder(elements) {
    return elements.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function isVisibleElement(el) {
    if (!el || !isElement(el) || !el.isConnected) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function isInToolPanel(el) {
    const panel = document.getElementById(TOOL_PANEL_ID);
    return !!(panel && el && panel.contains(el));
  }

  /** Chỉ nhóm câu hỏi quiz thật (Coursera testid), tránh nhận nhầm UI khác. */
  function findQuizQuestionGroupsStrict() {
    const found = new Set();
    const stableSelectors = [
      'div[role="group"][data-testid*="MultipleChoiceQuestion"]',
      'div[role="group"][data-testid*="CheckboxQuestion"]',
      'div[role="group"][data-testid*="RichTextQuestion"]',
    ];

    for (const selector of stableSelectors) {
      document.querySelectorAll(selector).forEach((el) => found.add(el));
    }

    return sortByDocumentOrder(Array.from(found));
  }

  function findAllQuestionGroups() {
    const strict = findQuizQuestionGroupsStrict();
    if (strict.length > 0) return strict;

    const found = new Set();
      document.querySelectorAll('div[role="group"]').forEach((group) => {
      if (group.querySelector("#agreement-checkbox-base")) return;
        const hasRadio =
          group.querySelector('input[type="radio"], div[role="radiogroup"], [role="radiogroup"]');
        const hasCheckbox = group.querySelector('input[type="checkbox"]');
        const hasRichText =
          group.querySelector('[role="textbox"][contenteditable="true"]') ||
          group.querySelector(".rc-CMLEditor");
        if (hasRadio || hasCheckbox || hasRichText) found.add(group);
      });

    return sortByDocumentOrder(Array.from(found));
  }

  function getQuestionType(group) {
    if (group.querySelector('[role="textbox"][contenteditable="true"]') || group.querySelector(".rc-CMLEditor")) {
      return "richtext";
    }
    if (group.querySelector('input[type="checkbox"]')) return "checkbox";
    if (
      group.querySelector(
        'input[type="radio"], div[role="radiogroup"], [role="radiogroup"]'
      )
    ) {
      return "radio";
    }
    return "unknown";
  }

  function findOptionsInGroup(group, type) {
    const container =
      group.querySelector('div[role="radiogroup"], [role="radiogroup"]') || group;

    if (type === "checkbox") {
      let labels = Array.from(container.querySelectorAll("label")).filter((el) =>
        el.querySelector('input[type="checkbox"]')
      );
      if (labels.length > 0) return labels;

      const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
      if (checkboxes.length > 0) return checkboxes;

      return Array.from(container.querySelectorAll(".rc-Option, [role='checkbox']"));
    }

    // Radio (chọn một)
    let labels = Array.from(container.querySelectorAll("label")).filter(
      (el) =>
        el.querySelector('input[type="radio"]') || el.getAttribute("role") === "radio"
    );
    if (labels.length > 0) return labels;

    const roleRadios = Array.from(container.querySelectorAll('[role="radio"]'));
    if (roleRadios.length > 0) return roleRadios;

    return Array.from(container.querySelectorAll('input[type="radio"]'));
  }

  function clickOption(optionEl) {
    if (!optionEl) return false;

    if (optionEl.tagName === "INPUT") {
      const label = optionEl.closest("label");
      if (label) {
        label.click();
        return true;
      }
      optionEl.click();
      return true;
    }

    optionEl.click();
    return true;
  }

  function buildAnswersLookup(answersMap) {
    const lookup = new Map();
    if (!Array.isArray(answersMap)) return lookup;

    for (const entry of answersMap) {
      if (!entry || !Number.isFinite(entry.questionIndex)) continue;
      const hasLetters = Array.isArray(entry.answers) && entry.answers.length > 0;
      const hasText = !!String(entry.text || "").trim();
      if (!hasLetters && !hasText) continue;
      lookup.set(entry.questionIndex, {
        answers: Array.isArray(entry.answers) ? entry.answers : [],
        text: String(entry.text || ""),
      });
    }
    return lookup;
  }

  function fillRichTextQuestion(group, textValue) {
    const value = String(textValue || "").trim();
    if (!value) return false;

    const editor =
      group.querySelector('[role="textbox"][contenteditable="true"]') ||
      group.querySelector('.rc-CMLEditor [contenteditable="true"]');
    if (!editor) return false;

    editor.focus();
    try {
      editor.textContent = value;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  function fillOneQuestion(group, entry, type) {
    const answers = Array.isArray(entry?.answers) ? entry.answers : [];
    const text = String(entry?.text || "").trim();

    if (type === "richtext") {
      return fillRichTextQuestion(group, text);
    }

    const options = findOptionsInGroup(group, type);
    if (!options || options.length === 0) return false;

    if (type === "radio") {
      const idx = answersLetterToIndex(answers[0]);
      if (idx < 0 || idx >= options.length) {
        console.warn(`[QLO] Radio: option index ${idx} out of range (${options.length})`);
        return false;
      }
      return clickOption(options[idx]);
    }

    if (type === "checkbox") {
      let clickedAny = false;
      for (const letter of answers) {
        const idx = answersLetterToIndex(letter);
        if (idx < 0 || idx >= options.length) {
          console.warn(`[QLO] Checkbox: option index ${idx} out of range (${options.length})`);
          continue;
        }
        if (clickOption(options[idx])) clickedAny = true;
      }
      return clickedAny;
    }

    return false;
  }

  async function fillQuizAnswers(payload) {
    const answersMap = payload?.answersMap;
    const lookup = buildAnswersLookup(answersMap);

    if (lookup.size === 0) {
      showToast("Không có đáp án để điền.");
      return;
    }

    await clickUnderstandIfNeeded();

    const groups = findAllQuestionGroups();
    if (groups.length === 0) {
      showToast("Không tìm thấy quiz trên trang này.");
      return;
    }

    const totalWithAnswers = lookup.size;
    let filled = 0;

    for (let i = 0; i < groups.length; i += 1) {
      const questionIndex = i + 1;
      const entry = lookup.get(questionIndex);
      if (!entry) continue;

      const group = groups[i];
      const type = getQuestionType(group);
      if (type === "unknown") continue;

      try {
        if (fillOneQuestion(group, entry, type)) filled += 1;
      } catch {
        // Bỏ qua lỗi từng câu.
      }
    }

    if (filled === 0) {
      showToast("Không điền được đáp án nào (có thể quiz khác cấu trúc).");
      return;
    }

    showToast(`Đã điền ${filled}/${totalWithAnswers} câu hỏi`);
  }

  function extractOptionText(opt) {
    if (!opt) return "";
    if (opt.tagName === "LABEL") return opt.innerText.trim();
    if (opt.tagName === "INPUT") {
      const label = opt.closest("label");
      return label ? label.innerText.trim() : String(opt.value || "").trim();
    }
    return opt.innerText.trim();
  }

  function getExpectedQuestionCountFromPage() {
    const bodyText = String(document.body?.innerText || "");
    const patterns = [
      /question\s*\d+\s*of\s*(\d+)/i,
      /câu\s*\d+\s*\/\s*(\d+)/i,
      /(\d+)\s*\/\s*(\d+)\s*(?:questions?|câu)/i,
      /of\s*(\d+)\s*questions?/i,
    ];

    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (!match) continue;
      const total = Number(match[match.length - 1]);
      if (Number.isFinite(total) && total > 0) return total;
    }
    return null;
  }

  function findQuizNextButton() {
    const scope = document.querySelector('[role="main"]') || document.body;
    const byTestId = scope.querySelector(
      'button[data-testid*="next"], button[data-testid*="Next"]'
    );
    if (byTestId && isVisibleElement(byTestId) && !isInToolPanel(byTestId)) return byTestId;

    const buttons = Array.from(scope.querySelectorAll("button"));
    return (
      buttons.find((btn) => {
        if (isInToolPanel(btn) || !isVisibleElement(btn) || btn.disabled) return false;
        const text = String(btn.textContent || btn.innerText || "").trim().toLowerCase();
        return text === "next" || text.startsWith("next ");
      }) || null
    );
  }

  async function ensureAllQuestionsLoaded() {
    const scrollRoot =
      document.querySelector('[role="main"]') ||
      document.scrollingElement ||
      document.documentElement;

    let lastCount = 0;
    let stableRounds = 0;

    for (let round = 0; round < 20; round += 1) {
      const groups = findAllQuestionGroups();
      if (groups.length > lastCount) {
        lastCount = groups.length;
        stableRounds = 0;
        groups[groups.length - 1]?.scrollIntoView?.({ behavior: "instant", block: "center" });
        await sleep(350);
      } else {
        stableRounds += 1;
      }

      const nextBtn = findQuizNextButton();
      if (nextBtn) {
        nextBtn.click();
        await sleep(700);
        stableRounds = 0;
        continue;
      }

      scrollRoot.scrollTop = scrollRoot.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(350);

      if (stableRounds >= 3) break;
    }

    return findAllQuestionGroups().length;
  }

  function extractFullQuizContent() {
    const groups = findAllQuestionGroups();
    const quizData = [];

    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];

      let questionText = "";
      const cmlDiv = group.querySelector(".rc-CML");
      if (cmlDiv) {
        questionText = cmlDiv.innerText.trim();
      } else {
        const clone = group.cloneNode(true);
        clone
          .querySelectorAll('.rc-Option, [role="radio"], [role="checkbox"]')
          .forEach((el) => el.remove());
        questionText = clone.innerText.trim();
      }

      // Gửi luôn link ảnh (nếu có) để Gemini hiểu được biểu đồ/hình minh họa.
      const imgs = Array.from(group.querySelectorAll("img"))
        .map((img) => img.getAttribute("src") || "")
        .filter((src) => !!src);
      if (imgs.length > 0) {
        const uniqueImgs = Array.from(new Set(imgs));
        const imgLines = uniqueImgs
          .slice(0, 3)
          .map((src, idx) => `[Image ${idx + 1}]: ${src}`)
          .join("\n");
        questionText = questionText
          ? `${questionText}\n${imgLines}`
          : imgLines;
      }

      const type = getQuestionType(group);
      const optionsElements = findOptionsInGroup(group, type);
      const options = [];

      for (const opt of optionsElements) {
        const text = extractOptionText(opt);
        if (text) options.push(text);
      }

      if (questionText && options.length > 0) {
        quizData.push({ questionText, options });
      }
    }

    return quizData;
  }

  function getItemPrimaryLink(li) {
    if (!li || !isElement(li)) return null;

    // Coursera thường có link chính nằm trong <a>. Ưu tiên link có href.
    const anchor = li.querySelector('a[href]');
    return anchor || null;
  }

  function getVisibleLessonLis() {
    // Lọc những <li> có vẻ là item trong danh sách bài (heuristic: có <a> bên trong).
    const all = Array.from(document.querySelectorAll("li"));
    return all.filter((li) => {
      if (!isElement(li)) return false;
      if (!li.isConnected) return false;
      if (li.style.display === "none") return false;
      return !!li.querySelector("a, button");
    });
  }

  function findFirstIncompleteItem() {
    const lis = getVisibleLessonLis();
    for (const li of lis) {
      if (!isCompletedLi(li)) return li;
    }
    return null;
  }

  function jumpToIncomplete() {
    const allLis = getVisibleLessonLis();
    const incomplete = findFirstIncompleteItem();

    if (!incomplete) {
      if (allLis.length === 0) {
        showToast("Không tìm thấy danh sách bài học trên trang này.");
        return;
      }

      // Tối thiểu: chỉ tìm trong DOM hiện có. Nếu Coursera lazy-load thêm, nhắc user cuộn.
      // Nếu tất cả các item hiện có đều có tick -> chúc mừng.
      const anyCompleted = allLis.some((li) => isCompletedLi(li));
      if (anyCompleted) {
        showToast("Chúc mừng! Bạn đã hoàn thành tất cả bài học.");
      } else {
        showToast("Chưa thấy bài chưa làm. Hãy cuộn xuống để tải thêm bài.");
      }
      return;
    }

    incomplete.scrollIntoView({ behavior: "smooth", block: "center" });

    // Click link chính để nhảy vào bài học.
    const link = getItemPrimaryLink(incomplete);
    if (link) {
      window.setTimeout(() => link.click(), 250);
      return;
    }

    // Fallback: click trực tiếp vào li nếu không tìm được anchor.
    window.setTimeout(() => incomplete.click(), 250);
  }

  function formatQuizForClipboard(quizData) {
    let output = "";
    for (let i = 0; i < quizData.length; i += 1) {
      const q = quizData[i];
      output += `Câu ${i + 1}: ${q.questionText}\n`;
      for (let optIdx = 0; optIdx < q.options.length; optIdx += 1) {
        const letter =
          optIdx < 26 ? String.fromCharCode(65 + optIdx) : `Opt${optIdx + 1}`;
        output += `${letter}. ${q.options[optIdx]}\n`;
      }
      output += "\n";
    }
    return output;
  }

  function findAgreementCheckbox() {
    const byId = document.querySelector(
      'input#agreement-checkbox-base[type="checkbox"], input#agreement-checkbox-base'
    );
    if (byId && byId.type === "checkbox") return byId;

    const byTestId = document.querySelector(
      'input[type="checkbox"][data-testid*="agreement"], input[type="checkbox"][data-testid*="Agreement"]'
    );
    if (byTestId) return byTestId;

    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    for (const cb of checkboxes) {
      const labelText = (
        cb.closest("label")?.innerText ||
        cb.getAttribute("aria-label") ||
        cb.parentElement?.innerText ||
        ""
      ).toLowerCase();
      if (labelText.includes("understand") && labelText.includes("agree")) return cb;
    }

    const labels = Array.from(document.querySelectorAll("label"));
    for (const label of labels) {
      const text = String(label.innerText || "").toLowerCase();
      if (!text.includes("understand") || !text.includes("agree")) continue;
      const cb = label.querySelector('input[type="checkbox"], [role="checkbox"]');
      if (cb) return cb;
    }

    const roleCheckboxes = Array.from(document.querySelectorAll('[role="checkbox"]'));
    for (const el of roleCheckboxes) {
      const text = (
        el.getAttribute("aria-label") ||
        el.closest("label")?.innerText ||
        el.parentElement?.innerText ||
        ""
      ).toLowerCase();
      if (text.includes("understand") && text.includes("agree")) return el;
    }

    return null;
  }

  function isAgreementChecked(el) {
    if (!el) return true;
    if (el.type === "checkbox") return !!el.checked;
    if (el.getAttribute?.("role") === "checkbox") {
      return el.getAttribute("aria-checked") === "true";
    }
    return false;
  }

  async function tickAgreementIfNeeded() {
    const target = findAgreementCheckbox();
    if (!target) return true;
    if (isAgreementChecked(target)) return true;

    try {
      target.click();
      await sleep(250);
      if (isAgreementChecked(target)) return true;

      const label = target.closest("label");
      if (label) {
        label.click();
        await sleep(250);
      }
      if (isAgreementChecked(target)) return true;

      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await sleep(250);
      return isAgreementChecked(target);
    } catch {
      return false;
    }
  }

  /** Tick ô agree — thử lại vì DOM Coursera có thể render chậm sau khi fill đáp án. */
  async function tickAgreementWithRetry(timeoutMs = 10000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await tickAgreementIfNeeded();
      const cb = findAgreementCheckbox();
      if (!cb || isAgreementChecked(cb)) return true;
      await sleep(350);
    }
    const cb = findAgreementCheckbox();
    return !cb || isAgreementChecked(cb);
  }

  function isSubmitButtonReady(btn) {
    if (!btn || !btn.isConnected) return false;
    if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return false;
    const rect = btn.getBoundingClientRect?.();
    return !!(rect && rect.width > 0 && rect.height > 0);
  }

  async function waitForSubmitButton(timeoutMs = 12000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const btn = findSubmitButton();
      if (isSubmitButtonReady(btn)) return btn;
      await sleep(250);
    }
    return null;
  }

  /** Trang chủ / danh sách tuần (không phải màn làm quiz). */
  function isCourseHomeLikePage() {
    const path = location?.pathname || "";
    if (/\/home\//.test(path) || /\/learn\/[^/]+\/home/.test(path)) return true;
    if (path.includes("/assignment-submission/")) return false;
    if (/\/week\/\d+/i.test(path)) return true;
    return false;
  }

  /** Màn cover: có nút Start, chưa có câu hỏi quiz. */
  function isQuizCoverPage() {
    const startBtn = findStartButton();
    if (!startBtn || !isVisibleElement(startBtn)) return false;
    return findQuizQuestionGroupsStrict().length === 0;
  }

  /**
   * Đang ở màn làm bài: có câu hỏi quiz (testid) hoặc Submit trên trang assignment.
   */
  function isQuizWorkingPage() {
    if (isCourseHomeLikePage()) return false;
    if (isQuizCoverPage()) return false;

    if (findQuizQuestionGroupsStrict().length > 0) return true;

    const path = location?.pathname || "";
    if (path.includes("/assignment-submission/")) {
      const submitBtn = findSubmitButton();
      if (submitBtn && isVisibleElement(submitBtn)) return true;
    }

    return false;
  }

  async function waitForQuizWorkingPage(timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (isQuizWorkingPage()) return true;
      await sleep(300);
    }
    return false;
  }

  function updateQuizEntryRowsVisibility() {
    const row2 = document.getElementById(QUIZ_ROW_ANSWERS_ID);
    const row3 = document.getElementById(QUIZ_ROW_ACTIONS_ID);
    if (!row2 || !row3) return;

    if (isQuizWorkingPage()) {
      row2.classList.remove("qlo-hidden");
      row3.classList.remove("qlo-hidden");
    } else {
      row2.classList.add("qlo-hidden");
      row3.classList.add("qlo-hidden");
    }
  }

  function watchQuizPageNavigation() {
    if (quizPageWatchTimer) return;

    lastWatchedPathname = location.pathname;

    const check = () => {
      if (location.pathname !== lastWatchedPathname) {
        lastWatchedPathname = location.pathname;
      }
      updateQuizEntryRowsVisibility();
    };

    window.addEventListener("popstate", check);
    window.addEventListener("hashchange", check);

    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function pushStateWrapper(...args) {
      origPushState.apply(this, args);
      check();
    };
    history.replaceState = function replaceStateWrapper(...args) {
      origReplaceState.apply(this, args);
      check();
    };

    quizPageWatchTimer = window.setInterval(check, 800);
  }

  function findStartButton() {
    const byTestId = document.querySelector('button[data-testid="CoverPageActionButton"]');
    if (byTestId && isVisibleElement(byTestId) && !isInToolPanel(byTestId)) {
      return byTestId;
    }

    const scope = document.querySelector('[role="main"]') || document.body;
    const buttons = Array.from(scope.querySelectorAll("button"));
    return (
      buttons.find((b) => {
        if (isInToolPanel(b) || !isVisibleElement(b)) return false;
        const text = String(b.textContent || "").trim();
        return /^start$/i.test(text) || /^start\s+quiz$/i.test(text);
      }) || null
    );
  }

  /**
   * Quiz: vào bài (Start) nếu chưa ở màn làm bài; nếu đã ở màn làm bài thì chỉ copy.
   * Tick ô agree chuyển sang nút Paste (trước khi Submit).
   */
  async function handleQuizButton() {
    if (isCourseHomeLikePage()) {
      showToast("Hãy mở bài quiz (có nút Start) trước khi bấm Quiz.");
      return false;
    }

    if (isQuizGradeConfirmed(document)) {
      showToast("Bài quiz đã có điểm, bỏ qua.");
      return false;
    }

    if (!isQuizWorkingPage()) {
      const startBtn = findStartButton();
      if (!startBtn) {
        showToast("Không thấy nút Start. Mở đúng trang bài quiz (màn cover) rồi thử lại.");
        return false;
      }

      startBtn.click();
      const entered = await waitForQuizWorkingPage(15000);
      if (!entered) {
        showToast("Chưa vào được màn làm bài. Hãy bấm Start thủ công rồi thử lại.");
        return false;
      }
    }

    await ensureAllQuestionsLoaded();

    const quizData = extractFullQuizContent();
    if (!Array.isArray(quizData) || quizData.length === 0) {
      showToast("Không tìm thấy nội dung quiz để copy.");
      return false;
    }

    const expectedFromPage = getExpectedQuestionCountFromPage();
    if (expectedFromPage && quizData.length < expectedFromPage) {
      showToast(
        `Chỉ đọc được ${quizData.length}/${expectedFromPage} câu. Cuộn hết quiz rồi bấm Quiz lại.`
      );
    }

    const formatted = formatQuizForClipboard(quizData);
    try {
      await navigator.clipboard.writeText(formatted);
      showToast(`Đã copy ${quizData.length} câu quiz vào clipboard`);
      return true;
    } catch {
      showToast("Không thể copy quiz vào clipboard. Hãy thử lại.");
      return false;
    }
  }

  function findSubmitButton() {
    const byTestId = document.querySelector('button[data-testid="submit-button"]');
    if (byTestId && !isInToolPanel(byTestId)) return byTestId;

    const scope = document.querySelector('[role="main"]') || document.body;
    const buttons = Array.from(scope.querySelectorAll("button"));
    return (
      buttons.find((b) => {
        if (isInToolPanel(b) || !isVisibleElement(b)) return false;
        const text = String(b.innerText || b.textContent || "").trim().toLowerCase();
        return text === "submit" || text.startsWith("submit ");
      }) || null
    );
  }

  function findDialogSubmitButton() {
    const byTestId = document.querySelector('button[data-testid="dialog-submit-button"]');
    if (byTestId && isVisibleElement(byTestId)) return byTestId;

    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
    for (const dialog of dialogs) {
      const buttons = Array.from(dialog.querySelectorAll("button"));
      const match = buttons.find((b) => {
        if (!isVisibleElement(b)) return false;
        return String(b.innerText || "").toLowerCase().includes("submit");
      });
      if (match) return match;
    }

    return null;
  }

  function getVisibleSubmitDialog() {
    const dialogs = Array.from(document.querySelectorAll('[role="alertdialog"], [role="dialog"]'));
    return (
      dialogs.find((dialog) => {
        if (!isVisibleElement(dialog)) return false;
        const text = String(dialog.textContent || "").toLowerCase();
        if (!text.includes("submit")) return false;
        return !!dialog.querySelector("button");
      }) || null
    );
  }

  function isSubmitDialogOpen() {
    return !!getVisibleSubmitDialog();
  }

  function safeClick(el) {
    if (!el) return false;
    try {
      el.click();
      return true;
    } catch {
      try {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch {
        return false;
      }
    }
  }

  async function setGeminiAutoEnabled(enabled) {
    try {
      await chrome.storage.local.set({ [GEMINI_AUTO_STORAGE]: !!enabled });
    } catch {
      // ignore
    }
  }

  function getAbsoluteHref(href) {
    try {
      return new URL(href, location.origin).toString();
    } catch {
      return "";
    }
  }

  function isLockedCourseCard(el) {
    const card = el?.closest?.("li, [data-testid], [class]") || el;
    if (!card) return false;
    const text = String(card.textContent || "").toLowerCase();
    if (text.includes("locked") || text.includes("khóa")) return true;
    if (card.querySelector('[data-testid*="lock"], [aria-label*="lock" i], [class*="lock" i]')) {
      return true;
    }
    return false;
  }

  function isCompletedCourseCard(el) {
    const li = el?.closest?.("li");
    if (!li) return false;
    if (isCompletedLi(li)) return true;

    const txt = String(li.textContent || "").toLowerCase();
    if (
      txt.includes("retake") ||
      txt.includes("review") ||
      txt.includes("view feedback") ||
      txt.includes("đã hoàn thành")
    ) {
      return true;
    }
    return false;
  }

  /** Bài đã nộp trên trang assignment (dùng cho Quiz/Start, không phải Fast Quiz list). */
  function isQuizGradeConfirmed(scope = document) {
    const root = scope?.querySelector?.('[data-testid="cover-page-row"]') || scope;
    const earned = root.querySelector?.('[data-testid="earned-grade"]');
    if (earned && isVisibleElement(earned)) {
      const gradeText = String(earned.textContent || "").trim();
      if (gradeText && gradeText !== "--" && !/^not available$/i.test(gradeText)) return true;
    }

    const feedback = root.querySelector?.('button[data-testid="view-feedback-button"]');
    const submission = root.querySelector?.('button[data-testid="view-submission-button"]');
    if (feedback && isVisibleElement(feedback)) return true;
    if (submission && isVisibleElement(submission)) return true;
    return false;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isAssignmentLabel(text) {
    return /^(Practice Assignment|Graded Assignment)$/i.test(normalizeText(text));
  }

  function isDoneMeta(text) {
    return /grade\s*:/i.test(normalizeText(text));
  }

  function isUndoneMeta(text) {
    const meta = normalizeText(text);
    return (/duration/i.test(meta) || /\d+\s*min\b/i.test(meta)) && !isDoneMeta(meta);
  }

  /**
   * Liệt kê các assignment chưa tick theo đúng pattern DOM:
   * - Label: Practice Assignment / Graded Assignment
   * - Chưa tick: phần meta có Duration hoặc "xx min"
   * - Đã tick: phần meta có "Grade:"
   */
  function listAssignmentChuaTickLinks(scope = document) {
    const main = scope.querySelector?.('[role="main"]') || scope.body || scope;
    const rows = Array.from(main.querySelectorAll("div.css-1rhvk9j"));
    const results = [];
    const seen = new Set();

    for (const row of rows) {
      const label = normalizeText(
        Array.from(row.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent || "")
          .join(" ")
      );
      if (!isAssignmentLabel(label)) continue;

      const metaNode = row.querySelector(":scope > span.css-74lbi7");
      const meta = normalizeText(metaNode?.textContent || "");
      if (!isUndoneMeta(meta)) continue;

      const itemContainer = row.closest("li, [role='listitem'], article, section, div");
      const link = itemContainer?.querySelector?.("a[href]") || row.closest("a[href]");
      if (!link || isLockedCourseCard(link)) continue;

      const url = getAbsoluteHref(link.getAttribute("href") || "");
      if (!url || seen.has(url)) continue;

      seen.add(url);
      results.push({ url, label, meta, el: link });
    }

    return results;
  }

  function guessModuleListUrlFromPath() {
    try {
      const saved = sessionStorage.getItem(FAST_QUIZ_LIST_URL_KEY);
      if (saved) return saved;
    } catch {
      // ignore
    }
    const path = location.pathname || "";
    const courseMatch = path.match(/^\/learn\/([^/]+)/i);
    if (!courseMatch) return "";
    const slug = courseMatch[1];
    const modMatch = path.match(/\/home\/module\/(\d+)/i);
    if (modMatch) return `${location.origin}/learn/${slug}/home/module/${modMatch[1]}`;
    const weekMatch = path.match(/\/home\/week\/(\d+)/i);
    if (weekMatch) return `${location.origin}/learn/${slug}/home/week/${weekMatch[1]}`;
    return `${location.origin}/learn/${slug}/home/welcome`;
  }

  function rememberFastQuizListUrl() {
    if (listAssignmentChuaTickLinks(document).length === 0) return;
    try {
      sessionStorage.setItem(FAST_QUIZ_LIST_URL_KEY, location.href);
    } catch {
      // ignore
    }
  }

  async function waitForAssignmentList(runId, timeoutMs = 20000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (!isRunActive(runId) || !isFastQuizEnabled()) return false;
      if (listAssignmentChuaTickLinks(document).length > 0) return true;
      await sleep(500);
    }
    return listAssignmentChuaTickLinks(document).length > 0;
  }

  /** Chỉ dùng giữa 2 vòng: nếu trang hiện tại không có list thì mở lại URL module đã lưu. */
  async function ensureAssignmentListForNhay(runId) {
    if (listAssignmentChuaTickLinks(document).length > 0) {
      rememberFastQuizListUrl();
      return { ok: true, navigated: false };
    }

    let listUrl = "";
    try {
      listUrl = sessionStorage.getItem(FAST_QUIZ_LIST_URL_KEY) || "";
    } catch {
      // ignore
    }
    if (!listUrl) listUrl = guessModuleListUrlFromPath();
    if (!listUrl) {
      showToast("Mở trang module có danh sách assignment rồi bấm Fast Quiz lại.");
      return { ok: false };
    }

    const current = location.href.split("#")[0];
    const target = listUrl.split("#")[0];
    if (current === target) {
      const hasList = await waitForAssignmentList(runId, 15000);
      return { ok: hasList, navigated: false };
    }

    try {
      sessionStorage.setItem("qlo_fast_quiz_pending_check", "1");
    } catch {
      // ignore
    }
    setFastQuizStep("đang mở danh sách bài (bài tiếp theo)...");
    location.assign(listUrl);
    return { ok: true, navigated: true };
  }

  /**
   * Nhảy tới bài Practice/Graded Assignment chưa tick đầu tiên (từ trên xuống).
   */
  async function nhay_bai_chua_done() {
    const items = listAssignmentChuaTickLinks(document);
    if (!items.length) {
      showToast(
        "Không thấy Practice/Graded Assignment chưa tick. Hãy mở đúng trang danh sách module/quiz."
      );
      return { ok: false, reason: "not_found" };
    }

    rememberFastQuizListUrl();

    const target = items[0];
    const shortLabel = `${target.label} (${target.meta})`;

    if (location.href.split("#")[0] === target.url.split("#")[0]) {
      showToast(`Đã ở bài chưa tick: ${shortLabel}`);
      return { ok: true, url: target.url, label: shortLabel, navigated: false };
    }

    try {
      sessionStorage.setItem("qlo_fast_quiz_pending_check", "1");
      sessionStorage.setItem(FAST_QUIZ_AFTER_NHAY_KEY, "1");
    } catch {
      // ignore
    }
    let urlWithMarker = target.url;
    try {
      const u = new URL(target.url);
      const hash = String(u.hash || "");
      const hasMarker = /(^#|[&?])qlo_fast_quiz=1\b/i.test(hash);
      u.hash = hasMarker ? hash : (hash ? `${hash}&qlo_fast_quiz=1` : "#qlo_fast_quiz=1");
      urlWithMarker = u.toString();
    } catch {
      // ignore
    }

    showToast(`Nhảy tới bài chưa tick: ${shortLabel}`);
    location.assign(urlWithMarker);
    return { ok: true, url: urlWithMarker, label: shortLabel, navigated: true };
  }

  function hasNoGradeTag(scope = document) {
    const node = scope.querySelector('p[data-testid="no-grade-text"]');
    if (!node) return false;
    const text = String(node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    return text.includes("--") || text.includes("not available");
  }

  async function check_nhay_bai_chua_done(runId = "") {
    showToast("Đang đợi Start + no-grade (--/Not available)...");
    setFastQuizStep("đang đợi Start + no-grade...");
    let loops = 0;

    while (true) {
      if (runId && (!isRunActive(runId) || !isFastQuizEnabled())) {
        return { ok: false, reason: "stopped" };
      }

      const hasStart = !!findStartButton();
      const hasNoGrade = hasNoGradeTag(document);

      if (hasStart && hasNoGrade) {
        showToast("Đã tìm thấy: có Start + no-grade (--).", "success");
        setFastQuizStep("đã thấy Start + no-grade");
        return { ok: true, done: true, hasStart, hasNoGrade };
      }

      loops += 1;
      if (loops % 8 === 0) {
        showToast("Vẫn đang đợi Start + no-grade...");
      }
      await sleep(500);
    }
  }

  function ensureGeminiWaitOverlay() {
    let overlay = document.getElementById(GEMINI_WAIT_OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = GEMINI_WAIT_OVERLAY_ID;
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "10019";
    overlay.style.display = "none";
    overlay.style.background = "rgba(2, 6, 23, 0.45)";

    const panel = document.createElement("div");
    panel.style.position = "absolute";
    panel.style.right = "24px";
    panel.style.top = "24px";
    panel.style.width = "280px";
    panel.style.background = "#1f2937";
    panel.style.color = "#fff";
    panel.style.borderRadius = "12px";
    panel.style.padding = "12px";
    panel.style.boxShadow = "0 12px 28px rgba(0,0,0,0.35)";

    const title = document.createElement("div");
    title.textContent = "GMN Auto đang chạy";
    title.style.fontWeight = "700";
    title.style.marginBottom = "8px";

    const status = document.createElement("div");
    status.id = `${GEMINI_WAIT_OVERLAY_ID}-status`;
    status.textContent = "Đang chuẩn bị...";
    status.style.fontSize = "12px";
    status.style.opacity = "0.95";

    panel.appendChild(title);
    panel.appendChild(status);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    return overlay;
  }

  function setGeminiWaitOverlay(visible, text = "") {
    const overlay = ensureGeminiWaitOverlay();
    overlay.style.display = visible ? "block" : "none";
    if (text) {
      const status = document.getElementById(`${GEMINI_WAIT_OVERLAY_ID}-status`);
      if (status) status.textContent = text;
    }
  }

  async function waitForSubmitDialogForever() {
    while (true) {
      const dialog = getVisibleSubmitDialog();
      const dialogText = String(dialog?.textContent || "").toLowerCase();
      const hasHeading = dialogText.includes("ready to submit");
      const submitBtn = findDialogSubmitButton();
      if (hasHeading && submitBtn && isVisibleElement(submitBtn)) return submitBtn;
      if (submitBtn && isSubmitButtonReady(submitBtn) && isVisibleElement(submitBtn)) return submitBtn;
      await sleep(250);
    }
  }

  /**
   * Sau khi fill đáp án: tick ô agree → chờ Submit sẵn sàng → bấm Submit (popup thì bấm thêm 1 lần).
   */
  async function autoSubmitAfterFill() {
    const reportStep = (msg) => {
      showToast(msg);
    };

    if (!isQuizWorkingPage()) {
      showToast("Không ở trang làm bài, không thể nộp.");
      return false;
    }

    reportStep("Paste: tick ô đồng ý...");
    await tickAgreementWithRetry(10000);
    const agreementEl = findAgreementCheckbox();
    if (agreementEl && !isAgreementChecked(agreementEl)) {
      showToast("Chưa tick được ô đồng ý. Hãy tick thủ công rồi bấm Paste lại.");
      return false;
    }

    await sleep(400);

    reportStep("Paste: chờ nút Submit lần 1...");
    const submitBtn = await waitForSubmitButton(12000);
    if (!submitBtn) {
      showToast("Nút Submit chưa sẵn sàng. Hãy tick ô đồng ý thủ công nếu cần.");
      return false;
    }

    reportStep("Paste: bấm Submit lần 1...");
    safeClick(submitBtn);

    reportStep("Paste: chờ popup Ready to submit?...");
    const dialogSubmitBtn = await waitForSubmitDialogForever();
    await sleep(1000);

    reportStep("Paste: bấm Submit trên popup (đợi popup đóng)...");
    safeClick(dialogSubmitBtn);

    // Một số course/popup chỉ đóng sau khi click lần nữa hoặc sau khi UI render xong.
    // Vì vậy thay vì kiểm tra sau 500ms, ta đợi cho tới khi popup đóng (hoặc earned-grade xác nhận).
    const startedAt = Date.now();
    while (true) {
      // Nếu popup đã đóng hoặc earned-grade đã hiện thì coi là đã xác nhận nộp bài.
      if (!isSubmitDialogOpen()) break;
      if (isQuizGradeConfirmed(document)) break;

      // Popup còn mở: click lại nút submit trong popup (nếu vẫn thấy).
      const btn = findDialogSubmitButton();
      if (btn && isVisibleElement(btn)) {
        safeClick(btn);
      }

      if (Date.now() - startedAt > 30000) break;
      await sleep(700);
    }

    if (isSubmitDialogOpen() && !isQuizGradeConfirmed(document)) {
      showToast("Popup Submit vẫn mở sau khi bấm. Vui lòng kiểm tra lại trang/submit thủ công.");
      return false;
    }

    reportStep("Paste: Submit popup OK — chờ earned-grade...");
    showToast("Đã bấm Submit popup, đang chờ xác nhận điểm...");
    try {
      sessionStorage.setItem(PENDING_GRADE_CHECK_KEY, "1");
    } catch {
      // ignore
    }
    return true;
  }

  function check_bai_lam_once() {
    return isQuizGradeConfirmed(document);
  }

  async function isGeminiAutoEnabled() {
    try {
      const stored = await chrome.storage.local.get([GEMINI_AUTO_STORAGE]);
      return !!stored?.[GEMINI_AUTO_STORAGE];
    } catch {
      return false;
    }
  }

  async function runPasteFlowFromText(sourceText, answersTextarea, runId = "") {
    const text = String(sourceText || "").trim();
    if (!text) {
      showToast("Ô đáp án trống và clipboard không có nội dung.");
      return false;
    }

    const answersMap = parseQuizAnswers(text);
    if (answersMap.length === 0) {
      showToast("Không có đáp án hợp lệ. Ví dụ: 1. c hoặc 4. a,b");
      return false;
    }

    await fillQuizAnswers({ answersMap });
    const submitted = await autoSubmitAfterFill();
    if (!submitted) return false;
    // Submit xong; Fast Quiz sẽ đếm ngược 10s rồi chuyển bài tiếp.
    if (answersTextarea) answersTextarea.value = "";
    updateQuizEntryRowsVisibility();
    return true;
  }

  async function runGeminiAutoSolveAndPaste(answersTextarea, loaderEl, runId = "") {
    const setLoading = (on) => {
      if (!loaderEl) return;
      loaderEl.classList.toggle("qlo-hidden", !on);
    };

    setLoading(true);
    setGeminiWaitOverlay(true, "Đang đọc toàn bộ câu hỏi...");
    try {
      if (runId && !isRunActive(runId)) return false;
      await ensureAllQuestionsLoaded();

      const quizData = extractFullQuizContent();
      if (!Array.isArray(quizData) || quizData.length === 0) {
        showToast("Không tìm thấy nội dung quiz để gửi Gemini.");
        return false;
      }

      const expectedFromPage = getExpectedQuestionCountFromPage();
      const questionCount = Math.max(quizData.length, expectedFromPage || 0);

      if (expectedFromPage && quizData.length < expectedFromPage) {
        showToast(
          `Chỉ đọc được ${quizData.length}/${expectedFromPage} câu. Hãy cuộn hết quiz rồi bấm Quiz lại.`
        );
      }

      const quizText = formatQuizForClipboard(quizData);
      setGeminiWaitOverlay(true, "Đang gửi quiz qua Gemini...");
      const resp = await chrome.runtime.sendMessage({
        action: "geminiSolveQuiz",
        quizText,
        questionCount,
      });

      if (!resp?.ok || !resp?.answersText) {
        const detail = resp?.details ? `\n${resp.details}` : "";
        showToast(resp?.error ? `Gemini lỗi: ${resp.error}${detail}` : "Gemini lỗi không rõ.");
        return false;
      }

      if (resp?.keyRotated && resp?.usedKeyMask) {
        showToast(`GMN đã xoay sang API key khác: ${resp.usedKeyMask}`);
      }

      if (resp?.fallback && resp?.usedModel) {
        showToast(`GMN tự chuyển sang model: ${resp.usedModel}`);
      }

      const receivedCount = countParsedAnswers(resp.answersText);
      if (questionCount > 0 && receivedCount < questionCount) {
        showToast(
          `Gemini chỉ trả ${receivedCount}/${questionCount} đáp án. Vẫn điền các câu có đáp án.`
        );
      } else if (questionCount > 0) {
        showToast(`Gemini trả ${receivedCount}/${questionCount} đáp án.`);
      }

      if (answersTextarea) answersTextarea.value = resp.answersText;
      setGeminiWaitOverlay(true, "Đang điền đáp án và submit...");
      return await runPasteFlowFromText(resp.answersText, answersTextarea, runId);
    } catch (err) {
      showToast(`Gemini lỗi: ${err?.message || String(err)}`);
      return false;
    } finally {
      setLoading(false);
      setGeminiWaitOverlay(false);
    }
  }

  async function runQuizFeaturesFlow(runId = "") {
    updateQuizEntryRowsVisibility();
    const ok = await handleQuizButton();
    updateQuizEntryRowsVisibility();
    if (!ok || !isQuizWorkingPage()) return !!ok;

    const geminiEnabled = await isGeminiAutoEnabled();
    const answersTextarea = document.getElementById(QUIZ_ANSWERS_TEXTAREA_ID);
    if (geminiEnabled) {
      const loaderEl = document.getElementById("coursera-qlo-loader");
      await runGeminiAutoSolveAndPaste(answersTextarea, loaderEl, runId);
      return true;
    }
    answersTextarea?.focus?.();
    return true;
  }

  function isSupportedSkipPage() {
    const path = location.pathname || "";
    const patterns = [
      /^\/learn\/[^/]+\/?$/i,
      /^\/learn\/.+\/home\/module\/\d+/i,
      /^\/learn\/.+\/lecture\/.+/i,
      /^\/learn\/.+\/supplement\/.+/i,
      /^\/learn\/.+\/(quiz|exam|practice)\/.+/i,
    ];
    return patterns.some((re) => re.test(path));
  }

  function getCourseSlugFromLocation() {
    const match = (location.pathname || "").match(/^\/learn\/([^/]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function pickFirstArrayValue(linked, keys) {
    if (!linked || typeof linked !== "object") return [];
    for (const key of keys) {
      const val = linked[key];
      if (Array.isArray(val) && val.length > 0) return val;
    }
    return [];
  }

  function getUserIdFromApp() {
    try {
      const id = window?.App?.context?.dispatcher?.stores?.ApplicationStore?.userData?.id;
      if (Number.isFinite(id) && id > 0) return Number(id);
    } catch {
      // ignore
    }
    return null;
  }

  function getUserIdFromPageText() {
    const fromApp = getUserIdFromApp();
    if (fromApp) return fromApp;

    const scriptsText = Array.from(document.querySelectorAll("script"))
      .map((s) => s.textContent || "")
      .join("\n");
    const patterns = [
      /"userData"\s*:\s*\{[^}]*"id"\s*:\s*(\d+)/i,
      /"userId"\s*:\s*(\d+)/i,
      /"externalUserId"\s*:\s*"?(\d+)"?/i,
    ];
    for (const p of patterns) {
      const m = scriptsText.match(p);
      if (m?.[1]) return Number(m[1]);
    }
    return null;
  }

  async function getUserIdForDeepSkip() {
    const fromApp = getUserIdFromApp();
    if (fromApp) {
      try {
        await chrome.storage.local.set({ userId: fromApp });
      } catch {
        // ignore
      }
      return fromApp;
    }

    try {
      const stored = await chrome.storage.local.get(["userId"]);
      const fromStorage = Number(stored?.userId);
      if (Number.isFinite(fromStorage) && fromStorage > 0) return fromStorage;
    } catch {
      // ignore
    }
    return getUserIdFromPageText();
  }

  async function getCsrf3TokenForCoursera() {
    try {
      const stored = await chrome.storage.local.get(["csrf3Token", "CSRF3-Token"]);
      const fromStorage = stored?.csrf3Token || stored?.["CSRF3-Token"];
      if (fromStorage) return String(fromStorage);
    } catch {
      // ignore
    }
    const m = document.cookie.match(/(?:^|;\s*)CSRF3-Token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  async function buildCourseraApiHeaders(extra = {}, method = "GET") {
    const m = String(method || "GET").toUpperCase();
    const headers = {
      Accept: "application/json",
      ...extra,
    };

    // GET theo style Coursera client: không ép Content-Type/x-csrf3-token.
    if (m !== "GET" && m !== "HEAD") {
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      const csrf = await getCsrf3TokenForCoursera();
      if (csrf && !headers["x-csrf3-token"]) headers["x-csrf3-token"] = csrf;
    }
    return headers;
  }

  async function courseraApiRequest(url, options = {}) {
    const method = options.method || "GET";
    const headers = await buildCourseraApiHeaders(options.headers || {}, method);
    const res = await fetch(url, {
      credentials: "include",
      ...options,
      headers,
    });
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  }

  async function fetchCourseIdDeep(slug, items, fallbackId) {
    const fromItem = items.find((it) => it?.courseId)?.courseId;
    if (fromItem) return String(fromItem);

    const courseUrl =
      "https://www.coursera.org/api/onDemandCourses.v1/" +
      `?q=slug&slug=${encodeURIComponent(slug)}&fields=id,slug`;
    const { ok, json } = await courseraApiRequest(courseUrl, { method: "GET" });
    if (ok && json?.elements?.[0]?.id) return String(json.elements[0].id);

    return String(fallbackId || "").trim();
  }

  function getCourseIdFromPageText() {
    try {
      const fromStore =
        window?.App?.context?.dispatcher?.stores?.CourseStore?.courseId ||
        window?.App?.context?.dispatcher?.stores?.S12nStore?.currentCourseId;
      if (fromStore) return String(fromStore);
    } catch {
      // ignore
    }

    const scriptsText = Array.from(document.querySelectorAll("script"))
      .map((s) => s.textContent || "")
      .join("\n");
    const patterns = [
      /"courseId"\s*:\s*"([A-Za-z0-9_-]{8,})"/i,
      /"course"\s*:\s*\{\s*"id"\s*:\s*"([A-Za-z0-9_-]{8,})"/i,
    ];
    for (const p of patterns) {
      const m = scriptsText.match(p);
      if (m?.[1]) return String(m[1]);
    }
    return "";
  }

  function getItemsFromDomFallback() {
    const links = Array.from(
      document.querySelectorAll(
        'a[href*="/learn/"][href*="/lecture/"], a[href*="/learn/"][href*="/supplement/"]'
      )
    );

    const byId = new Map();
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/(lecture|supplement)\/([^/?#]+)/i);
      if (!m?.[2]) continue;

      const type = String(m[1]).toLowerCase();
      const id = decodeURIComponent(m[2]);
      if (!id || byId.has(id)) continue;

      byId.set(id, {
        id,
        slug: id,
        timeCommitment: 600000,
        isLocked: false,
        contentSummary: {
          typeName: type === "lecture" ? "lecture" : "supplement",
        },
      });
    }

    return Array.from(byId.values());
  }

  async function fetchCourseMaterialsDeep(slug) {
    // URL i2() từ script tham khảo (copy nguyên includes/fields để tránh 400 ở một số course).
    const richUrl =
      "https://www.coursera.org/api/onDemandCourseMaterials.v2/" +
      `?q=slug&slug=${encodeURIComponent(slug)}` +
      "&includes=modules%2Clessons%2CpassableItemGroups%2CpassableItemGroupChoices%2CpassableLessonElements%2Citems%2Ctracks%2CgradePolicy%2CgradingParameters%2CembeddedContentMapping" +
      "&fields=moduleIds%2ConDemandCourseMaterialModules.v1(name%2Cslug%2Cdescription%2CtimeCommitment%2ClessonIds%2Coptional%2ClearningObjectives)%2ConDemandCourseMaterialLessons.v1(name%2Cslug%2CtimeCommitment%2CelementIds%2Coptional%2CtrackId)%2ConDemandCourseMaterialPassableItemGroups.v1(requiredPassedCount%2CpassableItemGroupChoiceIds%2CtrackId)%2ConDemandCourseMaterialPassableItemGroupChoices.v1(name%2Cdescription%2CitemIds)%2ConDemandCourseMaterialPassableLessonElements.v1(gradingWeight%2CisRequiredForPassing)%2ConDemandCourseMaterialItems.v2(name%2CoriginalName%2Cslug%2CtimeCommitment%2CcontentSummary%2CisLocked%2ClockableByItem%2CitemLockedReasonCode%2CtrackId%2ClockedStatus%2CitemLockSummary)%2ConDemandCourseMaterialTracks.v1(passablesCount)%2ConDemandGradingParameters.v1(gradedAssignmentGroups)%2CcontentAtomRelations.v1(embeddedContentSourceCourseId%2CsubContainerId)" +
      "&showLockedItems=true";

    const urls = [
      richUrl,
      "https://www.coursera.org/api/onDemandCourseMaterials.v2/" +
        `?q=slug&slug=${encodeURIComponent(slug)}` +
        "&showLockedItems=true" +
        "&includes=modules,lessons,items,onDemandCourseMaterialItems.v2,onDemandCourseMaterialModules.v1,onDemandCourseMaterialLessons.v1,onDemandCourseMaterialGradePolicy.v1,onDemandCourseMaterialGradePolicies.v1",
    ];

    let lastStatus = 0;
    for (const url of urls) {
      const { ok, status, json } = await courseraApiRequest(url, { method: "GET" });
      lastStatus = status;
      if (!ok || !json) continue;

      const linked = json?.linked || {};
      const items = pickFirstArrayValue(linked, ["onDemandCourseMaterialItems.v2"]);
      const modules = pickFirstArrayValue(linked, ["onDemandCourseMaterialModules.v1"]);
      const lessons = pickFirstArrayValue(linked, ["onDemandCourseMaterialLessons.v1"]);
      if (!Array.isArray(items) || items.length === 0) continue;

      const policyList = pickFirstArrayValue(linked, [
        "onDemandCourseMaterialGradePolicy.v1",
        "onDemandCourseMaterialGradePolicies.v1",
      ]);
      const policyCourseId = String(policyList?.[0]?.id || json?.elements?.[0]?.id || "").trim();
      const courseId = await fetchCourseIdDeep(slug, items, policyCourseId || getCourseIdFromPageText());

      return { items, courseId, modules, lessons };
    }

    // Fallback khi materials API 400/403 ở một số course: lấy danh sách item từ DOM.
    const domItems = getItemsFromDomFallback();
    let fallbackCourseId = getCourseIdFromPageText();
    if (!fallbackCourseId) {
      fallbackCourseId = await fetchCourseIdDeep(slug, [], "");
    }
    if (domItems.length > 0 && fallbackCourseId) {
      return { items: domItems, courseId: fallbackCourseId, modules: [], lessons: [] };
    }

    throw new Error(`Course materials API error ${lastStatus || 400}`);
  }

  function getModuleNumberFromPath() {
    const m = (location.pathname || "").match(/\/home\/module\/(\d+)/i);
    return m ? Number(m[1]) : null;
  }

  function filterItemsForModulePage(items, modules, lessons) {
    const moduleNum = getModuleNumberFromPath();
    if (!moduleNum || !Array.isArray(modules) || modules.length === 0) return items;

    const mod = modules[moduleNum - 1];
    if (!mod) return items;

    const lessonIds = new Set(mod.lessonIds || []);
    const itemIds = new Set();
    for (const lesson of lessons || []) {
      if (!lessonIds.has(lesson.id)) continue;
      for (const elementId of lesson.elementIds || []) {
        itemIds.add(elementId);
      }
    }
    if (itemIds.size === 0) return items;
    return items.filter((it) => itemIds.has(it.id));
  }

  function getSkipItemKind(item) {
    const type = String(item?.contentSummary?.typeName || "").toLowerCase();
    if (type.includes("supplement")) return "supplement";
    if (type.includes("lecture")) return "lecture";
    if (type.includes("coach")) return "coach";
    if (type.includes("ungradedwidget") || type.includes("gradedwidget") || type.includes("widget")) {
      return "widget";
    }
    if (type.includes("ungradedlti") || type.includes("gradedlti") || type.includes("lti")) {
      return "lti";
    }
    return "";
  }

  async function postSupplementBodies(bodies) {
    for (const body of bodies) {
      await courseraApiRequest("https://www.coursera.org/api/onDemandSupplementStarts.v1", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    for (const body of bodies) {
      const res = await courseraApiRequest(
        "https://www.coursera.org/api/onDemandSupplementCompletions.v1",
        { method: "POST", body: JSON.stringify(body) }
      );
      if (res.ok) return true;
    }
    return false;
  }

  async function markSupplementCompletedDeep({ courseId, itemId, userId }) {
    const base = { courseId, itemId, userId: Number(userId) };
    const bodies = [base, { elements: [base] }];
    return postSupplementBodies(bodies);
  }

  async function getVideoProgressState(userId, courseId, itemId) {
    const key = `${userId}~${courseId}~${itemId}`;
    const url = `https://www.coursera.org/api/onDemandVideoProgresses.v1/${encodeURIComponent(key)}`;
    const { ok, json } = await courseraApiRequest(url, { method: "GET" });
    if (!ok) return "";
    return String(json?.elements?.[0]?.progressState || "");
  }

  async function sendVideoEndedEvent({ userId, courseSlug, itemId }) {
    if (!itemId) return false;
    const url =
      `https://www.coursera.org/api/opencourse.v1/user/${userId}` +
      `/course/${encodeURIComponent(courseSlug)}` +
      `/item/${encodeURIComponent(itemId)}/lecture/videoEvents/ended?autoEnroll=false`;

    // Script tham khảo: retry cho tới khi ok.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await courseraApiRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentRequestBody: {} }),
      });
      if (res.ok) return true;
      await sleep(2000);
    }
    return false;
  }

  async function markLectureCompletedDeep({ courseId, item, userId, courseSlug }) {
    // Theo script tham khảo: trước tiên lấy videoId qua onDemandLectureVideos,
    // sau đó PUT viewedUpTo + videoProgressId, rồi POST videoEvents/ended.
    const itemId = String(item?.id || "").trim();
    if (!itemId) return false;

    const lectureKey = `${courseId}~${itemId}`;
    const lectureUrl =
      "https://www.coursera.org/api/onDemandLectureVideos.v1/" +
      `${encodeURIComponent(lectureKey)}?includes=video&fields=onDemandVideos.v1(sources%2Csubtitles%2CsubtitlesVtt%2CsubtitlesTxt%2CsubtitlesAssetTags%2CdubbedSources%2CdubbedSubtitlesVtt)%2CdisableSkippingForward%2CstartMs%2CendMs`;

    const lectureRes = await courseraApiRequest(lectureUrl, { method: "GET" });
    if (!lectureRes.ok || !lectureRes.json) return false;

    const linkedVideos = lectureRes.json?.linked?.["onDemandVideos.v1"];
    const video = Array.isArray(linkedVideos) ? linkedVideos[0] : null;
    const videoId = video?.id;
    if (!videoId) return false;

    const key = `${userId}~${courseId}~${videoId}`;
    const progressUrl = `https://www.coursera.org/api/onDemandVideoProgresses.v1/${encodeURIComponent(
      key
    )}`;

    // timeCommitment đôi khi không phải ms => ưu tiên endMs từ lectureVideos (giống Coursera player).
    const endMs = Number(lectureRes.json?.elements?.[0]?.endMs || 0);
    const timeCommitment = Number(item?.timeCommitment || 0);
    const baseMs = endMs > 1000 ? endMs : timeCommitment > 1000 ? timeCommitment : 600000;
    const viewedUpTo = baseMs - 1000;
    const progressBody = {
      viewedUpTo,
      videoProgressId: key,
    };

    const putRes = await courseraApiRequest(progressUrl, {
      method: "PUT",
      body: JSON.stringify(progressBody),
    });

    if (!putRes.ok && putRes.status !== 404 && putRes.status !== 400) {
      return false;
    }

    await sendVideoEndedEvent({ userId, courseSlug, itemId });

    const state = await getVideoProgressState(userId, courseId, videoId);
    return state === "Completed";
  }

  async function markWidgetCompletedDeep({ courseId, itemId, userId }) {
    const key = `${userId}~${courseId}~${itemId}`;
    const url = `https://www.coursera.org/api/onDemandWidgetProgress.v1/${encodeURIComponent(key)}`;
    const bodies = [
      { data: { progressState: "Completed" } },
      { progressState: "Completed" },
    ];

    for (const body of bodies) {
      const res = await courseraApiRequest(url, { method: "PUT", body: JSON.stringify(body) });
      if (res.ok) return true;
    }
    return false;
  }

  async function markLtiCompletedDeep({ courseId, itemId, userId }) {
    const bodies = [
      { courseId, itemId, learnerId: Number(userId), markItemCompleted: true },
      {
        elements: [
          { courseId, itemId, learnerId: Number(userId), markItemCompleted: true },
        ],
      },
    ];

    for (const body of bodies) {
      const res = await courseraApiRequest(
        "https://www.coursera.org/api/onDemandLtiUngradedLaunches.v1",
        { method: "POST", body: JSON.stringify(body) }
      );
      if (res.ok) return true;
    }
    return false;
  }

  async function markSkipItemCompleted({ item, courseId, userId, courseSlug }) {
    const kind = getSkipItemKind(item);
    const itemId = String(item?.id || "").trim();
    if (!itemId || !kind) return { ok: false, kind: kind || "unknown" };

    let ok = false;

    if (kind === "supplement") {
      ok = await markSupplementCompletedDeep({ courseId, itemId, userId });
    } else if (kind === "lecture") {
      ok = await markLectureCompletedDeep({
        courseId,
        item,
        userId,
        courseSlug,
      });
    } else if (kind === "widget" || kind === "coach") {
      ok = await markWidgetCompletedDeep({ courseId, itemId, userId });
    } else if (kind === "lti") {
      ok = await markLtiCompletedDeep({ courseId, itemId, userId });
    }

    return { ok, kind };
  }

  function upsertProgressToast(current, total) {
    let toast = document.getElementById(SKIP_PROGRESS_TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = SKIP_PROGRESS_TOAST_ID;
      toast.style.position = "fixed";
      toast.style.right = "20px";
      toast.style.bottom = "64px";
      toast.style.zIndex = "10001";
      toast.style.padding = "8px 11px";
      toast.style.borderRadius = "10px";
      toast.style.background = "rgba(37, 99, 235, 0.96)";
      toast.style.color = "#fff";
      toast.style.fontSize = "12px";
      toast.style.fontWeight = "600";
      toast.style.boxShadow = "0 10px 30px rgba(0,0,0,0.22)";
      toast.style.pointerEvents = "none";
      document.body.appendChild(toast);
    }
    toast.textContent = `Progress: ${current}/${total}`;
  }

  function clearProgressToast() {
    const toast = document.getElementById(SKIP_PROGRESS_TOAST_ID);
    if (toast) toast.remove();
  }

  async function handleSkipVideoReading() {
    if (!isSupportedSkipPage()) {
      showToast("This is not a supported course page");
      return false;
    }

    try {
      const slug = getCourseSlugFromLocation();
      if (!slug) {
        showToast("Không đọc được course slug từ URL.");
        return false;
      }

      const userId = await getUserIdForDeepSkip();
      if (!userId) {
        showToast("Thiếu userId. Hãy reload course rồi thử lại.");
        return false;
      }

      let items = [];
      let courseId = "";
      let modules = [];
      let lessons = [];
      let usedMaterialsFallback = false;

      try {
        const deep = await fetchCourseMaterialsDeep(slug);
        items = Array.isArray(deep?.items) ? deep.items : [];
        courseId = String(deep?.courseId || "").trim();
        modules = Array.isArray(deep?.modules) ? deep.modules : [];
        lessons = Array.isArray(deep?.lessons) ? deep.lessons : [];
      } catch (err) {
        usedMaterialsFallback = true;
        items = getItemsFromDomFallback();
        courseId = getCourseIdFromPageText();
        if (!courseId) {
          courseId = await fetchCourseIdDeep(slug, [], "");
        }
        modules = [];
        lessons = [];
        if (!Array.isArray(items) || items.length === 0 || !courseId) {
          showToast(`Skip failed: ${err?.message || "Course materials API error"}`);
          return false;
        }
      }

      const scopedItems = filterItemsForModulePage(items, modules, lessons);
      const targets = scopedItems.filter((it) => {
        if (it?.isLocked === true) return false;
        return Boolean(getSkipItemKind(it));
      });

      const videos = targets.filter((it) => getSkipItemKind(it) === "lecture");
      const readings = targets.filter((it) => getSkipItemKind(it) === "supplement");
      const others = targets.length - videos.length - readings.length;

      const total = targets.length;
      if (total === 0) {
        const moduleHint = getModuleNumberFromPath() ? ` module ${getModuleNumberFromPath()}` : "";
        showToast(`Không có video/reading để skip${moduleHint}.`);
        return false;
      }

      const scopeHint = getModuleNumberFromPath() ? ` (module ${getModuleNumberFromPath()})` : "";
      showToast(
        `Skip${scopeHint}: ${videos.length} video + ${readings.length} reading` +
          (others > 0 ? ` + ${others} khác` : "") +
          (usedMaterialsFallback ? " (fallback mode)" : "")
      );
      upsertProgressToast(0, total);

      let done = 0;
      let succeeded = 0;
      let failed = 0;

      for (const item of targets) {
        try {
          const result = await markSkipItemCompleted({ item, courseId, userId, courseSlug: slug });
          if (result.ok) succeeded += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }

        done += 1;
        upsertProgressToast(done, total);
        await sleep(120);
      }

      if (failed > 0) {
        clearProgressToast();
        showToast(
          `Skip xong: ${succeeded}/${total} thành công, ${failed} lỗi. Reload trang để xem tick.`
        );
      } else {
        clearProgressToast();
        showToast(
          `Skip completed: ${succeeded}/${total} (video: ${videos.length}, reading: ${readings.length}). Reload để cập nhật tick.`
        );
      }
      return succeeded > 0;
    } catch (err) {
      clearProgressToast();
      showToast(`Skip failed: ${err?.message || "Please try again."}`);
      return false;
    }
  }

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

  function comboFromKeyboardEvent(event) {
    const mods = [];
    if (event.ctrlKey) mods.push("ctrl");
    if (event.altKey) mods.push("alt");
    if (event.shiftKey) mods.push("shift");
    if (event.metaKey) mods.push("meta");
    let key = String(event.key || "").toLowerCase();
    if (key === " ") key = "space";
    if (key === "escape") key = "esc";
    if (key.startsWith("arrow")) key = key.replace("arrow", "");
    if (!key) return "";
    return [...mods, key].join("+");
  }

  function isTypingTarget(target) {
    const el = target && target.nodeType === 1 ? target : null;
    if (!el) return false;
    if (el.closest?.("input, textarea, [contenteditable='true'], [role='textbox']")) return true;
    return false;
  }

  function mergeKeymapWithDefaults(stored) {
    const next = {};
    for (const action of Object.keys(DEFAULT_TOOL_KEYMAP)) {
      const custom = normalizeKeyCombo(stored?.[action] || "");
      next[action] = custom || DEFAULT_TOOL_KEYMAP[action];
    }
    return next;
  }

  function loadToolKeymap() {
    return cachedToolKeymap || mergeKeymapWithDefaults({});
  }

  async function refreshToolKeymapCache() {
    let stored = {};
    try {
      const result = await chrome.storage.local.get(TOOL_PANEL_KEYMAP_STORAGE_KEY);
      stored = result?.[TOOL_PANEL_KEYMAP_STORAGE_KEY];
      if (!stored || typeof stored !== "object") {
        try {
          const raw = localStorage.getItem(TOOL_PANEL_KEYMAP_STORAGE_KEY);
          const legacy = raw ? JSON.parse(raw) : null;
          if (legacy && typeof legacy === "object") {
            stored = legacy;
            await chrome.storage.local.set({ [TOOL_PANEL_KEYMAP_STORAGE_KEY]: legacy });
          }
        } catch {
          // ignore
        }
      }
    } catch {
      stored = {};
    }
    cachedToolKeymap = mergeKeymapWithDefaults(stored);
    return cachedToolKeymap;
  }

  function saveToolKeymap(map) {
    const payload = {};
    for (const action of Object.keys(DEFAULT_TOOL_KEYMAP)) {
      payload[action] = normalizeKeyCombo(map?.[action] || "");
    }
    cachedToolKeymap = mergeKeymapWithDefaults(payload);
    try {
      void chrome.storage.local.set({ [TOOL_PANEL_KEYMAP_STORAGE_KEY]: payload });
    } catch {
      // ignore
    }
  }

  function stopFastQuizRun() {
    setFastQuizEnabled(false);
    cancelRun("user stop");
  }

  function removeMenuStopButton(actions) {
    if (!actions) return;
    actions.querySelectorAll(".qlo-panel-btn").forEach((btn) => {
      if (String(btn.textContent || "").trim() === "Dừng") btn.remove();
    });
  }

  function removeMenuHelpFromPage(actions) {
    removeMenuStopButton(actions);
    document.getElementById(MENU_HELP_ROW_ID)?.remove();
    document.getElementById("coursera-qlo-row-help")?.remove();
    document.getElementById("coursera-menu-help-style")?.remove();
  }

  function wireMenuActionHandlers(actions, panel) {
    const getByText = (txt) =>
      Array.from(actions?.querySelectorAll(".qlo-panel-btn") || []).find(
        (btn) => String(btn.textContent || "").trim() === txt
      );
    panelActionHandlers.jump = () => getByText("Nhảy")?.click?.();
    panelActionHandlers.quiz = () => getByText("Quiz")?.click?.();
    panelActionHandlers.paste = () => getByText("Paste")?.click?.();
    panelActionHandlers.skip = () => getByText("Skip")?.click?.();
    panelActionHandlers.fastQuiz = () => getByText("Fast Quiz")?.click?.();
    panelActionHandlers.stop = () => stopFastQuizRun();
    panelActionHandlers.togglePanel = () => panel?.classList.toggle("collapsed");
  }

  function bindToolKeyListener() {
    if (toolPanelKeyListenerBound) return;
    toolPanelKeyListenerBound = true;
    void refreshToolKeymapCache();
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[TOOL_PANEL_KEYMAP_STORAGE_KEY]) return;
        cachedToolKeymap = mergeKeymapWithDefaults(
          changes[TOOL_PANEL_KEYMAP_STORAGE_KEY].newValue || {}
        );
      });
    } catch {
      // ignore
    }
    document.addEventListener("keydown", (event) => {
      if (isTypingTarget(event.target)) return;
      const combo = comboFromKeyboardEvent(event);
      if (!combo) return;
      const keymap = loadToolKeymap();
      const action = Object.keys(keymap).find((k) => keymap[k] === combo);
      if (!action) return;
      const handler = panelActionHandlers[action];
      if (!handler) return;
      event.preventDefault();
      try {
        void handler();
      } catch {
        // ignore
      }
    });
  }

  function bindPanelDrag(panel, toggleBtn) {
    if (!panel || panel.dataset.qloDraggableBound === "1") return;
    panel.dataset.qloDraggableBound = "1";
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;
    let dragging = false;
    let moved = false;

    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      panel.style.left = `${Math.max(0, origLeft + dx)}px`;
      panel.style.top = `${Math.max(0, origTop + dy)}px`;
      panel.style.bottom = "auto";
      panel.style.right = "auto";
    };

    const onUp = () => {
      dragging = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    const startDrag = (e) => {
      const t = e.target;
      if (!t) return;
      if (t.closest?.(".qlo-panel-btn, textarea, input, select, label")) return;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      dragging = true;
      moved = false;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    panel.addEventListener("mousedown", startDrag);
    if (toggleBtn) {
      toggleBtn.addEventListener("click", (e) => {
        if (moved) {
          e.preventDefault();
          e.stopPropagation();
          moved = false;
          return;
        }
        panel.classList.toggle("collapsed");
      });
    }
  }

  function ensureToolPanelStyles() {
    if (!document.head) return;
    if (document.getElementById("coursera-tool-panel-style")) return;

    const style = document.createElement("style");
    style.id = "coursera-tool-panel-style";
    style.textContent = `
      .coursera-tool-panel {
        position: fixed;
        left: 20px;
        bottom: 20px;
        z-index: 9999;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.18);
        padding: 8px 12px;
        font-family: "Segoe UI", system-ui, sans-serif;
      }

      .coursera-tool-panel.collapsed {
        width: 44px;
        height: 44px;
        padding: 0;
        border-radius: 999px;
        background: #ffffff;
        border: 2px solid #bfdbfe;
        overflow: hidden;
      }

      #coursera-tool-panel-toggle {
        position: absolute;
        left: 6px;
        bottom: 6px;
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        border-radius: 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .coursera-tool-panel.collapsed #coursera-tool-panel-toggle {
        position: absolute;
        inset: 0;
        width: auto;
        height: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 6px;
      }

      .qlo-panel-toggle-icon-img {
        width: 22px;
        height: 22px;
        object-fit: contain;
        display: block;
        border-radius: 6px;
        pointer-events: none;
        user-select: none;
      }

      .coursera-tool-panel.collapsed .qlo-panel-toggle-icon-img {
        width: 30px;
        height: 30px;
        border-radius: 8px;
      }

      #coursera-tool-panel-actions {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-left: 34px;
      }

      .coursera-tool-panel.collapsed #coursera-tool-panel-actions {
        display: none;
      }

      .qlo-panel-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .qlo-panel-row.quiz-entry-row {
        flex-direction: column;
        align-items: stretch;
      }

      #${FAST_QUIZ_STATUS_ID} {
        font-size: 11px;
        line-height: 1.3;
        color: #1e3a8a;
        background: #dbeafe;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        padding: 5px 8px;
      }

      #${FAST_QUIZ_STATUS_ID}[data-state="success"] {
        color: #166534;
        background: #dcfce7;
        border-color: #86efac;
      }

      #${FAST_QUIZ_OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 10020;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.28);
        pointer-events: auto;
      }

      #${FAST_QUIZ_OVERLAY_ID} .qlo-fast-quiz-panel {
        width: min(340px, calc(100vw - 32px));
        background: #0f172a;
        color: #f8fafc;
        border-radius: 12px;
        padding: 12px 12px 10px;
        box-shadow: 0 14px 32px rgba(15, 23, 42, 0.35);
        border: 1px solid rgba(148, 163, 184, 0.35);
      }

      #${FAST_QUIZ_OVERLAY_ID} .qlo-fast-quiz-panel[data-state="success"] {
        border-color: #4ade80;
      }

      #${FAST_QUIZ_OVERLAY_ID} .qlo-fast-quiz-panel[data-state="waiting"] {
        border-color: #60a5fa;
      }

      #${FAST_QUIZ_OVERLAY_ID} .qlo-fast-quiz-title {
        font-size: 13px;
        font-weight: 800;
        margin-bottom: 6px;
      }

      #${FAST_QUIZ_OVERLAY_ID} .qlo-fast-quiz-status {
        font-size: 12px;
        line-height: 1.35;
        min-height: 34px;
        margin-bottom: 10px;
        color: #e2e8f0;
        word-break: break-word;
      }

      #${FAST_QUIZ_OVERLAY_ID} .qlo-fast-quiz-stop {
        width: 100%;
        border: none;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        background: #ef4444;
        color: #fff;
      }

      #${FAST_QUIZ_OVERLAY_ID} .qlo-fast-quiz-stop:hover {
        background: #dc2626;
      }

      #coursera-qlo-row-actions .qlo-panel-btn {
        flex: 1;
      }

      .qlo-hidden {
        display: none !important;
      }

      .qlo-panel-btn {
        border: none;
        padding: 6px 12px;
        border-radius: 8px;
        background: #f0f0f0;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        color: #0f172a;
        line-height: 1;
      }

      .qlo-panel-btn:hover {
        background: #e5e5e5;
      }

      .qlo-loader {
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.78);
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
        backdrop-filter: blur(2px);
      }

      .qlo-loader.qlo-hidden {
        display: none !important;
      }

      .qlo-spinner {
        width: 22px;
        height: 22px;
        border-radius: 999px;
        border: 3px solid rgba(37, 99, 235, 0.25);
        border-top-color: #2563eb;
        animation: qlo-spin 0.9s linear infinite;
      }

      @keyframes qlo-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .qlo-panel-textarea {
        width: 100%;
        min-height: 34px;
        max-height: 120px;
        resize: vertical;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid #cbd5e1;
        background: #fff;
        font: 12px/1.4 Consolas, "Courier New", monospace;
        outline: none;
      }

      .qlo-panel-textarea:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
      }
    `;

    document.head.appendChild(style);
  }

  function upgradeExistingToolPanel() {
    const actions = document.getElementById("coursera-tool-panel-actions");
    const panel = document.getElementById(TOOL_PANEL_ID);
    removeMenuHelpFromPage(actions);
    if (panel && actions) wireMenuActionHandlers(actions, panel);

    if (actions && !document.getElementById(FAST_QUIZ_STATUS_ID)) {
      const waitStatus = document.createElement("div");
      waitStatus.id = FAST_QUIZ_STATUS_ID;
      waitStatus.className = "qlo-hidden";
      actions.appendChild(waitStatus);
    }

    if (actions && !document.getElementById("coursera-qlo-row-skip")) {
      const row0 = document.createElement("div");
      row0.id = "coursera-qlo-row-skip";
      row0.className = "qlo-panel-row";

      const skipBtn = document.createElement("button");
      skipBtn.type = "button";
      skipBtn.className = "qlo-panel-btn";
      skipBtn.textContent = "Skip";
      skipBtn.addEventListener("click", async () => {
        skipBtn.disabled = true;
        try {
          await handleSkipVideoReading();
        } finally {
          skipBtn.disabled = false;
        }
      });

      row0.appendChild(skipBtn);
      const fastQuizBtn = document.createElement("button");
      fastQuizBtn.type = "button";
      fastQuizBtn.className = "qlo-panel-btn";
      fastQuizBtn.textContent = "Fast Quiz";
      fastQuizBtn.title = "Chạy Fast Quiz (auto vòng lặp)";

      fastQuizBtn.addEventListener("click", async () => {
        fastQuizBtn.disabled = true;
        try {
          await startFastQuizRun();
        } finally {
          fastQuizBtn.disabled = false;
        }
      });

      row0.appendChild(fastQuizBtn);
      actions.insertBefore(row0, actions.firstChild);
    }

    const row3 = document.getElementById(QUIZ_ROW_ACTIONS_ID);
    if (!row3) return;

    // Dọn nút GMN cũ nếu còn từ phiên bản trước.
    row3.querySelectorAll(".qlo-panel-btn").forEach((btn) => {
      const text = String(btn.textContent || "").trim().toLowerCase();
      if (text === "gmn") btn.remove();
    });

    if (row3.querySelector(".qlo-panel-btn")) return;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "qlo-panel-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      const quizData = extractFullQuizContent();
      if (!Array.isArray(quizData) || quizData.length === 0) {
        showToast("Không tìm thấy nội dung quiz để copy.");
        return;
      }
      const formatted = formatQuizForClipboard(quizData);
      try {
        await navigator.clipboard.writeText(formatted);
        showToast("Đã copy quiz vào clipboard");
      } catch {
        showToast("Không thể copy vào clipboard. Hãy thử lại.");
      }
    });

    const answersTextarea = document.getElementById(QUIZ_ANSWERS_TEXTAREA_ID);
    const pasteBtn = document.createElement("button");
    pasteBtn.type = "button";
    pasteBtn.className = "qlo-panel-btn";
    pasteBtn.textContent = "Paste";
    pasteBtn.addEventListener("click", async () => {
      if (!isQuizWorkingPage()) {
        showToast("Không ở trang làm bài. Hãy bấm Quiz để vào bài trước.");
        updateQuizEntryRowsVisibility();
        return;
      }

      const textareaText = answersTextarea?.value?.trim() || "";
      let sourceText = textareaText;

      if (!sourceText) {
        try {
          sourceText = (await navigator.clipboard.readText()).trim();
        } catch {
          showToast("Không đọc được clipboard. Hãy dán đáp án vào ô text.");
          return;
        }
      }

      if (!sourceText) {
        showToast("Ô đáp án trống và clipboard không có nội dung.");
        return;
      }

      pasteBtn.disabled = true;
      copyBtn.disabled = true;

      try {
        const answersMap = parseQuizAnswers(sourceText);
        if (answersMap.length === 0) {
          showToast("Không có đáp án hợp lệ. Ví dụ: 1. c hoặc 4. a,b");
          return;
        }

        await fillQuizAnswers({ answersMap });
        await autoSubmitAfterFill();
        if (answersTextarea) answersTextarea.value = "";
        updateQuizEntryRowsVisibility();
      } catch (err) {
        showToast(`Có lỗi xảy ra khi Paste: ${err?.message || String(err)}`);
      } finally {
        pasteBtn.disabled = false;
        copyBtn.disabled = false;
      }
    });

    row3.appendChild(copyBtn);
    row3.appendChild(pasteBtn);
  }

  function ensureToolPanel() {
    if (!document.body) return;
    const existing = document.getElementById(TOOL_PANEL_ID);
    if (existing) {
      ensureToolPanelStyles();
      upgradeExistingToolPanel();
      const toggleExisting = document.getElementById(TOOL_PANEL_TOGGLE_ID);
      applyPanelToggleIcon(toggleExisting);
      bindPanelDrag(existing, toggleExisting);
      bindToolKeyListener();
      return;
    }

    ensureToolPanelStyles();

    const panel = document.createElement("div");
    panel.id = TOOL_PANEL_ID;
    panel.className = "coursera-tool-panel";
    panel.style.position = "fixed";

    const loader = document.createElement("div");
    loader.id = "coursera-qlo-loader";
    loader.className = "qlo-loader qlo-hidden";
    loader.innerHTML = `<div class="qlo-spinner" aria-label="Loading"></div>`;
    panel.appendChild(loader);

    const actions = document.createElement("div");
    actions.id = "coursera-tool-panel-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.id = TOOL_PANEL_TOGGLE_ID;
    toggleBtn.type = "button";
    toggleBtn.setAttribute("aria-label", "Thu gọn/mở rộng menu");
    toggleBtn.title = "Thu gọn/mở rộng menu";
    applyPanelToggleIcon(toggleBtn);

    const jumpBtn = document.createElement("button");
    jumpBtn.type = "button";
    jumpBtn.className = "qlo-panel-btn";
    jumpBtn.textContent = "Nhảy";
    jumpBtn.addEventListener("click", jumpToIncomplete);

    const quizBtn = document.createElement("button");
    quizBtn.type = "button";
    quizBtn.className = "qlo-panel-btn";
    quizBtn.textContent = "Quiz";
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "qlo-panel-btn";
    skipBtn.textContent = "Skip";
    skipBtn.addEventListener("click", async () => {
      skipBtn.disabled = true;
      try {
        await handleSkipVideoReading();
      } finally {
        skipBtn.disabled = false;
      }
    });

    const fastQuizBtn = document.createElement("button");
    fastQuizBtn.type = "button";
    fastQuizBtn.className = "qlo-panel-btn";
    fastQuizBtn.textContent = "Fast Quiz";
    fastQuizBtn.title = "Nhảy tới Practice/Graded Assignment chưa tick";

    // Row 0: Skip + Fast Quiz
    const row0 = document.createElement("div");
    row0.id = "coursera-qlo-row-skip";
    row0.className = "qlo-panel-row";
    row0.appendChild(skipBtn);
    row0.appendChild(fastQuizBtn);

    const waitStatus = document.createElement("div");
    waitStatus.id = FAST_QUIZ_STATUS_ID;
    waitStatus.className = "qlo-hidden";

    // Row 1: luôn hiển thị
    const row1 = document.createElement("div");
    row1.className = "qlo-panel-row";
    row1.appendChild(jumpBtn);
    row1.appendChild(quizBtn);

    // Row 2: textarea (ẩn mặc định; chỉ hiện khi isQuizWorkingPage)
    const row2 = document.createElement("div");
    row2.id = QUIZ_ROW_ANSWERS_ID;
    row2.className = "qlo-panel-row quiz-entry-row qlo-hidden";

    const answersTextarea = document.createElement("textarea");
    answersTextarea.className = "qlo-panel-textarea";
    answersTextarea.id = QUIZ_ANSWERS_TEXTAREA_ID;
    answersTextarea.placeholder =
      "Dán đáp án theo format: 1. c\\n2. a\\n3. a,b\\n5. d";
    row2.appendChild(answersTextarea);

    // Row 3: Copy + Paste (ẩn mặc định; chỉ hiện khi isQuizWorkingPage)
    const row3 = document.createElement("div");
    row3.id = QUIZ_ROW_ACTIONS_ID;
    row3.className = "qlo-panel-row qlo-hidden";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "qlo-panel-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      const quizData = extractFullQuizContent();
      if (!Array.isArray(quizData) || quizData.length === 0) {
        showToast("Không tìm thấy nội dung quiz để copy.");
        return;
      }
      const formatted = formatQuizForClipboard(quizData);
      try {
        await navigator.clipboard.writeText(formatted);
        showToast("Đã copy quiz vào clipboard");
      } catch {
        showToast("Không thể copy vào clipboard. Hãy thử lại.");
      }
    });

    const pasteBtn = document.createElement("button");
    pasteBtn.type = "button";
    pasteBtn.className = "qlo-panel-btn";
    pasteBtn.textContent = "Paste";
    pasteBtn.addEventListener("click", async () => {
      if (!isQuizWorkingPage()) {
        showToast("Không ở trang làm bài. Hãy bấm Quiz để vào bài trước.");
        updateQuizEntryRowsVisibility();
        return;
      }

      const textareaText = answersTextarea.value?.trim() || "";
      let sourceText = textareaText;

      if (!sourceText) {
        try {
          sourceText = (await navigator.clipboard.readText()).trim();
        } catch {
          showToast("Không đọc được clipboard. Hãy dán đáp án vào ô text.");
          return;
        }
      }

      if (!sourceText) {
        showToast("Ô đáp án trống và clipboard không có nội dung.");
        return;
      }

      pasteBtn.disabled = true;
      copyBtn.disabled = true;

      try {
        await runPasteFlowFromText(sourceText, answersTextarea);
      } catch (err) {
        showToast(`Có lỗi xảy ra khi Paste: ${err?.message || String(err)}`);
      } finally {
        pasteBtn.disabled = false;
        copyBtn.disabled = false;
      }
    });

    row3.appendChild(copyBtn);
    row3.appendChild(pasteBtn);

    quizBtn.addEventListener("click", async () => {
      quizBtn.disabled = true;
      copyBtn.disabled = true;
      pasteBtn.disabled = true;
      try {
        await runQuizFeaturesFlow();
      } catch (err) {
        showToast(`Có lỗi khi chuẩn bị quiz: ${err?.message || String(err)}`);
        updateQuizEntryRowsVisibility();
      } finally {
        quizBtn.disabled = false;
        copyBtn.disabled = false;
        pasteBtn.disabled = false;
      }
    });

    fastQuizBtn.addEventListener("click", async () => {
      fastQuizBtn.disabled = true;
      try {
        await startFastQuizRun();
      } finally {
        fastQuizBtn.disabled = false;
      }
    });

    panelActionHandlers.jump = () => jumpToIncomplete();
    panelActionHandlers.quiz = async () => {
      if (!quizBtn.disabled) quizBtn.click();
    };
    panelActionHandlers.paste = async () => {
      if (!pasteBtn.disabled && !pasteBtn.classList.contains("qlo-hidden")) pasteBtn.click();
    };
    panelActionHandlers.skip = async () => {
      if (!skipBtn.disabled) skipBtn.click();
    };
    panelActionHandlers.fastQuiz = async () => {
      if (!fastQuizBtn.disabled) fastQuizBtn.click();
    };
    panelActionHandlers.stop = () => stopFastQuizRun();
    panelActionHandlers.togglePanel = () => panel.classList.toggle("collapsed");

    actions.appendChild(row0);
    actions.appendChild(waitStatus);
    actions.appendChild(row1);
    actions.appendChild(row2);
    actions.appendChild(row3);

    panel.appendChild(actions);
    panel.appendChild(toggleBtn);
    bindPanelDrag(panel, toggleBtn);
    bindToolKeyListener();

    document.body.appendChild(panel);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;

    if (message.type === "SET_HIDE_COMPLETED") {
      setHideCompletedEnabled(message.enabled);
      sendResponse?.({ ok: true });
      return;
    }

    if (message.action === "fillQuiz") {
      (async () => {
        try {
          await fillQuizAnswers({ answersMap: message.answersMap });
      sendResponse?.({ ok: true });
        } catch (err) {
          sendResponse?.({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    if (message.action === "getQuizContent") {
      const quizData = extractFullQuizContent();
      sendResponse({ quizData });
      return true;
    }

    if (message.action === "submitQuiz") {
      (async () => {
        try {
          await autoSubmitAfterFill();
          sendResponse?.({ ok: true });
        } catch (err) {
          sendResponse?.({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }
  });

  function init() {
    injectClbPageHook();
    attachClbClickInterceptor();
    attachClbMutationObserver();
    attachClbEventBridge();
    void clbHandleLockedStartPage();

    // Khôi phục run-id nếu có (để while có thể resume đúng).
    const storedAtBoot = getStoredRun();
    if (storedAtBoot?.id) {
      activeRunId = storedAtBoot.id;
    }

    // Dọn UI kẹt do SPA/reload.
    cleanupStaleUi();

    // Nếu đang rời trang/reload giữa chừng, chỉ dọn UI để tránh kẹt overlay.
    // Không cancel run vì Fast Quiz cần loop qua reload/trang khác cho tới khi bấm Dừng.
    window.addEventListener("beforeunload", () => cleanupStaleUi(), { once: true });
    window.addEventListener("pagehide", () => cleanupStaleUi(), { once: true });

    // Locked-start chỉ là trạm trung chuyển: không mount UI để tránh flicker.
    if (!isLockedStartPage()) {
      ensureToolPanel();
      observeMutations();
      watchQuizPageNavigation();
      updateQuizEntryRowsVisibility();
      try {
        const pendingCheck = sessionStorage.getItem("qlo_fast_quiz_pending_check") === "1";
        const pendingGradeCheck = sessionStorage.getItem(PENDING_GRADE_CHECK_KEY) === "1";
        const hashMarked = /\bqlo_fast_quiz=1\b/i.test(String(location.hash || ""));
        const enabled = isFastQuizEnabled();
        if (enabled) {
          showFastQuizOverlay();
          const stored = getStoredRun();
          const runId = stored?.id || startRun("fast_quiz");
          if (!stored?.id) {
            try {
              sessionStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify({ id: runId, kind: "fast_quiz", href: location.href }));
            } catch {
              // ignore
            }
          }
          activeRunId = runId;
          startFastQuizRealtimeStatus(runId);

          if (pendingCheck || hashMarked) {
            if (hashMarked) {
              const cleaned = String(location.hash || "").replace(/(^#|[&?])qlo_fast_quiz=1\b&?/i, "$1");
              const nextHash = cleaned.replace(/[&?]$/, "").replace(/^#&/, "#");
              history.replaceState(history.state, "", location.pathname + location.search + nextHash);
            }
            window.setTimeout(() => {
              void runFastQuizCycle(runId);
            }, 900);
          } else {
            setFastQuizWaitStatus("Fast Quiz: sẵn sàng (bấm Fast Quiz để chạy)...", "waiting");
          }
        }
        if (pendingGradeCheck) {
          // Cơ chế mới: không while chờ điểm nữa. Xóa pending cũ để tránh treo.
          sessionStorage.removeItem(PENDING_GRADE_CHECK_KEY);
        }
      } catch {
        // ignore
      }
    }

    // Áp trạng thái trong phiên (giữ qua reload/tab switch trong cùng session).
    try {
      chrome.storage.session.get(SESSION_KEY, (res) => {
        const nextEnabled = !!(res && res[SESSION_KEY]);
        setHideCompletedEnabled(nextEnabled);
      });
    } catch {
      setHideCompletedEnabled(false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

