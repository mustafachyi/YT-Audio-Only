(() => {
  "use strict";

  YTAudio.state = {
    enabled: false,
    ready: false,
    videoId: "",
    audioUrl: "",
    sourceUrl: "",
    visitorData: "",
    innertubeApiKey: "",
    decipherSourceUrl: "",
    decipherPlan: null,
    audioUrlCache: new Map(),
    audioUrlRequestCache: new Map(),
    button: null,
    tooltip: null,
    thumbnail: null,
    thumbnailVideoId: "",
    scheduled: false,
    syncTimer: 0,
    shouldResumePlayback: false,
    navigating: false
  };
})();