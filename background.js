/**
 * @file Service Worker (background script) для расширения "Interactive PiP".
 * Добавлен режим выбора элемента.
 */
const LOG_NAMESPACE = 'Interactive PiP';
const LOG_LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 };

function createLogger(scope, level = 'info') {
  const resolveLevel = typeof level === 'function' ? level : () => level;
  const ensureLevel = (value) => (value in LOG_LEVEL_ORDER ? value : 'info');
  const createWriter = (type) => (...args) => {
    const currentLevel = ensureLevel(resolveLevel());
    if (LOG_LEVEL_ORDER[type] > LOG_LEVEL_ORDER[currentLevel]) return;
    const timestamp = new Date().toISOString();
    const writer = console[type] ?? console.log;
    writer(`[${timestamp}] [${LOG_NAMESPACE}] [${scope}]`, ...args);
  };

  return {
    error: createWriter('error'),
    warn: createWriter('warn'),
    info: createWriter('info'),
    debug: createWriter('debug')
  };
}

const log = createLogger('background', 'info');

const TAB_STATE = new Map();
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);
const PLANFIX_URL_PATTERN = /^https:\/\/dao\.planfix\.ua\//;
const PLANFIX_POPUP_PATH = 'planfix/popup.html';

chrome.runtime.onInstalled.addListener(() => {
  log.info('Extension installed or updated');
  chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
  chrome.action.setBadgeText({ text: '' });
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab?.id !== undefined) {
        syncActionPopup(tab.id, tab.url);
      }
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab?.id !== undefined) {
        syncActionPopup(tab.id, tab.url);
      }
    }
  });
});

function isSupportedUrl(url) {
  if (!url) {
    log.debug('Tab does not expose URL — skipping PiP toggle');
    return false;
  }
  try {
    const { protocol } = new URL(url);
    const isAllowed = SUPPORTED_PROTOCOLS.has(protocol);
    if (!isAllowed) {
      log.debug('URL protocol is not supported for PiP', { url, protocol });
    }
    return isAllowed;
  } catch (error) {
    log.warn('Unable to parse tab URL — treating as unsupported', { url, error });
    return false;
  }
}

function isPlanfixUrl(url) {
  return typeof url === 'string' && PLANFIX_URL_PATTERN.test(url);
}

async function syncActionPopup(tabId, urlHint) {
  if (tabId === undefined) return;

  try {
    let url = typeof urlHint === 'string' ? urlHint : undefined;
    if (!url) {
      const tab = await chrome.tabs.get(tabId);
      url = tab?.url ?? '';
    }
    const popupPath = isPlanfixUrl(url) ? PLANFIX_POPUP_PATH : '';
    await chrome.action.setPopup({ tabId, popup: popupPath });
    log.debug('Action popup synced', { tabId, url, popup: popupPath || null });
  } catch (error) {
    const message = chrome.runtime.lastError?.message ?? error?.message ?? String(error);
    log.warn('Failed to sync action popup', { tabId, error: message });
  }
}

async function requestToggle(tabId, trigger = 'action') {
  log.debug('Sending PiP toggle request', { tabId, trigger });
  try {
    await chrome.tabs.sendMessage(
      tabId,
      {
        command: 'PIP_TOGGLE_REQUEST',
        trigger
      },
      { frameId: 0 }
    );
  } catch (error) {
    const runtimeMessage = chrome.runtime.lastError?.message ?? error?.message;
    log.warn('PiP toggle request failed', { tabId, trigger, error: runtimeMessage });
    chrome.action.setBadgeText({ tabId, text: 'ERR' });
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2500);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id === undefined) {
    log.debug('Toolbar icon click ignored — tab missing');
    return;
  }

  log.info('Toolbar icon clicked', { tabId: tab.id, url: tab.url, trigger: 'action' });

  if (isPlanfixUrl(tab.url)) {
    log.debug('Toolbar click ignored on Planfix tab — popup handles interaction');
    return;
  }

  if (!isSupportedUrl(tab.url)) {
    chrome.action.setBadgeText({ tabId: tab.id, text: 'N/A' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 2000);
    return;
  }

  await requestToggle(tab.id, 'action');
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-pip') return;

  try {
    const targetTabId = tab?.id ?? (await getActiveTabId());
    if (targetTabId === undefined) {
      log.debug('No target tab for keyboard command', { command });
      return;
    }

    const targetTab = tab ?? await chrome.tabs.get(targetTabId);
    log.info('Keyboard command received', {
      tabId: targetTabId,
      url: targetTab?.url,
      trigger: 'command'
    });

    if (!isSupportedUrl(targetTab.url)) {
      log.debug('Command ignored — unsupported URL', { tabId: targetTabId, url: targetTab?.url });
      return;
    }

    await requestToggle(targetTabId, 'command');
  } catch (error) {
    log.error('Failed to handle toggle command', error);
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.source !== 'pip-page') return;

  const tabId = sender.tab?.id;
  if (tabId === undefined) return;

  log.debug('Message received from pip-page', { tabId, type: message.type });

  switch (message.type) {
    case 'PIP_STATE':
      TAB_STATE.set(tabId, message.state === 'open');
      updateBadge(tabId);
      log.info('Updated PiP state', {
        tabId,
        state: message.state,
        trigger: message.trigger
      });
      break;
    case 'PIP_UNSUPPORTED':
      TAB_STATE.delete(tabId);
      chrome.action.setBadgeText({ tabId, text: '!' });
      setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2500);
      log.warn('Tab reported PiP as unsupported', {
        tabId,
        reason: message.reason,
        details: message.message
      });
      break;
    case 'PIP_RESTORE_REQUEST':
      log.info('Tab requested PiP restore', { tabId, trigger: message.trigger });
      requestToggle(tabId, 'page-request');
      break;
    default:
      log.debug('Unknown message type received', { tabId, type: message.type });
      break;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined) {
    syncActionPopup(tabId, changeInfo.url);
  } else if (changeInfo.status === 'complete') {
    syncActionPopup(tabId, tab?.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (TAB_STATE.delete(tabId)) {
    log.debug('Cleared PiP state for closed tab', { tabId });
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  log.debug('Tab activated, refreshing badge', { tabId });
  updateBadge(tabId);
  syncActionPopup(tabId);
});

async function getActiveTabId() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id;
}

function updateBadge(tabId) {
  const isOpen = TAB_STATE.get(tabId) === true;
  chrome.action.setBadgeText({ tabId, text: isOpen ? 'ON' : '' });
  log.debug('Badge updated', { tabId, status: isOpen ? 'ON' : 'OFF' });
}
