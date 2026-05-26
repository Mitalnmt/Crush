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

  const JUMP_BUTTON_ID = "coursera-jump-button";
  const TOAST_ID = "coursera-qlo-toast";

  let hideCompletedEnabled = false;
  const hiddenLis = new Set();
  let observer = null;

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

  function showToast(message) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.textContent = message;
    toast.style.position = "fixed";
    toast.style.right = "20px";
    toast.style.bottom = "20px";
    toast.style.zIndex = "10000";
    toast.style.maxWidth = "70vw";
    toast.style.padding = "10px 12px";
    toast.style.borderRadius = "10px";
    toast.style.background = "rgba(17, 24, 39, 0.95)";
    toast.style.color = "#fff";
    toast.style.fontSize = "13px";
    toast.style.boxShadow = "0 10px 30px rgba(0,0,0,0.25)";
    toast.style.pointerEvents = "none";

    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3000);
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

  function sortByDocumentOrder(elements) {
    return elements.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function findAllQuestionGroups() {
    const found = new Set();

    const stableSelectors = [
      'div[role="group"][data-testid*="MultipleChoiceQuestion"]',
      'div[role="group"][data-testid*="CheckboxQuestion"]',
    ];

    for (const selector of stableSelectors) {
      document.querySelectorAll(selector).forEach((el) => found.add(el));
    }

    if (found.size === 0) {
      document.querySelectorAll('div[role="group"]').forEach((group) => {
        const hasRadio =
          group.querySelector('input[type="radio"], div[role="radiogroup"], [role="radiogroup"]');
        const hasCheckbox = group.querySelector('input[type="checkbox"]');
        if (hasRadio || hasCheckbox) found.add(group);
      });
    }

    return sortByDocumentOrder(Array.from(found));
  }

  function getQuestionType(group) {
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
      if (!Array.isArray(entry.answers) || entry.answers.length === 0) continue;
      lookup.set(entry.questionIndex, entry.answers);
    }
    return lookup;
  }

  function fillOneQuestion(group, answers, type) {
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
      const answers = lookup.get(questionIndex);
      if (!answers) continue;

      const group = groups[i];
      const type = getQuestionType(group);
      if (type === "unknown") continue;

      try {
        if (fillOneQuestion(group, answers, type)) filled += 1;
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

  function ensureJumpButton() {
    if (!document.body) return;
    if (document.getElementById(JUMP_BUTTON_ID)) return;

    const btn = document.createElement("button");
    btn.id = JUMP_BUTTON_ID;
    btn.type = "button";
    btn.textContent = "Nhảy";

    btn.style.position = "fixed";
    btn.style.left = "20px";
    btn.style.bottom = "20px";
    btn.style.zIndex = "9999";
    btn.style.border = "none";
    btn.style.borderRadius = "999px";
    btn.style.padding = "10px 14px";
    btn.style.background = "#2563eb";
    btn.style.color = "#fff";
    btn.style.fontWeight = "700";
    btn.style.fontSize = "13px";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 10px 24px rgba(37, 99, 235, 0.35)";

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "translateY(-1px)";
      btn.style.boxShadow = "0 14px 30px rgba(37, 99, 235, 0.45)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "";
      btn.style.boxShadow = "0 10px 24px rgba(37, 99, 235, 0.35)";
    });
    btn.addEventListener("click", jumpToIncomplete);

    document.body.appendChild(btn);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;

    if (message.type === "SET_HIDE_COMPLETED") {
      setHideCompletedEnabled(message.enabled);
      sendResponse?.({ ok: true });
      return;
    }

    if (message.action === "fillQuiz") {
      fillQuizAnswers({ answersMap: message.answersMap });
      sendResponse?.({ ok: true });
      return;
    }

    if (message.action === "getQuizContent") {
      const quizData = extractFullQuizContent();
      sendResponse({ quizData });
      return true;
    }
  });

  function init() {
    ensureJumpButton();
    observeMutations();

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

