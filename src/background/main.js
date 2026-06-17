const CONTROL_PORT_NAME = "ytAudioOnlyControl";
const MESSAGE_TYPE_SYNC_NETWORK_RULES = "syncNetworkRules";
const LEGACY_RULE_IDS = [1, 2];
const RULE_ID_OFFSET = 1000;
const RULE_ID_MULTIPLIER = 10;
const RULE_ID_BLOCK_MEDIA_OFFSET = 1;
const RULE_ID_ALLOW_EXTENSION_MEDIA_OFFSET = 2;
const RULE_ID_BLOCK_TELEMETRY_OFFSET = 3;
const YOUTUBE_INITIATOR_DOMAINS = ["youtube.com", "www.youtube.com"];
const GOOGLEVIDEO_MEDIA_FILTER = "||googlevideo.com/videoplayback*";
const EXTENSION_AUDIO_FILTER = "||googlevideo.com/videoplayback*c=ANDROID*";
const TELEMETRY_QOE_FILTER = "||youtube.com/api/stats/qoe*";
const browserApi = typeof browser !== "undefined" ? browser : chrome;

let sessionRuleQueue = Promise.resolve();

function queueSessionRuleOperation(operation) {
  sessionRuleQueue = sessionRuleQueue.then(operation, operation);
}

function queueNetworkRuleSync(tabId, active) {
  queueSessionRuleOperation(() => syncNetworkRules(tabId, active));
}

async function syncNetworkRules(tabId, active) {
  if (!isValidTabId(tabId)) {
    return;
  }

  const declarativeNetRequest = browserApi.declarativeNetRequest;

  if (!declarativeNetRequest || typeof declarativeNetRequest.updateSessionRules !== "function") {
    return;
  }

  const ruleIds = createTabRuleIds(tabId);
  const updateOptions = {
    removeRuleIds: ruleIds
  };

  if (active) {
    updateOptions.addRules = createTabNetworkRules(tabId, ruleIds[0], ruleIds[1], ruleIds[2]);
  }

  try {
    await declarativeNetRequest.updateSessionRules(updateOptions);
  } catch (error) {
    return;
  }
}

function createTabRuleIds(tabId) {
  const baseRuleId = RULE_ID_OFFSET + (tabId * RULE_ID_MULTIPLIER);

  return [
    baseRuleId + RULE_ID_BLOCK_MEDIA_OFFSET,
    baseRuleId + RULE_ID_ALLOW_EXTENSION_MEDIA_OFFSET,
    baseRuleId + RULE_ID_BLOCK_TELEMETRY_OFFSET
  ];
}

function createTabNetworkRules(tabId, blockRuleId, allowRuleId, telemetryRuleId) {
  return [
    {
      id: blockRuleId,
      priority: 1,
      action: { type: "block" },
      condition: {
        tabIds: [tabId],
        urlFilter: GOOGLEVIDEO_MEDIA_FILTER,
        resourceTypes: ["xmlhttprequest", "media"],
        initiatorDomains: YOUTUBE_INITIATOR_DOMAINS
      }
    },
    {
      id: allowRuleId,
      priority: 2,
      action: { type: "allow" },
      condition: {
        tabIds: [tabId],
        urlFilter: EXTENSION_AUDIO_FILTER,
        resourceTypes: ["xmlhttprequest", "media"],
        initiatorDomains: YOUTUBE_INITIATOR_DOMAINS
      }
    },
    {
      id: telemetryRuleId,
      priority: 3,
      action: { type: "block" },
      condition: {
        tabIds: [tabId],
        urlFilter: TELEMETRY_QOE_FILTER,
        resourceTypes: ["xmlhttprequest"],
        initiatorDomains: YOUTUBE_INITIATOR_DOMAINS
      }
    }
  ];
}

function isValidTabId(tabId) {
  return Number.isInteger(tabId) && tabId >= 0;
}

function isManagedSessionRuleId(ruleId) {
  if (!Number.isInteger(ruleId) || ruleId < RULE_ID_OFFSET) {
    return false;
  }

  const offset = (ruleId - RULE_ID_OFFSET) % RULE_ID_MULTIPLIER;
  return offset === RULE_ID_BLOCK_MEDIA_OFFSET || 
         offset === RULE_ID_ALLOW_EXTENSION_MEDIA_OFFSET ||
         offset === RULE_ID_BLOCK_TELEMETRY_OFFSET;
}

function readPortTabId(port) {
  return port && port.sender && port.sender.tab ? port.sender.tab.id : null;
}

async function clearLegacyDynamicRules() {
  const declarativeNetRequest = browserApi.declarativeNetRequest;

  if (!declarativeNetRequest || typeof declarativeNetRequest.updateDynamicRules !== "function") {
    return;
  }

  try {
    await declarativeNetRequest.updateDynamicRules({ removeRuleIds: LEGACY_RULE_IDS });
  } catch (error) {
    return;
  }
}

async function clearManagedSessionRules() {
  const declarativeNetRequest = browserApi.declarativeNetRequest;

  if (!declarativeNetRequest || typeof declarativeNetRequest.getSessionRules !== "function" || typeof declarativeNetRequest.updateSessionRules !== "function") {
    return;
  }

  try {
    const rules = await declarativeNetRequest.getSessionRules();
    const ruleIds = rules.map((rule) => rule.id).filter(isManagedSessionRuleId);

    if (ruleIds.length) {
      await declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds });
    }
  } catch (error) {
    return;
  }
}

browserApi.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== CONTROL_PORT_NAME) {
    return;
  }

  const tabId = readPortTabId(port);

  if (!isValidTabId(tabId)) {
    return;
  }

  port.onMessage.addListener((message) => {
    if (!message || message.type !== MESSAGE_TYPE_SYNC_NETWORK_RULES) {
      return;
    }

    queueNetworkRuleSync(tabId, message.active === true);
  });
});

if (browserApi.tabs && browserApi.tabs.onRemoved) {
  browserApi.tabs.onRemoved.addListener((tabId) => {
    queueNetworkRuleSync(tabId, false);
  });
}

if (browserApi.runtime.onInstalled) {
  browserApi.runtime.onInstalled.addListener(() => {
    clearLegacyDynamicRules();
    queueSessionRuleOperation(clearManagedSessionRules);
  });
}

clearLegacyDynamicRules();