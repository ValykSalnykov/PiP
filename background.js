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
const SYRVE_CREDENTIAL_TTL_MS = 120000;
const HELPDESK_DRAFT_REQUEST_TTL_MS = 5 * 60 * 1000;
const EXTENSION_ACCESS_REQUEST_URL = 'http://daologistics.duckdns.org:8100/extension/access/request';
const EXTENSION_ACCESS_CLAIM_URL = 'http://daologistics.duckdns.org:8100/extension/access/claim';
const CREDENTIALS_LOOKUP_URL = 'http://daologistics.duckdns.org:8100/credentials/lookup';
const SERVER_AVAILABILITY_URL = 'http://daologistics.duckdns.org:8100/server/availability';
const LICENSE_CHECK_URL = 'http://daologistics.duckdns.org:8100/license/check';
const HELPDESK_DRAFT_URL_BASE = 'https://pro.helpdeskeddy.com/ua/ticket/list/filter/id/352/ticket/create/draft/';
const STORAGE_KEYS = {
  userId: 'userInput',
  legacyApiKey: 'credentialsApiKey',
  extensionClientId: 'extensionClientId',
  extensionRequestId: 'extensionAccessRequestId',
  extensionKey: 'extensionAccessKey',
  accessNotice: 'extensionAccessNotice',
  helpDeskDraftRequests: 'helpDeskDraftRequests',
  helpDeskNextDraftNumber: 'helpDeskNextDraftNumber'
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

function storageSet(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => {
      resolve();
    });
  });
}

function storageRemove(keys) {
  const normalizedKeys = Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean);
  if (!normalizedKeys.length) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    chrome.storage.local.remove(normalizedKeys, () => {
      resolve();
    });
  });
}

function normalizeHelpDeskDraftRequestId(value) {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue) {
    throw new Error('Missing HelpDeskEddy draft request id');
  }

  return normalizedValue;
}

function normalizeHelpDeskDraftNumber(value, fallback = 1) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return numericValue;
}

function pruneHelpDeskDraftRequests(rawEntries, now = Date.now()) {
  const sourceEntries = rawEntries && typeof rawEntries === 'object' && !Array.isArray(rawEntries)
    ? rawEntries
    : {};
  const nextEntries = {};
  let wasPruned = sourceEntries !== rawEntries;

  Object.entries(sourceEntries).forEach(([requestId, request]) => {
    if (!request || typeof request !== 'object') {
      wasPruned = true;
      return;
    }

    const createdAt = Number(request.createdAt);
    if (!Number.isFinite(createdAt) || now - createdAt > HELPDESK_DRAFT_REQUEST_TTL_MS) {
      wasPruned = true;
      return;
    }

    nextEntries[requestId] = request;
  });

  if (!wasPruned && Object.keys(nextEntries).length !== Object.keys(sourceEntries).length) {
    wasPruned = true;
  }

  return {
    entries: nextEntries,
    wasPruned
  };
}

async function getHelpDeskDraftRequests() {
  const result = await storageGet(STORAGE_KEYS.helpDeskDraftRequests);
  const { entries, wasPruned } = pruneHelpDeskDraftRequests(result?.[STORAGE_KEYS.helpDeskDraftRequests]);
  if (wasPruned) {
    await storageSet({
      [STORAGE_KEYS.helpDeskDraftRequests]: entries
    });
  }

  return entries;
}

function setHelpDeskDraftRequests(entries) {
  return storageSet({
    [STORAGE_KEYS.helpDeskDraftRequests]: entries
  });
}

async function reserveHelpDeskDraftNumber(existingRequests = null) {
  const requests = existingRequests || await getHelpDeskDraftRequests();
  const storedState = await storageGet(STORAGE_KEYS.helpDeskNextDraftNumber);
  const storedDraftNumber = normalizeHelpDeskDraftNumber(storedState?.[STORAGE_KEYS.helpDeskNextDraftNumber], 1);
  const highestActiveDraftNumber = Object.values(requests).reduce((maxDraftNumber, request) => {
    return Math.max(maxDraftNumber, normalizeHelpDeskDraftNumber(request?.draftNumber, 0));
  }, 0);

  const draftNumber = Math.max(storedDraftNumber, highestActiveDraftNumber + 1, 1);
  await storageSet({
    [STORAGE_KEYS.helpDeskNextDraftNumber]: draftNumber + 1
  });

  return draftNumber;
}

function buildHelpDeskDraftUrl(requestId, draftNumber) {
  const normalizedDraftNumber = normalizeHelpDeskDraftNumber(draftNumber, 1);
  const url = new URL(`${HELPDESK_DRAFT_URL_BASE}${normalizedDraftNumber}`);
  url.hash = new URLSearchParams({
    'dao-tools-request': requestId
  }).toString();
  return url.toString();
}

async function openHelpDeskDraftTab({ requesterTabId, payload, active = true }) {
  if (requesterTabId === undefined) {
    throw new Error('Missing requester tab id');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Missing HelpDeskEddy draft payload');
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const requests = await getHelpDeskDraftRequests();
  const draftNumber = await reserveHelpDeskDraftNumber(requests);
  const createdTab = await chrome.tabs.create({
    url: buildHelpDeskDraftUrl(requestId, draftNumber),
    active
  });

  if (createdTab.id === undefined) {
    throw new Error('HelpDeskEddy tab was created without an id');
  }

  requests[requestId] = {
    createdAt: Date.now(),
    requesterTabId,
    targetTabId: createdTab.id,
    draftNumber,
    payload
  };

  await setHelpDeskDraftRequests(requests);
  log.info('Opened HelpDeskEddy draft tab', {
    requesterTabId,
    targetTabId: createdTab.id,
    requestId,
    draftNumber
  });

  return {
    requestId,
    tabId: createdTab.id,
    draftNumber
  };
}

async function getHelpDeskDraftRequest(requestId) {
  const normalizedRequestId = normalizeHelpDeskDraftRequestId(requestId);
  const requests = await getHelpDeskDraftRequests();
  const request = requests[normalizedRequestId] ?? null;
  if (!request) {
    return null;
  }

  return {
    requestId: normalizedRequestId,
    ...request
  };
}

async function getHelpDeskDraftRequestByTabId(tabId) {
  if (tabId === undefined) {
    return null;
  }

  const requests = await getHelpDeskDraftRequests();
  const matchedEntry = Object.entries(requests).find(([, request]) => request?.targetTabId === tabId);
  if (!matchedEntry) {
    return null;
  }

  const [requestId, request] = matchedEntry;
  return {
    requestId,
    ...request
  };
}

function notifyHelpDeskDraftResult(requesterTabId, payload) {
  if (requesterTabId === undefined) {
    return;
  }

  chrome.tabs.sendMessage(requesterTabId, {
    action: 'HELPDESK_DRAFT_FILL_RESULT',
    ...payload
  }).catch((error) => {
    log.warn('Failed to deliver HelpDeskEddy draft result to PlanFix tab', {
      requesterTabId,
      error: error?.message
    });
  });
}

async function finalizeHelpDeskDraftRequest({ requestId, ok, error, sourceTabId }) {
  const normalizedRequestId = normalizeHelpDeskDraftRequestId(requestId);
  const requests = await getHelpDeskDraftRequests();
  const request = requests[normalizedRequestId];
  if (!request) {
    return false;
  }

  delete requests[normalizedRequestId];
  await setHelpDeskDraftRequests(requests);
  notifyHelpDeskDraftResult(request.requesterTabId, {
    requestId: normalizedRequestId,
    ok,
    error,
    helpdeskTabId: request.targetTabId ?? sourceTabId
  });

  const logMethod = ok ? 'info' : 'warn';
  log[logMethod]('Finalized HelpDeskEddy draft request', {
    requestId: normalizedRequestId,
    requesterTabId: request.requesterTabId,
    targetTabId: request.targetTabId ?? sourceTabId,
    ok,
    error
  });
  return true;
}

async function resolveClosedHelpDeskDraftTab(tabId) {
  const requests = await getHelpDeskDraftRequests();
  let didChange = false;

  Object.entries(requests).forEach(([requestId, request]) => {
    if (request?.targetTabId !== tabId) {
      return;
    }

    delete requests[requestId];
    didChange = true;
    notifyHelpDeskDraftResult(request.requesterTabId, {
      requestId,
      ok: false,
      error: 'Вкладку чернетки HelpDeskEddy закрито до завершення автозаповнення.',
      helpdeskTabId: tabId
    });
  });

  if (didChange) {
    await setHelpDeskDraftRequests(requests);
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function extractServerMessage(payload) {
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }

  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }

  return '';
}

function normalizeUserId(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    throw new Error('Вкажіть User ID у popup розширення.');
  }

  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error('User ID має містити лише цифри.');
  }

  return normalizedValue;
}

function normalizeCredentialId(value) {
  return Number(normalizeUserId(value));
}

function buildCredentialsLookupErrorMessage(status, payload) {
  const serverMessage = extractServerMessage(payload);

  switch (status) {
    case 400:
      return serverMessage || 'Сервер credentials відхилив User ID. Перевірте, що він числовий.';
    case 401:
      return 'Розширення не передало X-Extension-Key для отримання логіна та пароля. Завершіть доступ пристрою у popup.';
    case 403:
      return 'Персональний доступ цього пристрою до credentials недійсний або відкликаний. Попросіть адміністратора видати новий код підтвердження.';
    case 404:
      return 'Для цього User ID не знайдено логін і пароль.';
    case 503:
      return 'Сервер credentials не налаштований.';
    case 500:
      return 'Сервер credentials повернув внутрішню помилку.';
    default:
      return serverMessage || `Сервер credentials повернув помилку зі статусом ${status}.`;
  }
}

function normalizeProtectedServerAddress(value, errorMessage) {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue || /\s/.test(normalizedValue) || normalizedValue.includes('://') || /[/?#@]/.test(normalizedValue)) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function normalizeProtectedServerPort(value, invalidMessage, outOfRangeMessage) {
  const normalizedValue = String(value ?? '').trim();
  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error(invalidMessage);
  }

  const parsedPort = Number(normalizedValue);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(outOfRangeMessage);
  }

  return parsedPort;
}

function normalizeLicenseServerAddress(value) {
  return normalizeProtectedServerAddress(value, 'Некоректна адреса сервера для перевірки ліцензій.');
}

function normalizeLicenseServerPort(value) {
  return normalizeProtectedServerPort(
    value,
    'Некоректний порт сервера для перевірки ліцензій.',
    'Порт сервера для перевірки ліцензій має бути в межах від 1 до 65535.'
  );
}

function normalizeServerAvailabilityAddress(value) {
  return normalizeProtectedServerAddress(value, 'Некоректна адреса сервера для перевірки доступності сервера.');
}

function normalizeServerAvailabilityPort(value) {
  return normalizeProtectedServerPort(
    value,
    'Некоректний порт сервера для перевірки доступності сервера.',
    'Порт сервера для перевірки доступності сервера має бути в межах від 1 до 65535.'
  );
}

function buildLicenseCheckErrorMessage(status, payload) {
  const serverMessage = extractServerMessage(payload);

  switch (status) {
    case 400:
      return serverMessage || 'Сервер license check відхилив адресу або порт.';
    case 401:
      return 'Розширення не передало X-Extension-Key для перевірки ліцензій. Завершіть доступ пристрою у popup.';
    case 403:
      return 'Персональний доступ цього пристрою до license check недійсний або відкликаний. Попросіть адміністратора видати новий код підтвердження.';
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

function buildServerAvailabilityErrorMessage(status, payload) {
  const serverMessage = extractServerMessage(payload);

  switch (status) {
    case 400:
      return serverMessage || 'Сервер перевірки доступності відхилив адресу або порт.';
    case 401:
      return 'Розширення не передало X-Extension-Key для перевірки доступності сервера. Завершіть доступ пристрою у popup.';
    case 403:
      return 'Персональний доступ цього пристрою до перевірки доступності сервера недійсний або відкликаний. Попросіть адміністратора видати новий код підтвердження.';
    case 500:
      return 'Сервер перевірки доступності не налаштований або має внутрішню помилку.';
    default:
      return serverMessage || `Сервер перевірки доступності повернув помилку зі статусом ${status}.`;
  }
}

function extractRequestId(payload) {
  return String(payload?.request?.requestId ?? payload?.requestId ?? '').trim();
}

function buildAccessRequestErrorMessage(status, payload) {
  const serverMessage = extractServerMessage(payload);

  switch (status) {
    case 400:
      return serverMessage || 'Сервер доступу відхилив User ID або дані пристрою.';
    default:
      return serverMessage || `Сервер доступу повернув помилку зі статусом ${status}.`;
  }
}

function buildAccessClaimErrorMessage(status, payload) {
  const serverMessage = extractServerMessage(payload);

  switch (status) {
    case 400:
      return serverMessage || 'Request ID або код підтвердження мають некоректний формат.';
    case 403:
      return 'Код підтвердження неправильний. Перевірте код або зверніться до адміністратора.';
    case 404:
      return 'Запит доступу не знайдено. Спробуйте запросити доступ для пристрою ще раз.';
    case 409:
      return 'Пристрій ще не схвалено в адмінці. Дочекайтеся підтвердження адміністратора.';
    case 410:
      return 'Код підтвердження прострочений або вже використаний. Попросіть адміністратора видати новий код.';
    default:
      return serverMessage || `Сервер claim повернув помилку зі статусом ${status}.`;
  }
}

function buildAccessRequestNotice(status) {
  if (status === 200) {
    return 'Запит для цього пристрою знайдено. Якщо адміністратор уже видав код підтвердження, введіть його у popup.';
  }

  return 'Запит на доступ до пристрою збережено. Після ручного схвалення введіть код підтвердження у popup.';
}

function getBrowserLabel() {
  const userAgent = navigator.userAgent || '';

  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/Chrome\//.test(userAgent)) return 'Chrome';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) return 'Safari';

  return 'Browser';
}

function getDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Unknown device';
  return `${getBrowserLabel()} on ${platform}`;
}

function buildExtensionAccessState(storageData) {
  const userId = String(storageData?.[STORAGE_KEYS.userId] ?? '').trim();
  const clientId = String(storageData?.[STORAGE_KEYS.extensionClientId] ?? '').trim();
  const requestId = String(storageData?.[STORAGE_KEYS.extensionRequestId] ?? '').trim();
  const extensionKey = String(storageData?.[STORAGE_KEYS.extensionKey] ?? '').trim();
  const notice = String(storageData?.[STORAGE_KEYS.accessNotice] ?? '').trim();

  let status = 'needs-user';
  if (userId) {
    status = extensionKey ? 'granted' : requestId ? 'awaiting-claim' : 'ready-to-request';
  }

  return {
    status,
    userId,
    clientId,
    requestId,
    hasExtensionKey: Boolean(extensionKey),
    notice
  };
}

async function getExtensionAccessState() {
  const storageData = await storageGet([
    STORAGE_KEYS.userId,
    STORAGE_KEYS.extensionClientId,
    STORAGE_KEYS.extensionRequestId,
    STORAGE_KEYS.extensionKey,
    STORAGE_KEYS.accessNotice
  ]);

  return buildExtensionAccessState(storageData);
}

function clearAllSyrveCredentials() {
  SYRVE_TAB_CREDENTIALS.clear();
}

async function saveUserId(rawUserId) {
  const userId = normalizeUserId(rawUserId);
  const storageData = await storageGet([STORAGE_KEYS.userId]);
  const previousUserId = String(storageData[STORAGE_KEYS.userId] ?? '').trim();
  const hasChanged = previousUserId !== userId;

  await storageSet({
    [STORAGE_KEYS.userId]: userId
  });

  const keysToRemove = [STORAGE_KEYS.legacyApiKey];
  if (hasChanged) {
    keysToRemove.push(
      STORAGE_KEYS.extensionRequestId,
      STORAGE_KEYS.extensionKey,
      STORAGE_KEYS.accessNotice
    );
  }

  await storageRemove([...new Set(keysToRemove)]);

  if (hasChanged) {
    clearAllSyrveCredentials();
  }

  if (previousUserId && hasChanged) {
    await storageSet({
      [STORAGE_KEYS.accessNotice]: 'User ID змінено. Для цього пристрою потрібно запросити доступ повторно.'
    });
  }

  return getExtensionAccessState();
}

async function getOrCreateClientId() {
  const storageData = await storageGet([STORAGE_KEYS.extensionClientId]);
  const storedClientId = String(storageData[STORAGE_KEYS.extensionClientId] ?? '').trim();

  if (storedClientId) {
    return storedClientId;
  }

  const clientId = crypto.randomUUID();
  await storageSet({
    [STORAGE_KEYS.extensionClientId]: clientId
  });

  return clientId;
}

async function requestExtensionAccess(rawUserId) {
  let userId = '';
  if (rawUserId !== undefined) {
    const nextState = await saveUserId(rawUserId);
    userId = nextState.userId;
  } else {
    const storageData = await storageGet([STORAGE_KEYS.userId]);
    userId = normalizeUserId(storageData[STORAGE_KEYS.userId]);
  }

  const clientId = await getOrCreateClientId();
  const deviceName = getDeviceName();
  let response;

  try {
    response = await fetch(EXTENSION_ACCESS_REQUEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId,
        clientId,
        deviceName
      })
    });
  } catch (error) {
    throw new Error('Не вдалося звернутися до сервера доступу. Перевірте мережу та доступність сервера.');
  }

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(buildAccessRequestErrorMessage(response.status, payload));
  }

  const requestId = extractRequestId(payload);
  if (!requestId) {
    throw new Error('Сервер доступу не повернув requestId.');
  }

  await storageSet({
    [STORAGE_KEYS.extensionClientId]: clientId,
    [STORAGE_KEYS.extensionRequestId]: requestId,
    [STORAGE_KEYS.accessNotice]: buildAccessRequestNotice(response.status)
  });
  await storageRemove([STORAGE_KEYS.legacyApiKey]);
  clearAllSyrveCredentials();

  return getExtensionAccessState();
}

async function claimExtensionKey({ requestId, claimCode }) {
  const storageData = await storageGet([STORAGE_KEYS.extensionRequestId]);
  const normalizedRequestId = String(requestId ?? storageData[STORAGE_KEYS.extensionRequestId] ?? '').trim();
  const normalizedClaimCode = String(claimCode ?? '').trim();

  if (!normalizedRequestId) {
    throw new Error('Спочатку запросіть доступ для пристрою, щоб отримати request ID.');
  }

  if (!normalizedClaimCode) {
    throw new Error('Введіть код підтвердження від адміністратора.');
  }

  let response;
  try {
    response = await fetch(EXTENSION_ACCESS_CLAIM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requestId: normalizedRequestId,
        claimCode: normalizedClaimCode
      })
    });
  } catch (error) {
    throw new Error('Не вдалося звернутися до сервера підтвердження доступу. Перевірте мережу та доступність сервера.');
  }

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(buildAccessClaimErrorMessage(response.status, payload));
  }

  const extensionKey = String(payload?.extensionKey ?? '').trim();
  if (!extensionKey) {
    throw new Error('Сервер підтвердження не повернув персональний ключ доступу.');
  }

  await storageSet({
    [STORAGE_KEYS.extensionRequestId]: extractRequestId(payload) || normalizedRequestId,
    [STORAGE_KEYS.extensionKey]: extensionKey,
    [STORAGE_KEYS.accessNotice]: 'Персональний доступ для цього пристрою активовано.'
  });
  await storageRemove([STORAGE_KEYS.legacyApiKey]);
  clearAllSyrveCredentials();

  return getExtensionAccessState();
}

async function clearInvalidExtensionKey(message) {
  await storageRemove([STORAGE_KEYS.extensionKey, STORAGE_KEYS.accessNotice]);

  if (message) {
    await storageSet({
      [STORAGE_KEYS.accessNotice]: message
    });
  }

  clearAllSyrveCredentials();
}

async function getProtectedRouteAuthContext() {
  const storageData = await storageGet([
    STORAGE_KEYS.userId,
    STORAGE_KEYS.extensionRequestId,
    STORAGE_KEYS.extensionKey
  ]);
  const userId = normalizeUserId(storageData[STORAGE_KEYS.userId]);
  const requestId = String(storageData[STORAGE_KEYS.extensionRequestId] ?? '').trim();
  const extensionKey = String(storageData[STORAGE_KEYS.extensionKey] ?? '').trim();

  if (!extensionKey) {
    if (requestId) {
      throw new Error('Пристрій ще не активовано. Відкрийте popup розширення та введіть код підтвердження від адміністратора.');
    }

    throw new Error('Спочатку запросіть доступ для пристрою у popup розширення.');
  }

  return {
    userId,
    requestId,
    extensionKey
  };
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
  const { userId, extensionKey } = await getProtectedRouteAuthContext();
  const credentialId = normalizeCredentialId(userId);
  let response;

  try {
    response = await fetch(CREDENTIALS_LOOKUP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Key': extensionKey,
        'X-User-Id': userId
      },
      body: JSON.stringify({ id: credentialId })
    });
  } catch (error) {
    throw new Error('Не вдалося звернутися до сервера credentials. Перевірте мережу та доступність сервера.');
  }

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    if (response.status === 403) {
      await clearInvalidExtensionKey('Персональний доступ цього пристрою відкликано або він більше недійсний. Попросіть адміністратора видати новий код підтвердження.');
    }

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
  const { userId, extensionKey } = await getProtectedRouteAuthContext();

  const normalizedAddress = normalizeLicenseServerAddress(address);
  const normalizedPort = normalizeLicenseServerPort(port);

  let response;
  try {
    response = await fetch(LICENSE_CHECK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Key': extensionKey,
        'X-User-Id': userId
      },
      body: JSON.stringify({
        address: normalizedAddress,
        port: normalizedPort
      })
    });
  } catch (error) {
    throw new Error('Не вдалося звернутися до сервера перевірки ліцензій. Перевірте мережу та доступність сервера.');
  }

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    if (response.status === 403) {
      await clearInvalidExtensionKey('Персональний доступ цього пристрою відкликано або він більше недійсний. Попросіть адміністратора видати новий код підтвердження.');
    }

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

async function fetchServerAvailability({ address, port }) {
  const { userId, extensionKey } = await getProtectedRouteAuthContext();

  const normalizedAddress = normalizeServerAvailabilityAddress(address);
  const normalizedPort = normalizeServerAvailabilityPort(port);

  let response;
  try {
    response = await fetch(SERVER_AVAILABILITY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Key': extensionKey,
        'X-User-Id': userId
      },
      body: JSON.stringify({
        address: normalizedAddress,
        port: normalizedPort
      })
    });
  } catch (error) {
    throw new Error('Не вдалося звернутися до сервера перевірки доступності. Перевірте мережу та доступність сервера.');
  }

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    if (response.status === 403) {
      await clearInvalidExtensionKey('Персональний доступ цього пристрою відкликано або він більше недійсний. Попросіть адміністратора видати новий код підтвердження.');
    }

    throw new Error(buildServerAvailabilityErrorMessage(response.status, payload));
  }

  const result = payload?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('Сервер перевірки доступності повернув некоректну відповідь.');
  }

  const normalizedResult = {
    reachable: result.reachable === true,
    status: Number.isInteger(result.status) ? result.status : null,
    url: typeof result.url === 'string' && result.url.trim() ? result.url.trim() : ''
  };

  if (!normalizedResult.url) {
    throw new Error('Сервер перевірки доступності повернув некоректну відповідь.');
  }

  if (typeof result.error === 'string' && result.error.trim()) {
    normalizedResult.error = result.error.trim();
  }

  return normalizedResult;
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

  if (message?.action === 'OPEN_HELPDESK_DRAFT') {
    const requesterTabId = sender.tab?.id;
    if (requesterTabId === undefined || !message.payload || typeof message.payload !== 'object') {
      sendResponse({ ok: false, error: 'Missing requester tab or payload' });
      return false;
    }

    openHelpDeskDraftTab({
      requesterTabId,
      payload: message.payload,
      active: message.active !== false
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to open HelpDeskEddy draft tab' }));

    return true;
  }

  if (message?.action === 'GET_HELPDESK_DRAFT_PAYLOAD') {
    const targetTabId = sender.tab?.id;
    if (!message.requestId && targetTabId === undefined) {
      sendResponse({ ok: false, error: 'Missing HelpDeskEddy draft request id' });
      return false;
    }

    (async () => {
      let request = null;
      if (message.requestId) {
        request = await getHelpDeskDraftRequest(message.requestId);
      }

      if (!request) {
        request = await getHelpDeskDraftRequestByTabId(targetTabId);
      }

      return request;
    })()
      .then((request) => {
        if (!request?.payload) {
          sendResponse({ ok: false, error: 'Чернетку HelpDeskEddy не знайдено або час її дії сплив.' });
          return;
        }

        sendResponse({
          ok: true,
          requestId: request.requestId,
          payload: request.payload,
          requesterTabId: request.requesterTabId,
          targetTabId: request.targetTabId
        });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to read HelpDeskEddy draft payload' }));

    return true;
  }

  if (message?.action === 'COMPLETE_HELPDESK_DRAFT_REQUEST') {
    if (!message.requestId) {
      sendResponse({ ok: false, error: 'Missing HelpDeskEddy draft request id' });
      return false;
    }

    finalizeHelpDeskDraftRequest({
      requestId: message.requestId,
      ok: message.ok !== false,
      error: message.error,
      sourceTabId: sender.tab?.id
    })
      .then((found) => sendResponse({ ok: true, found }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to finalize HelpDeskEddy draft request' }));

    return true;
  }

  if (message?.action === 'GET_EXTENSION_ACCESS_STATE') {
    getExtensionAccessState()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to read extension access state' }));

    return true;
  }

  if (message?.action === 'SAVE_EXTENSION_USER_ID') {
    saveUserId(message.userId)
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to save user id' }));

    return true;
  }

  if (message?.action === 'REQUEST_EXTENSION_ACCESS') {
    requestExtensionAccess(message.userId)
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to request extension access' }));

    return true;
  }

  if (message?.action === 'CLAIM_EXTENSION_ACCESS') {
    claimExtensionKey({
      requestId: message.requestId,
      claimCode: message.claimCode
    })
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to claim extension access' }));

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
    if (!message.server || message.port === undefined || message.port === null || message.port === '') {
      sendResponse({ ok: false, error: 'Missing server or port' });
      return false;
    }

    fetchServerAvailability({
      address: message.server,
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

  resolveClosedHelpDeskDraftTab(tabId).catch((error) => {
    log.warn('Failed to resolve closed HelpDeskEddy draft tab', {
      tabId,
      error: error?.message
    });
  });
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
