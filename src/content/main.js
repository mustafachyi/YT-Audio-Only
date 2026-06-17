(() => {
  "use strict";

  const browserApi = typeof browser !== "undefined" ? browser : chrome;
  const PASSIVE_CAPTURE_OPTIONS = { capture: true, passive: true };
  const NAVIGATION_SIGNAL_EVENTS = ["yt-navigate-finish", "yt-page-data-updated"];
  const MEDIA_ACTIVITY_EVENTS = ["emptied", "loadstart", "play", "playing"];
  const CONTROL_PORT_NAME = "ytAudioOnlyControl";
  const MESSAGE_TYPE_SYNC_NETWORK_RULES = "syncNetworkRules";
  const TAB_ENABLED_SESSION_KEY = "ytAudioOnlyTabEnabled";
  const CONTROL_RECONNECT_DELAY_MS = 500;
  const NAVIGATION_TIMEOUT_MS = 4000;

  let pendingNavigationVideoId = "";
  let lastNetworkRuleActive = null;
  let lastServiceWorkerResetVideoId = "";
  let controlPort = null;
  let controlReconnectTimer = 0;
  let navigationTimeoutTimer = 0;
  let isTopFrame = true;

  try {
    isTopFrame = window.top === window;
  } catch (error) {
    isTopFrame = false;
  }

  function boot() {
    const state = YTAudio.state;

    state.enabled = readStoredTabEnabledState();
    state.ready = true;

    connectControlPort();
    bindEvents();
    observeDocument();
    requestImmediateSync();
  }

  function bindEvents() {
    document.addEventListener("pointerdown", handlePlayerSettingsInteraction, PASSIVE_CAPTURE_OPTIONS);
    document.addEventListener("pointerdown", handleUserPlaybackGesture, PASSIVE_CAPTURE_OPTIONS);
    document.addEventListener("keydown", handleUserPlaybackGesture, true);
    document.addEventListener("click", handleNavigationClick, true);
    document.addEventListener("yt-navigate-start", handleNavigationStart, true);
    document.addEventListener("yt-player-updated", handleNativePlayerSignal, true);
    document.addEventListener("pause", YTAudio.antiInterrupt.dismissPlaybackInterruptions, true);
    document.addEventListener("visibilitychange", handleVisibilityChange, true);
    window.addEventListener("popstate", handleHistoryChange, true);
    window.addEventListener("pagehide", handlePageHide, true);
    window.addEventListener("pageshow", handlePageShow, true);

    for (const eventName of NAVIGATION_SIGNAL_EVENTS) {
      document.addEventListener(eventName, handleNavigationSignal, true);
    }

    for (const eventName of MEDIA_ACTIVITY_EVENTS) {
      document.addEventListener(eventName, handleMediaActivity, true);
    }
  }

  function observeDocument() {
    new MutationObserver(scheduleIdleSync).observe(document.documentElement || document, { childList: true, subtree: true });
  }

  function scheduleIdleSync() {
    const state = YTAudio.state;

    if (state.syncTimer) {
      return;
    }

    state.syncTimer = setTimeout(() => {
      state.syncTimer = 0;
      requestImmediateSync();
    }, 250);
  }

  function requestImmediateSync() {
    const state = YTAudio.state;

    if (state.scheduled) {
      return;
    }

    state.scheduled = true;

    setTimeout(() => {
      state.scheduled = false;
      syncPage();
    }, 0);
  }

  function syncPage() {
    const videoId = readRouteVideoId();

    if (!videoId) {
      syncVideoState(videoId, false);
      return;
    }

    const ui = YTAudio.ui;
    const player = YTAudio.player;
    const antiInterrupt = YTAudio.antiInterrupt;

    ui.attachButton();
    antiInterrupt.dismissPlaybackInterruptions();
    ui.updateQualityMenu();
    player.bindNativeSignals(handleNativePlayerSignal);
    syncVideoState(videoId, true);
    ui.updateButton();
  }

  function syncVideoState(currentVideoId, shouldApplyAudioMode) {
    const state = YTAudio.state;
    const ui = YTAudio.ui;
    const player = YTAudio.player;
    const api = YTAudio.api;
    const videoId = typeof currentVideoId === "string" ? currentVideoId : readRouteVideoId();

    syncRouteActivity(videoId);

    if (!videoId) {
      syncInactiveRoute(api, player, ui);
      return "";
    }

    ui.setButtonVisibility(true);
    ui.updateAudioThumbnail(videoId);

    const videoChanged = videoId !== state.videoId;

    if (videoChanged) {
      state.videoId = videoId;
      state.audioUrl = "";
      state.sourceUrl = "";
      state.shouldResumePlayback = pendingNavigationVideoId === videoId;
      api.cancelAudioRequests(videoId);

      if (pendingNavigationVideoId === videoId) {
        clearPendingNavigation();
      }
    }

    if (state.navigating) {
      shouldApplyAudioMode = false;
    }

    if (state.enabled) {
      requestRouteServiceWorkerReset(videoId);
      player.guardNativeVideo();
      YTAudio.prefetch.prefetchUpcomingAudio(videoId);
    }

    if (shouldApplyAudioMode && state.enabled) {
      player.applyAudioMode(!videoChanged);
    }

    return videoId;
  }

  function syncInactiveRoute(api, player, ui) {
    ui.detachButton();
    ui.updateAudioThumbnail("");
    ui.restoreQualityMenuItems();
    player.unbindNativeSignals();

    if (hasActiveAudioState()) {
      clearAudioMode(api, player);
    }
  }

  function syncRouteActivity(videoId) {
    const active = YTAudio.state.enabled && Boolean(videoId);

    YTAudio.antiInterrupt.syncVisibilityState(active);
    syncNetworkRuleState(active);
  }

  function handlePlayerSettingsInteraction(event) {
    if (!YTAudio.state.enabled || !readRouteVideoId() || !(event.target instanceof Element)) {
      return;
    }

    if (event.target.closest(".ytp-settings-button")) {
      YTAudio.player.captureSettingsInteraction();
    }
  }

  function handleUserPlaybackGesture(event) {
    const state = YTAudio.state;

    if (!readRouteVideoId()) {
      return;
    }

    YTAudio.player.recordUserGesture();

    if (!state.enabled || !state.shouldResumePlayback) {
      return;
    }

    if (event.target instanceof Element && event.target.closest(`#${YTAudio.config.BUTTON_ID}`)) {
      return;
    }

    YTAudio.player.resumePlaybackAfterUserGesture();
  }

  function handleNavigationClick(event) {
    if (!YTAudio.state.enabled || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    if (!(event.target instanceof Element)) {
      return;
    }

    const anchor = event.target.closest("a[href]");

    if (!anchor) {
      return;
    }

    const href = anchor.href || anchor.getAttribute("href") || "";
    const targetVideoId = YTAudio.utils.readVideoIdFromUrl(href);

    if (!targetVideoId) {
      if (shouldClearForNonVideoNavigation(href)) {
        prepareVideoNavigation("");
        syncNetworkRuleState(false);
      }
      return;
    }

    if (targetVideoId === YTAudio.state.videoId) {
      YTAudio.player.rememberAudioPlaybackState();
      return;
    }

    beginNavigation();
    setPendingNavigation(targetVideoId);
    prepareVideoNavigation(targetVideoId);
  }

  function shouldClearForNonVideoNavigation(href) {
    if (!hasActiveAudioState()) {
      return false;
    }

    try {
      const url = new URL(href, location.href);
      return url.origin === location.origin && !YTAudio.utils.readVideoIdFromUrl(url.href);
    } catch (error) {
      return false;
    }
  }

  function handleNavigationStart() {
    if (!YTAudio.state.enabled) {
      return;
    }

    beginNavigation();

    if (pendingNavigationVideoId && pendingNavigationVideoId !== YTAudio.state.videoId) {
      prepareVideoNavigation(pendingNavigationVideoId);
      return;
    }

    if (isCurrentVideoRoute()) {
      YTAudio.player.captureSettingsInteraction();
      requestImmediateSync();
      return;
    }

    prepareVideoNavigation("");
    syncNetworkRuleState(false);
  }

  function handleNavigationSignal() {
    completeNavigation();
    syncVideoState(readRouteVideoId(), true);
    requestImmediateSync();
  }

  function handleNativePlayerSignal() {
    syncVideoState(readRouteVideoId(), true);
    requestImmediateSync();
  }

  function handleMediaActivity(event) {
    if (!(event.target instanceof HTMLVideoElement)) {
      return;
    }

    if (!readRouteVideoId()) {
      if (hasActiveAudioState()) {
        YTAudio.player.clearAudioMode();
        clearPendingNavigation();
      }

      syncNetworkRuleState(false);
      return;
    }

    YTAudio.player.rememberAudioPlaybackState();
    syncVideoState(readRouteVideoId(), true);
  }

  function handleHistoryChange() {
    handleNavigationStart();
  }

  function handlePageHide() {
    clearNavigationTimeout();
    syncNetworkRuleState(false, true);
  }

  function handlePageShow() {
    clearNavigationTimeout();
    YTAudio.state.navigating = false;
    lastNetworkRuleActive = null;
    requestImmediateSync();
  }

  function prepareVideoNavigation(retainedVideoId) {
    const api = YTAudio.api;
    const player = YTAudio.player;

    api.cancelAudioRequests(retainedVideoId);

    if (!retainedVideoId) {
      clearAudioMode(api, player);
      return;
    }

    player.rememberAudioPlaybackState();
    player.haltNativePlayer();
    player.guardNativeVideo();
  }

  function handleVisibilityChange(event) {
    if (YTAudio.state.enabled && readRouteVideoId()) {
      YTAudio.utils.stopEvent(event);
    }
  }

  async function setEnabled(enabled) {
    const state = YTAudio.state;
    const player = YTAudio.player;
    const api = YTAudio.api;
    const videoId = readRouteVideoId();

    if (enabled && !videoId) {
      return false;
    }

    if (state.enabled === enabled) {
      return true;
    }

    const previousEnabled = state.enabled;

    applyEnabledState(enabled, true);

    try {
      if (enabled) {
        await player.applyAudioMode(true);
      } else {
        await restoreVideoMode(api, player);
      }
    } catch (error) {
      applyEnabledState(previousEnabled, true);

      if (previousEnabled && videoId) {
        await player.applyAudioMode(true);
      } else if (!previousEnabled) {
        await restoreVideoMode(api, player);
      }

      return false;
    }

    return true;
  }

  function applyEnabledState(enabled, shouldStore) {
    const state = YTAudio.state;

    state.enabled = enabled;

    if (shouldStore) {
      writeStoredTabEnabledState(enabled);
    }

    if (!enabled) {
      lastServiceWorkerResetVideoId = "";
    }

    YTAudio.ui.updateButton();
    syncVideoState(readRouteVideoId(), false);
  }

  function restoreVideoMode(api, player) {
    clearPendingNavigation();
    completeNavigation();
    api.cancelAudioRequests("");
    return player.restoreVideoMode();
  }

  function clearAudioMode(api, player) {
    clearPendingNavigation();
    completeNavigation();
    api.cancelAudioRequests("");
    player.clearAudioMode();
  }

  function beginNavigation() {
    YTAudio.state.navigating = true;
    scheduleNavigationTimeout();
  }

  function completeNavigation() {
    YTAudio.state.navigating = false;
    clearNavigationTimeout();
  }

  function scheduleNavigationTimeout() {
    clearNavigationTimeout();

    navigationTimeoutTimer = setTimeout(() => {
      navigationTimeoutTimer = 0;

      if (!YTAudio.state.navigating) {
        return;
      }

      YTAudio.state.navigating = false;
      syncVideoState(readRouteVideoId(), true);
      requestImmediateSync();
    }, NAVIGATION_TIMEOUT_MS);
  }

  function clearNavigationTimeout() {
    if (navigationTimeoutTimer) {
      clearTimeout(navigationTimeoutTimer);
      navigationTimeoutTimer = 0;
    }
  }

  function setPendingNavigation(videoId) {
    pendingNavigationVideoId = videoId;
  }

  function clearPendingNavigation() {
    pendingNavigationVideoId = "";
  }

  function hasActiveAudioState() {
    const state = YTAudio.state;
    return Boolean(state.videoId || state.audioUrl || state.sourceUrl || state.shouldResumePlayback);
  }

  function readRouteVideoId() {
    return YTAudio.utils.readVideoIdFromUrl(location.href);
  }

  function isCurrentVideoRoute() {
    const state = YTAudio.state;
    const videoId = readRouteVideoId();

    return Boolean(videoId && state.videoId && videoId === state.videoId);
  }

  function connectControlPort() {
    if (!isTopFrame || !browserApi.runtime || typeof browserApi.runtime.connect !== "function" || controlPort) {
      return controlPort;
    }

    try {
      controlPort = browserApi.runtime.connect({ name: CONTROL_PORT_NAME });
      controlPort.onDisconnect.addListener(handleControlPortDisconnect);
      return controlPort;
    } catch (error) {
      return null;
    }
  }

  function handleControlPortDisconnect() {
    controlPort = null;
    lastNetworkRuleActive = null;
    scheduleControlReconnect();
  }

  function scheduleControlReconnect() {
    if (!isTopFrame || controlReconnectTimer || !YTAudio.state.enabled) {
      return;
    }

    controlReconnectTimer = setTimeout(() => {
      controlReconnectTimer = 0;

      if (!YTAudio.state.enabled) {
        return;
      }

      connectControlPort();
      syncNetworkRuleState(Boolean(readRouteVideoId()), true);
    }, CONTROL_RECONNECT_DELAY_MS);
  }

  function syncNetworkRuleState(active, force) {
    const nextActive = active === true;

    if (!force && lastNetworkRuleActive === nextActive) {
      return;
    }

    if (sendControlMessage({ type: MESSAGE_TYPE_SYNC_NETWORK_RULES, active: nextActive })) {
      lastNetworkRuleActive = nextActive;
    }
  }

  function sendControlMessage(message) {
    const port = connectControlPort();

    if (!port) {
      return false;
    }

    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      controlPort = null;
      lastNetworkRuleActive = null;
      scheduleControlReconnect();
      return false;
    }
  }

  function readStoredTabEnabledState() {
    try {
      return sessionStorage.getItem(TAB_ENABLED_SESSION_KEY) === "true";
    } catch (error) {
      return false;
    }
  }

  function writeStoredTabEnabledState(enabled) {
    try {
      if (enabled) {
        sessionStorage.setItem(TAB_ENABLED_SESSION_KEY, "true");
      } else {
        sessionStorage.removeItem(TAB_ENABLED_SESSION_KEY);
      }
    } catch (error) {
      return;
    }
  }

  function requestRouteServiceWorkerReset(videoId) {
    if (lastServiceWorkerResetVideoId === videoId) {
      return;
    }

    lastServiceWorkerResetVideoId = videoId;
    resetServiceWorkerRegistrations();
  }

  async function resetServiceWorkerRegistrations() {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) {
      return;
    }

    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (error) {
      return;
    }
  }

  YTAudio.main = {
    setEnabled
  };

  boot();
})();