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
const HEALTH_PERIOD_REQUESTS = new Map();
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);
const HEALTH_PERIOD_TIMEOUT_MS = 30000;

chrome.runtime.onInstalled.addListener(() => {
  log.info('Extension installed or updated');
  chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
  chrome.action.setBadgeText({ text: '' });
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source === 'pip-page') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;

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

    return false;
  }

  if (message?.action === 'OPEN_HEALTH_PERIOD_TAB') {
    const requesterTabId = sender.tab?.id;
    if (requesterTabId === undefined || !message.server || !message.requestId) {
      sendResponse({ ok: false, error: 'Missing requester tab, server, or request id' });
      return false;
    }

    openHealthPeriodTab({
      requesterTabId,
      server: message.server,
      requestId: message.requestId
    })
      .then((serviceTabId) => sendResponse({ ok: true, tabId: serviceTabId }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to open health tab' }));

    return true;
  }

  if (message?.action === 'SYRVE_HEALTH_PERIOD_RESULT') {
    const serviceTabId = sender.tab?.id;
    if (serviceTabId === undefined) return false;

    finalizeHealthPeriodRequest(serviceTabId, {
      period: message.period,
      error: message.error
    });
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (TAB_STATE.delete(tabId)) {
    log.debug('Cleared PiP state for closed tab', { tabId });
  }

  const request = HEALTH_PERIOD_REQUESTS.get(tabId);
  if (request) {
    HEALTH_PERIOD_REQUESTS.delete(tabId);
    clearTimeout(request.timeoutId);
    notifyHealthPeriodResult(request.requesterTabId, {
      requestId: request.requestId,
      error: 'Службова вкладка отримання періоду була закрита раніше завершення.'
    });
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  log.debug('Tab activated, refreshing badge', { tabId });
  updateBadge(tabId);
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

async function openHealthPeriodTab({ requesterTabId, server, requestId }) {
  const createdTab = await chrome.tabs.create({
    url: `https://${server}/resto/service/monitoring/health.jsp`,
    active: false
  });

  if (createdTab.id === undefined) {
    throw new Error('Health tab was created without an id');
  }

  const timeoutId = setTimeout(() => {
    finalizeHealthPeriodRequest(createdTab.id, {
      error: 'Перевищено час очікування відповіді від сторінки health.jsp.'
    });
  }, HEALTH_PERIOD_TIMEOUT_MS);

  HEALTH_PERIOD_REQUESTS.set(createdTab.id, {
    requesterTabId,
    requestId,
    timeoutId
  });

  log.info('Opened health period tab', {
    requesterTabId,
    serviceTabId: createdTab.id,
    server,
    requestId
  });

  return createdTab.id;
}

function finalizeHealthPeriodRequest(serviceTabId, result) {
  const request = HEALTH_PERIOD_REQUESTS.get(serviceTabId);
  if (!request) {
    return;
  }

  HEALTH_PERIOD_REQUESTS.delete(serviceTabId);
  clearTimeout(request.timeoutId);

  notifyHealthPeriodResult(request.requesterTabId, {
    requestId: request.requestId,
    period: result.period,
    error: result.error
  });

  chrome.tabs.remove(serviceTabId).catch((error) => {
    log.debug('Health period tab already closed', { serviceTabId, error: error?.message });
  });
}

function notifyHealthPeriodResult(requesterTabId, payload) {
  chrome.tabs.sendMessage(requesterTabId, {
    action: 'HEALTH_PERIOD_RESULT',
    ...payload
  }).catch((error) => {
    log.warn('Failed to deliver health period result to PlanFix tab', {
      requesterTabId,
      error: error?.message
    });
  });
}
