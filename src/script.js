(() => {
  try {
    // Fake locking browser user agent (best-effort, may be ignored by some browsers)
    const fakeUA = "coursera-locking-browser/0.6.3";
    try {
      Object.defineProperty(navigator, "userAgent", {
        get() {
          try {
            const orig = navigator.__qloOrigUA || "";
            return `${orig} ${fakeUA}`;
          } catch {
            return fakeUA;
          }
        },
        configurable: true,
      });
    } catch {
      // ignore if cannot redefine
    }

    const originalOpen = window.open;

    function isSubmissionStartOrComplete(url) {
      if (!url || typeof url !== "string") return false;
      const lower = url.toLowerCase();
      return lower.includes("submission-start") || lower.includes("submission-complete");
    }

    function isCourseraLockScheme(url) {
      if (!url || typeof url !== "string") return false;
      return /^coursera-lock:\/\//i.test(url);
    }

    function dispatchBypassEvent(url) {
      try {
        window.dispatchEvent(
          new CustomEvent("BypassCoursera_Intercept", {
            detail: url,
          })
        );
      } catch {
        // ignore
      }
    }

    function fakeWindowHandle() {
      return {
        closed: false,
        close() {
          this.closed = true;
        },
        focus() {},
      };
    }

    window.open = function qloClbWindowOpen(url, ...args) {
      try {
        const str = typeof url === "string" ? url : String(url || "");
        if (isSubmissionStartOrComplete(str)) {
          return null;
        }
        if (isCourseraLockScheme(str)) {
          dispatchBypassEvent(str);
          return fakeWindowHandle();
        }
      } catch {
        // fall through to original
      }

      try {
        return originalOpen.apply(this, [url, ...args]);
      } catch (err) {
        // As a last resort, just ignore
        return null;
      }
    };
  } catch {
    // swallow any page-hook errors to avoid breaking Coursera
  }
})();

