(() => {
  "use strict";

  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const BUTTON_LABEL = "Audio only";
  const AUDIO_ICON_PATH = "M5.5 1.383V6.88a2.25 2.25 0 101 1.871V4.6l2.743 1.647a.5.5 0 00.757-.43V3.485a.5.5 0 00-.243-.429l-3.5-2.1a.5.5 0 00-.757.427Z";
  const PLAYER_CONTAINER_SELECTOR = ".html5-video-player, #movie_player";
  const VIDEO_SELECTOR = "video.html5-main-video, video.video-stream, video";
  const QUALITY_MENU_ITEM_SELECTOR = ".ytp-settings-menu .ytp-menuitem, yt-list-item-view-model[role='menuitem']";
  const QUALITY_LABEL_SELECTOR = ".ytp-menuitem-label, .ytListItemViewModelTitle";
  const THUMBNAIL_QUALITIES = ["maxresdefault", "sddefault", "hqdefault", "mqdefault", "default"];
  const OVERLAY_STYLE = {
    position: "absolute",
    top: "0",
    right: "0",
    bottom: "0",
    left: "0",
    width: "100%",
    height: "100%",
    "z-index": "1",
    display: "block",
    overflow: "hidden",
    "pointer-events": "none",
    "background-color": "#000",
    transform: "translateZ(0)"
  };
  const IMAGE_STYLE = {
    position: "absolute",
    top: "0",
    right: "0",
    bottom: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "block",
    "object-fit": "cover",
    "object-position": "center",
    "pointer-events": "none"
  };

  let cachedPlayerContainer = null;
  let toggleInProgress = false;

  function attachButton() {
    const state = YTAudio.state;

    if (!state.ready) {
      return;
    }

    if (state.button && state.button.isConnected && isButtonInCorrectSlot(state.button)) {
      return;
    }

    if (state.button && state.button.isConnected) {
      hideTooltip();
      state.button.remove();
    }

    const desktopSlot = findDesktopButtonSlot();

    if (!desktopSlot) {
      return;
    }

    state.button = createButton();
    desktopSlot.parent.insertBefore(state.button, desktopSlot.before);
    updateButton();
  }

  function detachButton() {
    const state = YTAudio.state;

    if (state.tooltip) {
      state.tooltip.remove();
      state.tooltip = null;
    }

    if (state.button) {
      state.button.remove();
      state.button = null;
    }
  }

  function isButtonInCorrectSlot(button) {
    const parent = button.parentElement;

    return Boolean(parent && (parent.classList.contains("ytp-right-controls-left") || parent.classList.contains("ytp-right-controls")));
  }

  function findDesktopButtonSlot() {
    const leftControls = document.querySelector(".ytp-right-controls-left");

    if (leftControls) {
      return createButtonSlot(leftControls);
    }

    const rightControls = document.querySelector(".ytp-right-controls");

    return rightControls ? createButtonSlot(rightControls) : null;
  }

  function createButtonSlot(parent) {
    return {
      parent,
      before: parent.querySelector(".ytp-settings-button") || parent.firstChild
    };
  }

  function createButton() {
    const config = YTAudio.config;
    const icon = createAudioIcon();
    const button = document.createElement("button");

    button.id = config.BUTTON_ID;
    button.type = "button";
    button.className = `ytp-button ${config.PLAYER_BUTTON_CLASS}`;
    button.setAttribute("aria-label", BUTTON_LABEL);
    button.setAttribute("data-priority", "8");
    icon.style.pointerEvents = "none";
    button.appendChild(icon);
    button.addEventListener("click", handleToggleClick, true);
    button.addEventListener("mouseenter", showTooltip, true);
    button.addEventListener("mouseleave", hideTooltip, true);

    return button;
  }

  function createAudioIcon() {
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    const path = document.createElementNS(SVG_NAMESPACE, "path");

    svg.setAttribute("xmlns", SVG_NAMESPACE);
    svg.setAttribute("fill", "none");
    svg.setAttribute("height", "24");
    svg.setAttribute("width", "24");
    svg.setAttribute("viewBox", "0 0 12 12");
    path.setAttribute("d", AUDIO_ICON_PATH);
    path.setAttribute("fill", "white");
    svg.appendChild(path);

    return svg;
  }

  function createTooltip() {
    const tooltip = document.createElement("div");
    const wrapper = document.createElement("div");
    const bottomText = document.createElement("div");
    const textSpan = document.createElement("span");
    const background = document.createElement("div");

    tooltip.className = "ytp-tooltip ytp-bottom";
    tooltip.style.position = "absolute";
    tooltip.style.display = "none";
    tooltip.style.zIndex = "70";
    tooltip.style.pointerEvents = "none";
    wrapper.className = "ytp-tooltip-text-wrapper";
    bottomText.className = "ytp-tooltip-bottom-text";
    textSpan.className = "ytp-tooltip-text";
    textSpan.textContent = BUTTON_LABEL;
    background.className = "ytp-tooltip-bg";

    bottomText.appendChild(textSpan);
    wrapper.appendChild(bottomText);
    tooltip.appendChild(wrapper);
    tooltip.appendChild(background);

    return tooltip;
  }

  function showTooltip() {
    const state = YTAudio.state;
    const player = document.querySelector(".html5-video-player");
    const button = state.button;

    if (!player || !button) {
      return;
    }

    if (!state.tooltip || !state.tooltip.isConnected) {
      state.tooltip = createTooltip();
      player.appendChild(state.tooltip);
    }

    const tooltip = state.tooltip;
    const wrapper = tooltip.querySelector(".ytp-tooltip-text-wrapper");
    const background = tooltip.querySelector(".ytp-tooltip-bg");

    tooltip.style.display = "block";

    if (wrapper && background) {
      const wrapperRect = wrapper.getBoundingClientRect();
      background.style.width = `${wrapperRect.width}px`;
      background.style.height = `${wrapperRect.height}px`;
    }

    positionTooltip(player, button, tooltip);
  }

  function positionTooltip(player, button, tooltip) {
    const buttonRect = button.getBoundingClientRect();
    const playerRect = player.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = buttonRect.left - playerRect.left + (buttonRect.width / 2) - (tooltipRect.width / 2);
    const top = buttonRect.top - playerRect.top - tooltipRect.height - 19;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    const state = YTAudio.state;

    if (state.tooltip) {
      state.tooltip.style.display = "none";
    }
  }

  async function handleToggleClick(event) {
    const state = YTAudio.state;

    event.preventDefault();
    event.stopPropagation();

    if (toggleInProgress) {
      return;
    }

    toggleInProgress = true;
    updateButton();

    try {
      await YTAudio.main.setEnabled(!state.enabled);
    } finally {
      toggleInProgress = false;
      updateButton();
    }
  }

  function updateButton() {
    const state = YTAudio.state;
    const button = state.button;

    if (!button) {
      return;
    }

    button.setAttribute("aria-pressed", state.enabled ? "true" : "false");
    button.disabled = toggleInProgress;
    button.style.opacity = state.enabled ? "1" : "0.55";
  }

  function setButtonVisibility(visible) {
    const state = YTAudio.state;

    if (state.button) {
      state.button.hidden = !visible;
    }
  }

  function updateAudioThumbnail(videoId) {
    if (YTAudio.state.enabled && videoId) {
      showAudioThumbnail(videoId);
    } else {
      hideAudioThumbnail();
    }
  }

  function showAudioThumbnail(videoId) {
    const state = YTAudio.state;
    const player = findPlayerContainer();

    if (!player) {
      return;
    }

    if (!state.thumbnail || !state.thumbnail.isConnected || state.thumbnail.parentElement !== player) {
      hideAudioThumbnail();
      state.thumbnail = createThumbnailOverlay();
      player.appendChild(state.thumbnail);
    } else {
      state.thumbnail.hidden = false;
    }

    if (state.thumbnailVideoId !== videoId) {
      state.thumbnailVideoId = videoId;
      loadThumbnailImage(state.thumbnail, videoId);
    }
  }

  function hideAudioThumbnail() {
    const state = YTAudio.state;

    if (state.thumbnail) {
      const image = state.thumbnail.firstElementChild;

      if (image instanceof HTMLImageElement) {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute("src");
      }

      state.thumbnail.remove();
      state.thumbnail = null;
    }

    state.thumbnailVideoId = "";
  }

  function findPlayerContainer() {
    if (cachedPlayerContainer && cachedPlayerContainer.isConnected) {
      return cachedPlayerContainer;
    }

    const player = document.querySelector(PLAYER_CONTAINER_SELECTOR);

    if (player instanceof HTMLElement) {
      cachedPlayerContainer = player;
      return player;
    }

    const video = document.querySelector(VIDEO_SELECTOR);
    cachedPlayerContainer = video && video.parentElement ? video.parentElement : null;

    return cachedPlayerContainer;
  }

  function createThumbnailOverlay() {
    const overlay = document.createElement("div");
    const image = document.createElement("img");

    overlay.setAttribute("data-yt-audio-thumbnail", "true");
    setStyleProperties(overlay, OVERLAY_STYLE, "important");

    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    image.loading = "eager";
    image.referrerPolicy = "no-referrer";
    image.hidden = true;
    setStyleProperties(image, IMAGE_STYLE, "");

    overlay.appendChild(image);

    return overlay;
  }

  function setStyleProperties(element, properties, priority) {
    for (const [property, value] of Object.entries(properties)) {
      element.style.setProperty(property, value, priority);
    }
  }

  function loadThumbnailImage(overlay, videoId) {
    loadThumbnailSource(overlay, videoId, createThumbnailUrls(videoId), 0);
  }

  function loadThumbnailSource(overlay, videoId, urls, index) {
    const state = YTAudio.state;

    if (state.thumbnail !== overlay || state.thumbnailVideoId !== videoId) {
      return;
    }

    const image = overlay.firstElementChild;

    if (!(image instanceof HTMLImageElement)) {
      return;
    }

    if (index >= urls.length) {
      image.hidden = true;
      image.removeAttribute("src");
      return;
    }

    image.hidden = true;
    image.onload = () => {
      if (state.thumbnail !== overlay || state.thumbnailVideoId !== videoId) {
        return;
      }

      if (shouldRejectThumbnail(image, index, urls.length)) {
        loadThumbnailSource(overlay, videoId, urls, index + 1);
        return;
      }

      image.hidden = false;
    };
    image.onerror = () => {
      if (state.thumbnail !== overlay || state.thumbnailVideoId !== videoId) {
        return;
      }

      loadThumbnailSource(overlay, videoId, urls, index + 1);
    };
    image.src = urls[index];
  }

  function createThumbnailUrls(videoId) {
    const encodedVideoId = encodeURIComponent(videoId);

    return THUMBNAIL_QUALITIES.map((quality) => `https://i.ytimg.com/vi/${encodedVideoId}/${quality}.jpg`);
  }

  function shouldRejectThumbnail(image, index, total) {
    return index < total - 1 && image.naturalWidth <= 120 && image.naturalHeight <= 90;
  }

  function updateQualityMenu() {
    const state = YTAudio.state;

    if (state.enabled) {
      hideQualityMenuItems();
    } else {
      restoreQualityMenuItems();
    }
  }

  function hideQualityMenuItems() {
    const config = YTAudio.config;

    for (const item of document.querySelectorAll(QUALITY_MENU_ITEM_SELECTOR)) {
      if (!item.hasAttribute(config.QUALITY_ATTRIBUTE) && isQualityMenuItem(item)) {
        item.setAttribute(config.QUALITY_ATTRIBUTE, "true");
        item.hidden = true;
        item.style.setProperty("display", "none", "important");
      }
    }
  }

  function restoreQualityMenuItems() {
    const config = YTAudio.config;

    for (const item of document.querySelectorAll(`[${config.QUALITY_ATTRIBUTE}]`)) {
      item.removeAttribute(config.QUALITY_ATTRIBUTE);
      item.hidden = false;
      item.style.removeProperty("display");
    }
  }

  function isQualityMenuItem(item) {
    const utils = YTAudio.utils;
    const label = item.querySelector(QUALITY_LABEL_SELECTOR);
    const labelText = utils.normalizeText(label ? label.textContent : item.textContent);
    const accessibleText = utils.normalizeText(`${item.getAttribute("aria-label") || ""} ${item.getAttribute("title") || ""}`);

    return labelText === "quality" || accessibleText.includes("quality");
  }

  YTAudio.ui = {
    attachButton,
    detachButton,
    updateButton,
    setButtonVisibility,
    updateAudioThumbnail,
    updateQualityMenu,
    restoreQualityMenuItems
  };
})();