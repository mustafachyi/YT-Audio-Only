(() => {
  "use strict";

  function syncVisibilityState(active) {
    const root = document.documentElement;
    if (!root) {
      return;
    }
    if (active) {
      root.setAttribute(YTAudio.config.VISIBILITY_ATTRIBUTE, "true");
    } else {
      root.removeAttribute(YTAudio.config.VISIBILITY_ATTRIBUTE);
    }
  }

  function dismissPlaybackInterruptions() {
    if (!isAudioModeActive()) {
      return;
    }

    const button = findPlaybackInterruptionButton();

    if (button instanceof HTMLElement && isVisibleButton(button)) {
      button.click();
    }
  }

  function isAudioModeActive() {
    const root = document.documentElement;
    return Boolean(root && root.getAttribute(YTAudio.config.VISIBILITY_ATTRIBUTE) === "true");
  }

  function findPlaybackInterruptionButton() {
    const confirmButton = findButtonElement(document.getElementById("confirm-button"));
    if (confirmButton) {
      return confirmButton;
    }

    const containerButton = findButtonElement(document.getElementById("player-error-message-container"));
    if (containerButton) {
      return containerButton;
    }

    return document.querySelector(".dialog-flex-button, .notification-action-response-text");
  }

  function findButtonElement(element) {
    if (!element) {
      return null;
    }
    if (element instanceof HTMLButtonElement) {
      return element;
    }
    return element.querySelector("button");
  }

  function isVisibleButton(button) {
    return !button.disabled && button.getClientRects().length > 0;
  }

  YTAudio.antiInterrupt = {
    syncVisibilityState,
    dismissPlaybackInterruptions
  };
})();