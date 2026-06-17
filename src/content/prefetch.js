(() => {
  "use strict";

  const CANDIDATE_QUERIES = [
    { selector: "a.ytp-next-button", scanLimit: 20 },
    { selector: ".ytp-next-button[href]", scanLimit: 20 },
    { selector: "ytd-playlist-panel-video-renderer a[href*='/watch?v=']", scanLimit: 20 },
    { selector: "ytd-compact-video-renderer a[href*='/watch?v=']", scanLimit: 20 },
    { selector: "ytd-watch-next-secondary-results-renderer a[href*='/watch?v=']", scanLimit: 20 },
    { selector: "a[href*='/watch?v='][aria-label]", scanLimit: 8 }
  ];

  let lastPrefetchVideoId = "";
  let lastPrefetchTime = 0;

  function prefetchUpcomingAudio(currentVideoId) {
    const state = YTAudio.state;
    const config = YTAudio.config;
    const api = YTAudio.api;

    if (!state.ready || !state.enabled || !currentVideoId) {
      return;
    }

    const now = performance.now();

    if (currentVideoId === lastPrefetchVideoId && now - lastPrefetchTime < config.PREFETCH_INTERVAL_MS) {
      return;
    }

    lastPrefetchVideoId = currentVideoId;
    lastPrefetchTime = now;

    for (const videoId of collectCandidateVideoIds(currentVideoId, config.PREFETCH_VIDEO_LIMIT)) {
      api.prefetchAudioUrl(videoId);
    }
  }

  function collectCandidateVideoIds(currentVideoId, resultLimit) {
    const videoIds = [];
    const seenVideoIds = new Set();

    if (currentVideoId) {
      seenVideoIds.add(currentVideoId);
    }

    for (const query of CANDIDATE_QUERIES) {
      const elements = document.querySelectorAll(query.selector);

      for (let index = 0; index < elements.length && index < query.scanLimit && videoIds.length < resultLimit; index += 1) {
        addCandidateVideoId(videoIds, seenVideoIds, readVideoIdFromElement(elements[index]));
      }

      if (videoIds.length >= resultLimit) {
        return videoIds;
      }
    }

    return videoIds;
  }

  function addCandidateVideoId(videoIds, seenVideoIds, videoId) {
    if (!videoId || seenVideoIds.has(videoId)) {
      return;
    }

    seenVideoIds.add(videoId);
    videoIds.push(videoId);
  }

  function readVideoIdFromElement(element) {
    const anchor = element instanceof HTMLAnchorElement ? element : element.closest("a[href]");

    if (!anchor) {
      return "";
    }

    return YTAudio.utils.readVideoIdFromUrl(anchor.href || anchor.getAttribute("href") || "");
  }

  YTAudio.prefetch = {
    prefetchUpcomingAudio
  };
})();