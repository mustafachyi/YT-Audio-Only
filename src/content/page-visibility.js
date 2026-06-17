(() => {
  "use strict";

  const VISIBILITY_ATTRIBUTE = "data-yt-audio-enabled";

  function isAudioModeEnabled() {
    const root = document.documentElement;
    return Boolean(root && root.getAttribute(VISIBILITY_ATTRIBUTE) === "true");
  }

  function isAudioPlaybackRouteActive() {
    return isAudioModeEnabled() && Boolean(readRouteVideoId());
  }

  function readRouteVideoId() {
    try {
      const url = new URL(location.href);
      if (url.pathname === "/watch") {
        return url.searchParams.get("v") || "";
      }
      if (url.pathname.startsWith("/embed/")) {
        return url.pathname.split("/")[2] || "";
      }
    } catch (error) {}
    return "";
  }

  function readPrefetchedAudioUrl(currentVideoId) {
    const prefetchedData = document.documentElement.getAttribute("data-yt-prefetched-audio");

    if (!prefetchedData || !currentVideoId) {
      return "";
    }

    try {
      const data = JSON.parse(prefetchedData);
      return data && data.videoId === currentVideoId && data.url ? data.url : "";
    } catch (error) {
      return "";
    }
  }

  const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");

  if (originalSrcDescriptor && originalSrcDescriptor.set) {
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      get() {
        return originalSrcDescriptor.get.call(this);
      },
      set(value) {
        if (isAudioPlaybackRouteActive() && typeof value === "string" && value.startsWith("blob:")) {
          const audioUrl = readPrefetchedAudioUrl(readRouteVideoId());

          if (audioUrl) {
            originalSrcDescriptor.set.call(this, audioUrl);
            return;
          }
        }

        originalSrcDescriptor.set.call(this, value);
      },
      configurable: true,
      enumerable: true
    });
  }

  const serviceWorkerDescriptor = typeof Navigator !== "undefined" ? Object.getOwnPropertyDescriptor(Navigator.prototype, "serviceWorker") : null;
  const fallbackServiceWorker = readInitialServiceWorker();
  const blockedServiceWorkerReady = new Promise(() => {});
  const blockedServiceWorkerContainer = createBlockedServiceWorkerContainer();

  function readInitialServiceWorker() {
    try {
      if (serviceWorkerDescriptor && typeof serviceWorkerDescriptor.get === "function") {
        return serviceWorkerDescriptor.get.call(navigator);
      }
      if (serviceWorkerDescriptor && Object.prototype.hasOwnProperty.call(serviceWorkerDescriptor, "value")) {
        return serviceWorkerDescriptor.value;
      }
      return navigator.serviceWorker || null;
    } catch (error) {
      return null;
    }
  }

  function readNativeServiceWorker() {
    try {
      if (serviceWorkerDescriptor && typeof serviceWorkerDescriptor.get === "function") {
        return serviceWorkerDescriptor.get.call(navigator);
      }
      if (serviceWorkerDescriptor && Object.prototype.hasOwnProperty.call(serviceWorkerDescriptor, "value")) {
        return serviceWorkerDescriptor.value;
      }
      return fallbackServiceWorker;
    } catch (error) {
      return fallbackServiceWorker;
    }
  }

  function createBlockedServiceWorkerContainer() {
    return {
      controller: null,
      ready: blockedServiceWorkerReady,
      register: rejectBlockedServiceWorkerRegistration,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => false,
      getRegistration: () => Promise.resolve(null),
      getRegistrations: () => Promise.resolve([])
    };
  }

  function rejectBlockedServiceWorkerRegistration() {
    return Promise.reject(createServiceWorkerBlockedError());
  }

  function createServiceWorkerBlockedError() {
    try {
      return new DOMException("Service worker registration disabled while audio-only playback is active.", "SecurityError");
    } catch (error) {
      return new Error("Service worker registration disabled while audio-only playback is active.");
    }
  }

  function noop() {}

  try {
    if (typeof navigator !== "undefined" && readNativeServiceWorker()) {
      Object.defineProperty(navigator, "serviceWorker", {
        get() {
          return isAudioPlaybackRouteActive() ? blockedServiceWorkerContainer : readNativeServiceWorker();
        },
        configurable: true,
        enumerable: true
      });
    }
  } catch (error) {}

  const hiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
  const visibilityStateDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");

  function readDescriptorValue(descriptor, documentValue, fallbackValue) {
    if (descriptor && typeof descriptor.get === "function") {
      return descriptor.get.call(documentValue);
    }
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      return descriptor.value;
    }
    return fallbackValue;
  }

  try {
    Object.defineProperty(Document.prototype, "hidden", {
      get() {
        return isAudioPlaybackRouteActive() ? false : readDescriptorValue(hiddenDescriptor, this, false);
      },
      configurable: true
    });
    Object.defineProperty(Document.prototype, "visibilityState", {
      get() {
        return isAudioPlaybackRouteActive() ? "visible" : readDescriptorValue(visibilityStateDescriptor, this, "visible");
      },
      configurable: true
    });
  } catch (error) {
    return;
  }
})();