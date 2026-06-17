(() => {
  "use strict";

  async function resolveAudioUrl(videoId) {
    if (!videoId) {
      return "";
    }

    const cachedAudioUrl = readCachedAudioUrl(videoId);
    if (cachedAudioUrl) {
      return cachedAudioUrl;
    }

    return requestAudioUrl(videoId);
  }

  function prefetchAudioUrl(videoId) {
    if (!videoId || readCachedAudioUrl(videoId)) {
      return;
    }

    requestAudioUrl(videoId);
  }

  function cancelAudioRequests(retainedVideoId) {
    const state = YTAudio.state;

    for (const [videoId, request] of state.audioUrlRequestCache) {
      if (videoId !== retainedVideoId) {
        request.abortController.abort();
        state.audioUrlRequestCache.delete(videoId);
      }
    }
  }

  async function requestAudioUrl(videoId) {
    const state = YTAudio.state;
    const activeRequest = state.audioUrlRequestCache.get(videoId);

    if (activeRequest) {
      return activeRequest.promise;
    }

    const abortController = new AbortController();
    const promise = fetchAndCacheAudioUrl(videoId, abortController.signal);

    state.audioUrlRequestCache.set(videoId, { abortController, promise });

    try {
      return await promise;
    } finally {
      const currentRequest = state.audioUrlRequestCache.get(videoId);
      if (currentRequest && currentRequest.promise === promise) {
        state.audioUrlRequestCache.delete(videoId);
      }
    }
  }

  async function fetchAndCacheAudioUrl(videoId, signal) {
    try {
      const playerInfo = await fetchPlayerInfo(videoId, signal);
      if (!playerInfo) {
        return "";
      }

      const format = selectAudioFormat(playerInfo);
      if (!format) {
        return "";
      }

      const audioUrl = await resolveFormatUrl(format, signal);
      if (audioUrl) {
        writeAudioUrlCache(videoId, audioUrl);
      }

      return audioUrl;
    } catch (error) {
      return "";
    }
  }

  async function fetchPlayerInfo(videoId, signal) {
    const state = YTAudio.state;
    const config = YTAudio.config;
    const apiKey = readInnertubeApiKey() || config.FALLBACK_API_KEY;

    for (const profile of config.PLAYER_CLIENTS) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const data = await requestPlayerInfo(config.PLAYER_ENDPOINT, apiKey, profile, videoId, signal);

        if (!data) {
          break;
        }

        if (data.responseContext && data.responseContext.visitorData && !state.visitorData) {
          state.visitorData = data.responseContext.visitorData;
        }

        if (data.streamingData) {
          return data;
        }

        if (!state.visitorData) {
          break;
        }
      }
    }

    return null;
  }

  async function requestPlayerInfo(endpoint, apiKey, profile, videoId, signal) {
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      credentials: "include",
      mode: "cors",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Origin": `https://${location.hostname}`
      },
      body: JSON.stringify(createPlayerRequest(profile, videoId))
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  function createPlayerRequest(profile, videoId) {
    const state = YTAudio.state;
    const request = {
      context: {
        client: {
          ...profile.client,
          visitorData: state.visitorData || undefined
        }
      },
      videoId
    };

    if (profile.thirdParty) {
      request.thirdParty = profile.thirdParty;
    }

    if (profile.racyCheckOk) {
      request.racyCheckOk = true;
    }

    if (profile.contentCheckOk) {
      request.contentCheckOk = true;
    }

    return request;
  }

  function readInnertubeApiKey() {
    const state = YTAudio.state;

    if (state.innertubeApiKey) {
      return state.innertubeApiKey;
    }

    for (const script of document.scripts) {
      const text = script.textContent;

      if (!text || text.length < 64) {
        continue;
      }

      const match = text.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
      if (match) {
        state.innertubeApiKey = match[1];
        return state.innertubeApiKey;
      }
    }

    return "";
  }

  function selectAudioFormat(playerInfo) {
    const config = YTAudio.config;
    const data = playerInfo.streamingData;
    let selected = null;
    let selectedScore = Infinity;

    for (const list of [data.adaptiveFormats, data.formats]) {
      if (!Array.isArray(list)) {
        continue;
      }

      for (const format of list) {
        if (!format.mimeType || !format.mimeType.startsWith("audio")) {
          continue;
        }

        const score = config.AUDIO_FORMAT_SCORE.get(Number(format.itag));
        if (score === undefined || score >= selectedScore) {
          continue;
        }

        selected = format;
        selectedScore = score;

        if (score === 0 && format.url) {
          return selected;
        }
      }
    }

    return selected;
  }

  async function resolveFormatUrl(format, signal) {
    if (format.url) {
      return format.url;
    }

    const cipher = format.signatureCipher || format.cipher;
    if (!cipher) {
      return "";
    }

    const parameters = new URLSearchParams(cipher);
    const streamUrl = parameters.get("url");
    const signature = parameters.get("s");
    const signatureParameter = parameters.get("sp") || "signature";

    if (!streamUrl || !signature) {
      return "";
    }

    const decipheredSignature = await decipherSignature(signature, signal);
    if (!decipheredSignature) {
      return "";
    }

    const resolvedUrl = new URL(streamUrl);
    resolvedUrl.searchParams.set(signatureParameter, decipheredSignature);

    return resolvedUrl.href;
  }

  async function decipherSignature(signature, signal) {
    const state = YTAudio.state;
    const sourceUrl = findPlayerScriptUrl();

    if (!sourceUrl) {
      return "";
    }

    if (!state.decipherPlan || state.decipherSourceUrl !== sourceUrl) {
      const response = await fetch(sourceUrl, { credentials: "include", mode: "cors", signal });

      if (!response.ok) {
        return "";
      }

      const source = await response.text();
      state.decipherPlan = createDecipherPlan(source);
      state.decipherSourceUrl = sourceUrl;
    }

    if (!state.decipherPlan) {
      return "";
    }

    const characters = signature.split("");

    for (const step of state.decipherPlan) {
      applyDecipherStep(characters, step);
    }

    return characters.join("");
  }

  function applyDecipherStep(characters, step) {
    if (step.type === "reverse") {
      characters.reverse();
      return;
    }

    if (step.type === "splice") {
      characters.splice(0, step.value);
      return;
    }

    if (step.type === "swap" && characters.length) {
      const index = step.value % characters.length;
      const first = characters[0];
      characters[0] = characters[index];
      characters[index] = first;
    }
  }

  function findPlayerScriptUrl() {
    const player = document.getElementById("movie_player");
    const dataVersion = player && player.getAttribute("data-version");

    if (dataVersion && dataVersion.includes("/s/player/")) {
      return new URL(dataVersion, location.origin).href;
    }

    for (const script of document.scripts) {
      if (script.src.includes("/s/player/") && script.src.includes("base.js")) {
        return script.src;
      }
    }

    return findPlayerScriptUrlFromInlineData();
  }

  function findPlayerScriptUrlFromInlineData() {
    const pattern = /"jsUrl":"([^"]+base\.js)"/;

    for (const script of document.scripts) {
      const text = script.textContent;

      if (!text || !text.includes("base.js")) {
        continue;
      }

      const match = text.match(pattern);
      if (match) {
        return new URL(match[1].replace(/\\\//g, "/"), location.origin).href;
      }
    }

    return "";
  }

  function createDecipherPlan(source) {
    const utils = YTAudio.utils;
    const functionMatch = source.match(/function\(([\w$]+)\)\{\1=\1\.split\(""\);(.*?)return \1\.join\(""\)\}/s) || source.match(/([\w$]+)=function\(([\w$]+)\)\{\2=\2\.split\(""\);(.*?)return \2\.join\(""\)\}/s);

    if (!functionMatch) {
      return null;
    }

    const variableName = functionMatch.length === 3 ? functionMatch[1] : functionMatch[2];
    const body = functionMatch.length === 3 ? functionMatch[2] : functionMatch[3];
    const objectMatch = body.match(/([\w$]+)\.([\w$]+)\(/);

    if (!objectMatch) {
      return null;
    }

    const objectName = objectMatch[1];
    const objectBody = extractObjectBody(source, objectName);

    if (!objectBody) {
      return null;
    }

    const operationMap = createOperationMap(objectBody);
    const callPattern = new RegExp(`${utils.escapeRegExp(objectName)}\\.([\\w$]+)\\(${utils.escapeRegExp(variableName)}(?:,(\\d+))?\\)`, "g");
    const plan = [];

    for (const match of body.matchAll(callPattern)) {
      const type = operationMap.get(match[1]);

      if (type) {
        plan.push({ type, value: Number(match[2] || 0) });
      }
    }

    return plan.length ? plan : null;
  }

  function extractObjectBody(source, objectName) {
    const utils = YTAudio.utils;
    const assignmentPattern = new RegExp(`(?:^|[;,])(?:var |let |const )?${utils.escapeRegExp(objectName)}\\s*=\\s*\\{`);
    const assignmentMatch = source.match(assignmentPattern);

    if (!assignmentMatch) {
      return "";
    }

    const braceStart = source.indexOf("{", assignmentMatch.index);
    let depth = 0;

    for (let index = braceStart; index < source.length; index += 1) {
      const character = source[index];

      if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;

        if (depth === 0) {
          return source.slice(braceStart + 1, index);
        }
      }
    }

    return "";
  }

  function createOperationMap(objectBody) {
    const operationMap = new Map();
    const methodPattern = /(?:^|,)([\w$]+|"[\w$]+"|'[\w$]+'):function\([^)]*\)\{([^}]*)\}/g;

    for (const match of objectBody.matchAll(methodPattern)) {
      const methodName = match[1].replace(/^[\'"]|[\'"]$/g, "");
      const body = match[2];

      if (body.includes(".reverse()")) {
        operationMap.set(methodName, "reverse");
      } else if (body.includes(".splice(")) {
        operationMap.set(methodName, "splice");
      } else if (body.includes("%") && body.includes(".length")) {
        operationMap.set(methodName, "swap");
      }
    }

    return operationMap;
  }

  function readCachedAudioUrl(videoId) {
    const state = YTAudio.state;
    const cachedAudioUrl = state.audioUrlCache.get(videoId);

    if (!cachedAudioUrl) {
      return "";
    }

    if (cachedAudioUrl.expiresAt <= Date.now()) {
      state.audioUrlCache.delete(videoId);
      return "";
    }

    state.audioUrlCache.delete(videoId);
    state.audioUrlCache.set(videoId, cachedAudioUrl);
    writePrefetchedAudioAttribute(videoId, cachedAudioUrl.url);

    return cachedAudioUrl.url;
  }

  function writeAudioUrlCache(videoId, audioUrl) {
    const state = YTAudio.state;
    const config = YTAudio.config;

    state.audioUrlCache.delete(videoId);
    state.audioUrlCache.set(videoId, {
      url: audioUrl,
      expiresAt: resolveAudioUrlExpiry(audioUrl)
    });

    writePrefetchedAudioAttribute(videoId, audioUrl);

    while (state.audioUrlCache.size > config.AUDIO_URL_CACHE_LIMIT) {
      const oldestVideoId = state.audioUrlCache.keys().next().value;
      state.audioUrlCache.delete(oldestVideoId);
    }
  }

  function writePrefetchedAudioAttribute(videoId, audioUrl) {
    try {
      document.documentElement.setAttribute(
        "data-yt-prefetched-audio",
        JSON.stringify({ videoId, url: audioUrl })
      );
    } catch (error) {}
  }

  function resolveAudioUrlExpiry(audioUrl) {
    const config = YTAudio.config;

    try {
      const expire = Number(new URL(audioUrl).searchParams.get("expire"));
      if (Number.isFinite(expire) && expire > 0) {
        return Math.max(Date.now(), (expire * 1000) - config.AUDIO_URL_EXPIRY_SAFETY_MS);
      }
    } catch (error) {
      return Date.now() + config.AUDIO_URL_CACHE_TTL_MS;
    }

    return Date.now() + config.AUDIO_URL_CACHE_TTL_MS;
  }

  YTAudio.api = {
    resolveAudioUrl,
    prefetchAudioUrl,
    cancelAudioRequests
  };
})();