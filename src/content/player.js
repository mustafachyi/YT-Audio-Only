(() => {
  "use strict";

  const NATIVE_SIGNAL_EVENTS = ["videodatachange", "onVideoDataChange", "onStateChange"];
  const AUDIO_PLAYBACK_MEMORY_TTL_MS = 8000;
  const USER_GESTURE_PLAYBACK_WINDOW_MS = 1500;
  const BLOCKED_PLAYBACK_RETRY_MS = 2500;

  let nativePlayer = null;
  let nativeSignalHandler = null;
  let nativeSignalBridge = null;
  let activeAudioModeVideoId = "";
  let activeAudioModePromise = null;
  let audioModeRequestId = 0;
  let cachedVideo = null;
  let cachedPlaybackRate = 1;
  let rememberedAudioVideoId = "";
  let rememberedAudioPlaybackTime = 0;
  let rememberedAudioPlaybackTimestamp = 0;
  let rememberedAudioShouldResume = false;
  let blockedPlaybackVideoId = "";
  let blockedPlaybackTimestamp = 0;
  let lastUserGestureTime = 0;

  async function applyAudioMode(preservePlaybackTime) {
    const state = YTAudio.state;
    const ui = YTAudio.ui;
    const videoId = state.videoId || readVideoId();
    const shouldPreservePlaybackTime = preservePlaybackTime !== false;

    if (!videoId || !state.enabled) {
      return;
    }

    state.videoId = videoId;
    ui.updateAudioThumbnail(videoId);

    const video = getVideoElement();

    if (video && state.audioUrl && isMediaSourceApplied(video, state.audioUrl)) {
      rememberAudioPlaybackStateFromMedia(videoId, video);
      restorePlaybackRate(video);
      if ((state.shouldResumePlayback || shouldResumeRememberedAudioPlayback(videoId)) && video.paused) {
        const played = await resumeAudioPlayback(video, videoId, true);
        state.shouldResumePlayback = !played;
      }
      return;
    }

    if (activeAudioModePromise && activeAudioModeVideoId === videoId) {
      return activeAudioModePromise;
    }

    guardNativeVideo();

    const requestId = ++audioModeRequestId;
    const promise = applyAudioModeForVideo(videoId, shouldPreservePlaybackTime, requestId);
    activeAudioModeVideoId = videoId;
    activeAudioModePromise = promise;

    try {
      await promise;
    } finally {
      if (activeAudioModePromise === promise) {
        activeAudioModeVideoId = "";
        activeAudioModePromise = null;
      }
    }
  }

  async function applyAudioModeForVideo(videoId, preservePlaybackTime, requestId) {
    const state = YTAudio.state;
    const api = YTAudio.api;
    const initialVideo = getVideoElement();

    if (!initialVideo || !isAudioModeRequestCurrent(videoId, requestId)) {
      return;
    }

    if (state.audioUrl && isMediaSourceApplied(initialVideo, state.audioUrl)) {
      rememberAudioPlaybackStateFromMedia(videoId, initialVideo);
      restorePlaybackRate(initialVideo);
      return;
    }

    const playbackTime = resolvePlaybackTime(initialVideo, videoId, preservePlaybackTime);
    const shouldPlay = resolveShouldPlay(initialVideo, videoId);

    guardNativeVideo();

    const audioUrl = await api.resolveAudioUrl(videoId);

    if (!audioUrl || !isAudioModeRequestCurrent(videoId, requestId)) {
      return;
    }

    state.audioUrl = audioUrl;

    const video = getVideoElement();

    if (!video || !isAudioModeRequestCurrent(videoId, requestId)) {
      return;
    }

    await switchMediaSource(video, audioUrl, videoId, playbackTime, shouldPlay, requestId);
  }

  async function switchMediaSource(video, url, videoId, playbackTime, shouldPlay, requestId) {
    const state = YTAudio.state;
    const utils = YTAudio.utils;

    if (!isAudioModeRequestCurrent(videoId, requestId) || state.audioUrl !== url) {
      return;
    }

    if (isMediaSourceApplied(video, url)) {
      rememberAudioPlaybackStateFromMedia(videoId, video);
      restorePlaybackRate(video);
      if (shouldPlay && video.paused) {
        const played = await resumeAudioPlayback(video, videoId, true);
        state.shouldResumePlayback = !played;
      } else {
        state.shouldResumePlayback = false;
      }
      return;
    }

    const currentSourceUrl = video.currentSrc || video.src;

    if (!state.sourceUrl && shouldCacheSourceUrl(currentSourceUrl, url)) {
      state.sourceUrl = currentSourceUrl;
    }

    try {
      if (!video.paused) {
        video.pause();
      }
      video.src = url;
      video.load();
    } catch (error) {
      return;
    }

    await utils.waitForEvent(video, "loadedmetadata", 1500);

    if (!isAudioModeRequestCurrent(videoId, requestId) || state.audioUrl !== url) {
      return;
    }

    try {
      const normalizedPlaybackTime = normalizePlaybackTime(playbackTime);
      if (normalizedPlaybackTime > 0) {
        video.currentTime = normalizedPlaybackTime;
      }
      restorePlaybackRate(video);
    } catch (error) {
      return;
    }

    if (!isAudioModeRequestCurrent(videoId, requestId) || state.audioUrl !== url) {
      return;
    }

    if (shouldPlay) {
      const played = await resumeAudioPlayback(video, videoId, true);
      state.shouldResumePlayback = !played;
    } else {
      state.shouldResumePlayback = false;
    }

    if (isMediaSourceApplied(video, url)) {
      rememberAudioPlaybackStateFromMedia(videoId, video);
    }
  }

  async function restoreVideoMode() {
    audioModeRequestId += 1;
    activeAudioModeVideoId = "";
    activeAudioModePromise = null;

    const state = YTAudio.state;
    const utils = YTAudio.utils;
    const ui = YTAudio.ui;

    ui.restoreQualityMenuItems();

    const video = getVideoElement();
    const videoId = state.videoId;
    const shouldPlay = video ? state.shouldResumePlayback || !video.paused || shouldResumeRememberedAudioPlayback(videoId) : true;
    const currentTime = resolvePlaybackTime(video, videoId, true);
    const player = getYouTubePlayer();
    const sourceUrl = state.sourceUrl;

    state.audioUrl = "";
    state.shouldResumePlayback = false;
    clearRememberedAudioPlaybackState();

    if (video) {
      restorePlaybackRate(video);
    }

    if (player && videoId && restoreNativePlayerSource(player, videoId, currentTime, shouldPlay)) {
      state.sourceUrl = "";
      return;
    }

    if (!video || !sourceUrl || isAudioOnlySource(sourceUrl)) {
      return;
    }

    try {
      if (!video.paused) {
        video.pause();
      }
      video.src = sourceUrl;
      video.load();
    } catch (error) {
      return;
    }

    await utils.waitForEvent(video, "loadedmetadata", 1500);

    try {
      video.currentTime = currentTime;
      state.sourceUrl = "";
    } catch (error) {
      return;
    }

    if (shouldPlay) {
      await resumeVideoPlayback(video, videoId, true);
    }
  }

  function restoreNativePlayerSource(player, videoId, currentTime, shouldPlay) {
    try {
      if (shouldPlay && typeof player.loadVideoById === "function") {
        player.loadVideoById(videoId, currentTime);
        restorePlaybackState(player, videoId, true);
        return true;
      }

      if (!shouldPlay && typeof player.cueVideoById === "function") {
        player.cueVideoById(videoId, currentTime);
        return true;
      }

      if (typeof player.loadVideoById === "function") {
        player.loadVideoById(videoId, currentTime);
        if (shouldPlay) {
          restorePlaybackState(player, videoId, true);
        } else {
          pauseNativePlayerAfterRestore(player, videoId);
        }
        return true;
      }
    } catch (error) {
      return false;
    }

    return false;
  }

  function pauseNativePlayerAfterRestore(player, videoId) {
    setTimeout(() => {
      if (YTAudio.state.enabled || YTAudio.state.videoId !== videoId) {
        return;
      }

      try {
        if (typeof player.pauseVideo === "function") {
          player.pauseVideo();
        }
      } catch (error) {
        return;
      }
    }, 0);
  }

  function clearAudioMode() {
    const state = YTAudio.state;
    const audioUrl = state.audioUrl;

    audioModeRequestId += 1;
    activeAudioModeVideoId = "";
    activeAudioModePromise = null;
    state.videoId = "";
    state.audioUrl = "";
    state.sourceUrl = "";
    state.shouldResumePlayback = false;
    clearRememberedAudioPlaybackState();
    clearExtensionOwnedAudioSources(audioUrl);
    cachedVideo = null;
  }

  function clearExtensionOwnedAudioSources(audioUrl) {
    const videos = new Set();

    if (cachedVideo) {
      videos.add(cachedVideo);
    }

    for (const video of document.querySelectorAll("video")) {
      videos.add(video);
    }

    for (const video of videos) {
      clearExtensionOwnedAudioSource(video, audioUrl);
    }
  }

  function clearExtensionOwnedAudioSource(video, audioUrl) {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }

    restorePlaybackRate(video);

    if (!isExtensionOwnedAudioSource(video, audioUrl)) {
      return;
    }

    try {
      if (!video.paused) {
        video.pause();
      }
      video.removeAttribute("src");
      video.load();
    } catch (error) {
      return;
    }
  }

  function guardNativeVideo() {
    const state = YTAudio.state;

    if (!state.enabled) {
      return;
    }

    const video = getVideoElement();

    if (!video) {
      return;
    }

    if (state.audioUrl && isMediaSourceApplied(video, state.audioUrl)) {
      rememberAudioPlaybackStateFromMedia(state.videoId || readVideoId(), video);
      restorePlaybackRate(video);
      return;
    }

    if (state.audioUrl && isClearedAudioSource(video, state.audioUrl)) {
      if (shouldResumeRememberedAudioPlayback(state.videoId)) {
        state.shouldResumePlayback = true;
      }
      return;
    }

    if (!video.paused) {
      state.shouldResumePlayback = true;
      try {
        video.pause();
      } catch (error) {
        return;
      }
    }

    if (video.playbackRate !== 0) {
      cachePlaybackRate(video);
      try {
        video.playbackRate = 0;
      } catch (error) {
        return;
      }
    }
  }

  function haltNativePlayer() {
    const player = getYouTubePlayer();
    if (player && typeof player.stopVideo === "function") {
      try {
        player.stopVideo();
      } catch (error) {
        return;
      }
    }
  }

  function bindNativeSignals(handler) {
    const player = getYouTubePlayer();

    if (!player || typeof player.addEventListener !== "function") {
      unbindNativeSignals();
      return;
    }

    if (nativePlayer === player && nativeSignalHandler === handler) {
      return;
    }

    unbindNativeSignals();

    nativePlayer = player;
    nativeSignalHandler = handler;
    nativeSignalBridge = createNativeSignalBridge(handler);

    for (const eventName of NATIVE_SIGNAL_EVENTS) {
      try {
        player.addEventListener(eventName, nativeSignalBridge);
      } catch (error) {
        continue;
      }
    }
  }

  function unbindNativeSignals() {
    if (nativePlayer && nativeSignalBridge && typeof nativePlayer.removeEventListener === "function") {
      for (const eventName of NATIVE_SIGNAL_EVENTS) {
        try {
          nativePlayer.removeEventListener(eventName, nativeSignalBridge);
        } catch (error) {
          continue;
        }
      }
    }

    nativePlayer = null;
    nativeSignalHandler = null;
    nativeSignalBridge = null;
  }

  function createNativeSignalBridge(handler) {
    try {
      if (typeof exportFunction === "function") {
        return exportFunction(() => {
          handler();
        }, window);
      }
    } catch (error) {
      return handler;
    }
    return handler;
  }

  function captureSettingsInteraction() {
    rememberAudioPlaybackState();
  }

  function recordUserGesture() {
    lastUserGestureTime = performance.now();
  }

  function rememberAudioPlaybackState() {
    const state = YTAudio.state;

    if (!state.enabled || !state.audioUrl) {
      return;
    }

    const videoId = state.videoId || readVideoId();
    const video = getVideoElement();

    if (!video || !videoId || !isMediaSourceApplied(video, state.audioUrl)) {
      return;
    }

    rememberAudioPlaybackStateFromMedia(videoId, video);
  }

  function rememberAudioPlaybackStateFromMedia(videoId, media) {
    if (!videoId || !media) {
      return;
    }

    const playbackTime = getPlaybackTime(media, videoId);

    rememberedAudioVideoId = videoId;
    rememberedAudioPlaybackTime = Number.isFinite(playbackTime) ? Math.max(0, playbackTime) : 0;
    rememberedAudioPlaybackTimestamp = performance.now();
    rememberedAudioShouldResume = !media.paused || YTAudio.state.shouldResumePlayback;
    cachePlaybackRate(media);
  }

  function clearRememberedAudioPlaybackState() {
    rememberedAudioVideoId = "";
    rememberedAudioPlaybackTime = 0;
    rememberedAudioPlaybackTimestamp = 0;
    rememberedAudioShouldResume = false;
    blockedPlaybackVideoId = "";
    blockedPlaybackTimestamp = 0;
  }

  async function resumePlaybackAfterUserGesture() {
    const state = YTAudio.state;

    if (!state.enabled || !state.shouldResumePlayback || !state.audioUrl) {
      return;
    }

    const videoId = state.videoId || readVideoId();
    const video = getVideoElement();

    if (!video || !videoId || !isMediaSourceApplied(video, state.audioUrl)) {
      return;
    }

    const played = await resumeAudioPlayback(video, videoId, true);
    state.shouldResumePlayback = !played;
  }

  async function resumeAudioPlayback(media, videoId, allowContinuation) {
    return resumeMediaPlayback(media, videoId, allowContinuation, true);
  }

  async function resumeVideoPlayback(media, videoId, allowContinuation) {
    return resumeMediaPlayback(media, videoId, allowContinuation, false);
  }

  async function resumeMediaPlayback(media, videoId, allowContinuation, shouldRememberAudioState) {
    if (!shouldAttemptMediaPlayback(videoId, allowContinuation)) {
      return false;
    }

    const played = await safePlay(media);

    if (played) {
      clearBlockedPlayback(videoId);
      if (shouldRememberAudioState) {
        rememberAudioPlaybackStateFromMedia(videoId, media);
      }
    } else {
      rememberBlockedPlayback(videoId);
    }

    return played;
  }

  function shouldAttemptMediaPlayback(videoId, allowContinuation) {
    if (!videoId) {
      return false;
    }
    if (isRecentUserGesture()) {
      return true;
    }
    if (!allowContinuation) {
      return false;
    }
    if (blockedPlaybackVideoId === videoId && performance.now() - blockedPlaybackTimestamp < BLOCKED_PLAYBACK_RETRY_MS) {
      return false;
    }
    return true;
  }

  function isRecentUserGesture() {
    return performance.now() - lastUserGestureTime <= USER_GESTURE_PLAYBACK_WINDOW_MS;
  }

  function rememberBlockedPlayback(videoId) {
    blockedPlaybackVideoId = videoId || "";
    blockedPlaybackTimestamp = performance.now();
  }

  function clearBlockedPlayback(videoId) {
    if (!videoId || blockedPlaybackVideoId === videoId) {
      blockedPlaybackVideoId = "";
      blockedPlaybackTimestamp = 0;
    }
  }

  function restorePlaybackState(player, videoId, shouldPlay) {
    if (!shouldPlay || !shouldAttemptMediaPlayback(videoId, true)) {
      return;
    }

    setTimeout(() => {
      if (YTAudio.state.enabled || YTAudio.state.videoId !== videoId) {
        return;
      }

      try {
        if (typeof player.playVideo === "function") {
          player.playVideo();
          clearBlockedPlayback(videoId);
        }
      } catch (error) {
        rememberBlockedPlayback(videoId);
      }
    }, 0);
  }

  function resolvePlaybackTime(media, videoId, preservePlaybackTime) {
    if (!preservePlaybackTime) {
      return readStartTimeFromUrl(videoId);
    }

    const rememberedPlaybackTime = readRememberedPlaybackTime(videoId);

    if (rememberedPlaybackTime > 0) {
      return rememberedPlaybackTime;
    }

    return getPlaybackTime(media, videoId);
  }

  function resolveShouldPlay(media, videoId) {
    const state = YTAudio.state;
    return state.shouldResumePlayback || Boolean(media && !media.paused) || shouldResumeRememberedAudioPlayback(videoId);
  }

  function readRememberedPlaybackTime(videoId) {
    if (!isRememberedAudioPlaybackValid(videoId)) {
      return 0;
    }
    return rememberedAudioPlaybackTime;
  }

  function shouldResumeRememberedAudioPlayback(videoId) {
    return isRememberedAudioPlaybackValid(videoId) && rememberedAudioShouldResume;
  }

  function isRememberedAudioPlaybackValid(videoId) {
    return Boolean(videoId && rememberedAudioVideoId === videoId && rememberedAudioPlaybackTimestamp > 0 && performance.now() - rememberedAudioPlaybackTimestamp <= AUDIO_PLAYBACK_MEMORY_TTL_MS);
  }

  function getPlaybackTime(media, videoId) {
    if (media && Number.isFinite(media.currentTime)) {
      return Math.max(0, media.currentTime);
    }
    const player = getYouTubePlayer();
    if (player && typeof player.getCurrentTime === "function") {
      try {
        const time = player.getCurrentTime();
        return Number.isFinite(time) ? Math.max(0, time) : 0;
      } catch (error) {
        return 0;
      }
    }
    return 0;
  }

  function readStartTimeFromUrl(videoId) {
    if (YTAudio.utils.readVideoIdFromUrl(location.href) !== videoId) {
      return 0;
    }
    const parameters = new URLSearchParams(location.search);
    return parseTimeParameter(parameters.get("t") || parameters.get("start") || "");
  }

  function parseTimeParameter(value) {
    if (!value) {
      return 0;
    }
    const text = value.trim().toLowerCase();
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      return normalizePlaybackTime(Number(text));
    }
    let time = 0;
    let cursor = 0;
    let matched = false;
    const pattern = /(\d+(?:\.\d+)?)(h|m|s)/g;
    for (const match of text.matchAll(pattern)) {
      if (match.index !== cursor) {
        return 0;
      }
      const amount = Number(match[1]);
      if (!Number.isFinite(amount)) {
        return 0;
      }
      matched = true;
      cursor = match.index + match[0].length;
      if (match[2] === "h") {
        time += amount * 3600;
      } else if (match[2] === "m") {
        time += amount * 60;
      } else {
        time += amount;
      }
    }
    return matched && cursor === text.length ? normalizePlaybackTime(time) : 0;
  }

  function normalizePlaybackTime(value) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  async function safePlay(media) {
    try {
      await media.play();
      return true;
    } catch (error) {
      return false;
    }
  }

  function cachePlaybackRate(media) {
    const playbackRate = media.playbackRate;
    if (Number.isFinite(playbackRate) && playbackRate > 0) {
      cachedPlaybackRate = playbackRate;
    }
  }

  function restorePlaybackRate(media) {
    if (!media || media.playbackRate !== 0) {
      return;
    }
    try {
      media.playbackRate = cachedPlaybackRate || 1;
    } catch (error) {
      return;
    }
  }

  function isMediaSourceApplied(media, url) {
    if (!media || !url) {
      return false;
    }
    if (media.src === url) {
      return true;
    }
    if (media.currentSrc !== url || !media.src) {
      return false;
    }
    return media.readyState > media.HAVE_NOTHING && media.networkState !== media.NETWORK_EMPTY;
  }

  function isClearedAudioSource(video, url) {
    return Boolean(video && url && video.currentSrc === url && !video.src && video.readyState === video.HAVE_NOTHING);
  }

  function isExtensionOwnedAudioSource(video, audioUrl) {
    if (!video) {
      return false;
    }

    const sources = [video.src, video.currentSrc];

    if (audioUrl && sources.includes(audioUrl)) {
      return true;
    }

    return sources.some(isExtensionProfileAudioSource);
  }

  function isExtensionProfileAudioSource(value) {
    const source = readGoogleVideoAudioSource(value);

    if (!source) {
      return false;
    }

    const client = source.searchParams.get("c");

    return client === "ANDROID_VR" || client === "ANDROID";
  }

  function shouldCacheSourceUrl(sourceUrl, nextAudioUrl) {
    return Boolean(sourceUrl && sourceUrl !== nextAudioUrl && !sourceUrl.startsWith("data:") && !isAudioOnlySource(sourceUrl));
  }

  function isAudioOnlySource(value) {
    return Boolean(readGoogleVideoAudioSource(value));
  }

  function readGoogleVideoAudioSource(value) {
    try {
      const url = new URL(value, location.href);

      if (url.hostname !== "googlevideo.com" && !url.hostname.endsWith(".googlevideo.com")) {
        return null;
      }

      if (!(url.searchParams.get("mime") || "").startsWith("audio")) {
        return null;
      }

      return url;
    } catch (error) {
      return null;
    }
  }

  function isAudioModeRequestCurrent(videoId, requestId) {
    const state = YTAudio.state;
    return Boolean(state.enabled && state.videoId === videoId && audioModeRequestId === requestId);
  }

  function getVideoElement() {
    if (cachedVideo && cachedVideo.isConnected) {
      return cachedVideo;
    }
    cachedVideo = document.querySelector("video.html5-main-video, video.video-stream, video");
    return cachedVideo;
  }

  function readVideoId() {
    return YTAudio.utils.readVideoIdFromUrl(location.href);
  }

  function getYouTubePlayer() {
    const player = document.getElementById("movie_player");
    if (!player) {
      return null;
    }
    try {
      return player.wrappedJSObject || player;
    } catch (error) {
      return player;
    }
  }

  YTAudio.player = {
    applyAudioMode,
    bindNativeSignals,
    unbindNativeSignals,
    captureSettingsInteraction,
    clearAudioMode,
    guardNativeVideo,
    haltNativePlayer,
    rememberAudioPlaybackState,
    recordUserGesture,
    restoreVideoMode,
    resumePlaybackAfterUserGesture
  };
})();