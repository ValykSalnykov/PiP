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
const SYRVE_TAB_CREDENTIALS = new Map();
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);
const HEALTH_PERIOD_TIMEOUT_MS = 30000;
const SERVER_AVAILABILITY_TIMEOUT_MS = 4000;
const SYRVE_CREDENTIAL_TTL_MS = 120000;
const CREDENTIALS_LOOKUP_URL = 'http://daologistics.duckdns.org:8100/credentials/lookup';
const LICENSE_CHECK_URL = 'http://daologistics.duckdns.org:8100/license/check';
const STORAGE_KEYS = {
  clientId: 'userInput',
  apiKey: 'credentialsApiKey'
};

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

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result || {});
    });
  });
}

function normalizeCredentialId(value) {
  const normalizedValue = String(value ?? '').trim();
  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error('Client ID має бути числовим, щоб отримати логін та пароль.');
  }

  return Number(normalizedValue);
}

function buildCredentialsLookupErrorMessage(status, payload) {
  const serverMessage = typeof payload?.error === 'string' ? payload.error.trim() : '';

  switch (status) {
    case 400:
      return serverMessage || 'Сервер credentials відхилив Client ID. Перевірте, що він числовий.';
    case 401:
      return 'Розширення не передало X-API-Key для отримання логіна та пароля.';
    case 403:
      return 'X-API-Key для credentials API неправильний.';
    case 404:
      return 'Для цього Client ID не знайдено логін і пароль.';
    case 503:
      return 'Сервер credentials не налаштований.';
    case 500:
      return 'Сервер credentials повернув внутрішню помилку.';
    default:
      return serverMessage || `Сервер credentials повернув помилку зі статусом ${status}.`;
  }
}

function normalizeLicenseServerAddress(value) {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue || /\s/.test(normalizedValue) || normalizedValue.includes('://') || /[/?#@]/.test(normalizedValue)) {
    throw new Error('Некоректна адреса сервера для перевірки ліцензій.');
  }

  return normalizedValue;
}

function normalizeLicenseServerPort(value) {
  const normalizedValue = String(value ?? '').trim();
  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error('Некоректний порт сервера для перевірки ліцензій.');
  }

  const parsedPort = Number(normalizedValue);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error('Порт сервера для перевірки ліцензій має бути в межах від 1 до 65535.');
  }

  return parsedPort;
}

function buildLicenseCheckErrorMessage(status, payload) {
  const serverMessage = typeof payload?.error === 'string'
    ? payload.error.trim()
    : typeof payload?.message === 'string'
      ? payload.message.trim()
      : '';

  switch (status) {
    case 400:
      return serverMessage || 'Сервер license check відхилив адресу або порт.';
    case 401:
      return 'Розширення не передало X-API-Key для перевірки ліцензій.';
    case 403:
      return 'X-API-Key для license check неправильний.';
    case 500:
      return 'Сервер license check не налаштований або має внутрішню помилку.';
    case 502:
      return 'Syrve повернув некоректну відповідь або недоступний для перевірки.';
    case 504:
      return 'Syrve не відповів вчасно на перевірку ліцензій.';
    default:
      return serverMessage || `Сервер license check повернув помилку зі статусом ${status}.`;
  }
}

function sanitizeLicenseCheckServer(server) {
  if (!server || typeof server !== 'object') {
    return {};
  }

  const result = {};
  const stringFields = ['companyName', 'serialNumber', 'crmId', 'serverType', 'licenseStatus'];
  stringFields.forEach((fieldName) => {
    const fieldValue = server[fieldName];
    if (typeof fieldValue === 'string' && fieldValue.trim()) {
      result[fieldName] = fieldValue.trim();
    }
  });

  if (typeof server.statusMessage === 'string' && server.statusMessage.trim()) {
    result.statusMessage = server.statusMessage.trim();
  } else if (server.statusMessage === null) {
    result.statusMessage = null;
  }

  return result;
}

function sanitizeLicenseCheckLicenses(licenses) {
  if (!Array.isArray(licenses)) {
    return [];
  }

  return licenses.reduce((result, license) => {
    if (!license || typeof license !== 'object') {
      return result;
    }

    const id = typeof license.id === 'string' || typeof license.id === 'number'
      ? String(license.id).trim()
      : '';
    const name = typeof license.name === 'string' ? license.name.trim() : '';
    const friendlyName = typeof license.friendlyName === 'string' ? license.friendlyName.trim() : '';
    const groupId = typeof license.groupId === 'string' && license.groupId.trim()
      ? license.groupId.trim()
      : 'other';
    const countValue = Number(license.count);
    const count = Number.isFinite(countValue) ? countValue : null;
    const validUntil = typeof license.validUntil === 'string' ? license.validUntil.trim() : '';

    if (!id && !name && !friendlyName) {
      return result;
    }

    result.push({
      id,
      name,
      friendlyName,
      groupId,
      count,
      validUntil
    });

    return result;
  }, []);
}

async function fetchSyrveCredentials() {
  const storageData = await storageGet([STORAGE_KEYS.clientId, STORAGE_KEYS.apiKey]);
  const clientId = storageData[STORAGE_KEYS.clientId];
  const normalizedClientId = String(clientId ?? '').trim();
  const apiKey = String(storageData[STORAGE_KEYS.apiKey] ?? '').trim();

  if (!normalizedClientId) {
    throw new Error('Спочатку збережіть Client ID у popup розширення.');
  }

  if (!apiKey) {
    throw new Error('Спочатку збережіть X-API-Key у popup розширення.');
  }

  const credentialId = normalizeCredentialId(normalizedClientId);
  let response;

  try {
    response = await fetch(CREDENTIALS_LOOKUP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-User-Id': normalizedClientId
      },
      body: JSON.stringify({ id: credentialId })
    });
  } catch (error) {
    throw new Error('Не вдалося звернутися до сервера credentials. Перевірте мережу та доступність сервера.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(buildCredentialsLookupErrorMessage(response.status, payload));
  }

  const credential = payload?.credential;
  if (!credential || typeof credential.login !== 'string' || typeof credential.password !== 'string') {
    throw new Error('Сервер credentials повернув некоректну відповідь.');
  }

  return {
    id: credentialId,
    login: credential.login,
    password: credential.password
  };
}

async function fetchSyrveLicenseCheck({ address, port }) {
  const storageData = await storageGet([STORAGE_KEYS.clientId, STORAGE_KEYS.apiKey]);
  const clientId = String(storageData[STORAGE_KEYS.clientId] ?? '').trim();
  const apiKey = String(storageData[STORAGE_KEYS.apiKey] ?? '').trim();

  if (!clientId) {
    throw new Error('Спочатку збережіть User ID у popup розширення.');
  }

  if (!apiKey) {
    throw new Error('Спочатку збережіть X-API-Key у popup розширення.');
  }

  const normalizedAddress = normalizeLicenseServerAddress(address);
  const normalizedPort = normalizeLicenseServerPort(port);

  let response;
  try {
    response = await fetch(LICENSE_CHECK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-User-Id': clientId
      },
      body: JSON.stringify({
        address: normalizedAddress,
        port: normalizedPort
      })
    });
  } catch (error) {
    throw new Error('Не вдалося звернутися до сервера перевірки ліцензій. Перевірте мережу та доступність сервера.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(buildLicenseCheckErrorMessage(response.status, payload));
  }

  const result = payload?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('Сервер license check повернув некоректну відповідь.');
  }

  return {
    address: normalizedAddress,
    port: normalizedPort,
    result: {
      server: sanitizeLicenseCheckServer(result.server),
      licenses: sanitizeLicenseCheckLicenses(result.licenses)
    }
  };
}

function cacheSyrveCredentialsForTab(tabId, credential) {
  if (tabId === undefined) {
    return;
  }

  SYRVE_TAB_CREDENTIALS.set(tabId, {
    login: credential.login,
    password: credential.password,
    expiresAt: Date.now() + SYRVE_CREDENTIAL_TTL_MS
  });
}

function getSyrveCredentialsForTab(tabId) {
  const cached = SYRVE_TAB_CREDENTIALS.get(tabId);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    SYRVE_TAB_CREDENTIALS.delete(tabId);
    return null;
  }

  return {
    login: cached.login,
    password: cached.password
  };
}

function clearSyrveCredentialsForTab(tabId) {
  SYRVE_TAB_CREDENTIALS.delete(tabId);
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
      port: message.port,
      requestId: message.requestId
    })
      .then((serviceTabId) => sendResponse({ ok: true, tabId: serviceTabId }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to open health tab' }));

    return true;
  }

  if (message?.action === 'OPEN_SYRVE_PAGE') {
    if (!message.server || !message.path) {
      sendResponse({ ok: false, error: 'Missing server or path' });
      return false;
    }

    openSyrvePage({
      server: message.server,
      port: message.port,
      path: message.path,
      active: message.active !== false
    })
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to open Syrve page' }));

    return true;
  }

  if (message?.action === 'GET_SYRVE_CREDENTIALS') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      sendResponse({ ok: false, error: 'Missing tab id' });
      return false;
    }

    const credentials = getSyrveCredentialsForTab(tabId);
    if (!credentials) {
      fetchSyrveCredentials()
        .then((credential) => {
          cacheSyrveCredentialsForTab(tabId, credential);
          sendResponse({
            ok: true,
            credential: {
              login: credential.login,
              password: credential.password
            }
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error?.message || 'Credentials для цієї вкладки не знайдено або час очікування сплив.'
          });
        });
      return true;
    }

    sendResponse({ ok: true, credential: credentials });
    return false;
  }

  if (message?.action === 'CHECK_SYRVE_LICENSE') {
    if (!message.address || message.port === undefined || message.port === null || message.port === '') {
      sendResponse({ ok: false, error: 'Missing address or port' });
      return false;
    }

    fetchSyrveLicenseCheck({
      address: message.address,
      port: message.port
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to check Syrve license' }));

    return true;
  }

  if (message?.action === 'PROBE_SERVER_AVAILABILITY') {
    if (!message.server) {
      sendResponse({ ok: false, error: 'Missing server' });
      return false;
    }

    probeServerAvailability({
      server: message.server,
      port: message.port
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to probe server availability' }));

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

  clearSyrveCredentialsForTab(tabId);

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

function isHttpOnlySyrveHost(server) {
  const normalizedServer = String(server ?? '').trim().toLowerCase();
  return isPublicIpv4SyrveHost(normalizedServer) || normalizedServer.endsWith('.daocloud.fun');
}

function getIpv4Octets(value) {
  const normalizedValue = String(value ?? '').trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedValue)) {
    return null;
  }

  const octets = normalizedValue.split('.').map((part) => Number(part));
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? octets : null;
}

function isPrivateOrReservedIpv4Host(value) {
  const octets = getIpv4Octets(value);
  if (!octets) {
    return false;
  }

  const [first, second] = octets;

  if (first === 0 || first === 10 || first === 127 || first >= 224) {
    return true;
  }

  if (first === 169 && second === 254) {
    return true;
  }

  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  if (first === 192 && second === 168) {
    return true;
  }

  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }

  if (first === 198 && (second === 18 || second === 19)) {
    return true;
  }

  return false;
}

function isPublicIpv4SyrveHost(value) {
  return Boolean(getIpv4Octets(value)) && !isPrivateOrReservedIpv4Host(value);
}

function buildSyrvePageUrl({ server, port, path }) {
  const normalizedServer = String(server ?? '').trim().toLowerCase();
  const normalizedPort = String(port ?? '').trim();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const protocol = isHttpOnlySyrveHost(normalizedServer) ? 'http' : 'https';
  const portSegment = normalizedPort ? `:${normalizedPort}` : '';
  return `${protocol}://${normalizedServer}${portSegment}${normalizedPath}`;
}

async function openHealthPeriodTab({ requesterTabId, server, port, requestId }) {
  const credential = await fetchSyrveCredentials();
  const createdTab = await chrome.tabs.create({
    url: buildSyrvePageUrl({
      server,
      port,
      path: '/resto/service/monitoring/health.jsp'
    }),
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

  cacheSyrveCredentialsForTab(createdTab.id, credential);

  log.info('Opened health period tab', {
    requesterTabId,
    serviceTabId: createdTab.id,
    server,
    port,
    requestId
  });

  return createdTab.id;
}

async function openSyrvePage({ server, path, port, active = true }) {
  const credential = await fetchSyrveCredentials();
  const createdTab = await chrome.tabs.create({
    url: buildSyrvePageUrl({ server, port, path }),
    active
  });

  if (createdTab.id === undefined) {
    throw new Error('Syrve tab was created without an id');
  }

  cacheSyrveCredentialsForTab(createdTab.id, credential);
  log.info('Opened Syrve page after credentials preflight', {
    serviceTabId: createdTab.id,
    server,
    port,
    path,
    active
  });

  return createdTab.id;
}

async function probeServerAvailability({ server, port }) {
  const url = buildSyrvePageUrl({ server, port, path: '/resto/' });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SERVER_AVAILABILITY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal
    });

    const reachable = response.ok || response.status === 401 || response.status === 403;
    return {
      reachable,
      status: response.status,
      url
    };
  } catch (error) {
    const isAbortError = error?.name === 'AbortError';
    return {
      reachable: false,
      status: null,
      url,
      error: isAbortError
        ? `Не вдалося дочекатися відповіді від ${url}.`
        : `Не вдалося підключитися до ${url}.`
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function finalizeHealthPeriodRequest(serviceTabId, result) {
  const request = HEALTH_PERIOD_REQUESTS.get(serviceTabId);
  if (!request) {
    return;
  }

  HEALTH_PERIOD_REQUESTS.delete(serviceTabId);
  clearTimeout(request.timeoutId);
  clearSyrveCredentialsForTab(serviceTabId);

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
