const YTAudio = {};

(() => {
  "use strict";

  const AUDIO_FORMAT_SCORE = new Map([[258, 0], [256, 1], [251, 2], [250, 3], [249, 4], [141, 5], [140, 6], [139, 7], [171, 8]]);

  const PLAYER_CLIENTS = [
    {
      client: {
        clientName: "ANDROID_VR",
        clientVersion: "1.65.10",
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        androidSdkVersion: 32,
        userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
        osName: "Android",
        osVersion: "12L"
      }
    },
    {
      client: {
        clientName: "ANDROID",
        clientVersion: "20.10.38",
        userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
        osName: "Android",
        osVersion: "11"
      },
      thirdParty: {
        embedUrl: "https://www.youtube.com"
      },
      racyCheckOk: true,
      contentCheckOk: true
    }
  ];

  YTAudio.config = {
    PLAYER_ENDPOINT: "https://www.youtube.com/youtubei/v1/player",
    FALLBACK_API_KEY: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
    BUTTON_ID: "yt-audio-only-toggle",
    PLAYER_BUTTON_CLASS: "yt-audio-player-button",
    QUALITY_ATTRIBUTE: "data-yt-audio-quality-hidden",
    VISIBILITY_ATTRIBUTE: "data-yt-audio-enabled",
    AUDIO_URL_CACHE_LIMIT: 8,
    AUDIO_URL_CACHE_TTL_MS: 1200000,
    AUDIO_URL_EXPIRY_SAFETY_MS: 60000,
    PREFETCH_VIDEO_LIMIT: 2,
    PREFETCH_INTERVAL_MS: 10000,
    AUDIO_FORMAT_SCORE,
    PLAYER_CLIENTS
  };
})();