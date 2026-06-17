(() => {
  "use strict";

  function normalizeText(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isYouTubeHost(hostname) {
    return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
  }

  function readVideoIdFromUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (!isYouTubeHost(url.hostname)) {
        return "";
      }
      if (url.pathname === "/watch") {
        return url.searchParams.get("v") || "";
      }
      if (url.pathname.startsWith("/embed/")) {
        return url.pathname.split("/")[2] || "";
      }
      return "";
    } catch (error) {
      return "";
    }
  }

  function waitForEvent(target, eventName, timeout) {
    return new Promise((resolve) => {
      let timer = 0;
      const done = () => {
        clearTimeout(timer);
        target.removeEventListener(eventName, done, true);
        resolve();
      };
      timer = setTimeout(done, timeout);
      target.addEventListener(eventName, done, { once: true, capture: true });
    });
  }

  function stopEvent(event) {
    event.stopImmediatePropagation();
  }

  YTAudio.utils = {
    normalizeText,
    escapeRegExp,
    readVideoIdFromUrl,
    waitForEvent,
    stopEvent
  };
})();