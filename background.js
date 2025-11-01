/**
 * @file Service Worker (background script) для расширения "Interactive PiP".
 * Этот скрипт работает в фоновом режиме, управляет состоянием вкладок,
 * обрабатывает нажатия на иконку расширения, горячие клавиши и сообщения
 * от контент-скриптов. Он является центральным координатором расширения.
 */

// Пространство имён для логов, чтобы легко фильтровать их в консоли разработчика.
const LOG_NAMESPACE = 'Interactive PiP';
// Определяет порядок уровней логирования для фильтрации сообщений.
const LOG_LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * Создаёт и возвращает объект логгера с методами error, warn, info, debug.
 * Позволяет удобно логировать информацию с указанием области (scope) и уровня.
 * @param {string} scope - Название компонента, откуда ведётся лог (например, 'background').
 * @param {string} [level='info'] - Уровень логирования по умолчанию.
 * @returns {{error: Function, warn: Function, info: Function, debug: Function}}
 */
function createLogger(scope, level = 'info') {
  const resolveLevel = typeof level === 'function' ? level : () => level;
  const ensureLevel = (value) => (value in LOG_LEVEL_ORDER ? value : 'info');

  const createWriter = (type) => (...args) => {
    const currentLevel = ensureLevel(resolveLevel());
    // Сообщения с уровнем ниже текущего установленного не выводятся.
    if (LOG_LEVEL_ORDER[type] > LOG_LEVEL_ORDER[currentLevel]) return;
    const timestamp = new Date().toISOString();
    const writer = console[type] ?? console.log;
    // Форматированный вывод в консоль для удобства отладки.
    writer(`[${timestamp}] [${LOG_NAMESPACE}] [${scope}]`, ...args);
  };

  return {
    error: createWriter('error'),
    warn: createWriter('warn'),
    info: createWriter('info'),
    debug: createWriter('debug')
  };
}

// Создание экземпляра логгера для этого файла.
const log = createLogger('background', 'info');

// Хранилище состояний PiP для каждой вкладки. Ключ - tabId, значение - boolean (true, если PiP открыт).
const TAB_STATE = new Map();
// Набор протоколов URL, на которых разрешена активация расширения.
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);

// Событие, срабатывающее при установке или обновлении расширения.
chrome.runtime.onInstalled.addListener(() => {
  log.info('Extension installed or updated');
  // Устанавливаем синий цвет для фона бейджа на иконке.
  chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
  // Изначально бейдж пуст.
  chrome.action.setBadgeText({ text: '' });
});

/**
 * Проверяет, поддерживается ли URL для активации Picture-in-Picture.
 * @param {string|undefined} url - URL для проверки.
 * @returns {boolean} - true, если протокол URL поддерживается.
 */
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

/**
 * Отправляет команду на переключение режима PiP в указанную вкладку.
 * @param {number} tabId - ID вкладки, куда отправить команду.
 * @param {string} [trigger='action'] - Причина вызова (нажатие иконки, горячая клавиша).
 */
async function requestToggle(tabId, trigger = 'action') {
  log.debug('Sending PiP toggle request', { tabId, trigger });

  try {
    // Отправляем сообщение контент-скрипту, который перехватит его и вызовет нужную функцию.
    await chrome.tabs.sendMessage(
      tabId,
      {
        command: 'PIP_TOGGLE_REQUEST', // Команда на переключение режима PiP.
        trigger
      },
      { frameId: 0 } // Отправляем только в основной фрейм страницы.
    );
  } catch (error) {
    // Ошибка может возникнуть, если контент-скрипт не был внедрён или не отвечает.
    const runtimeMessage = chrome.runtime.lastError?.message ?? error?.message;
    log.warn('PiP toggle request failed', { tabId, trigger, error: runtimeMessage });
    // Показываем на иконке краткий индикатор ошибки.
    chrome.action.setBadgeText({ tabId, text: 'ERR' });
    // Убираем индикатор через 2.5 секунды.
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2500);
  }
}

// Обработчик нажатия на иконку расширения в панели инструментов.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id === undefined) {
    log.debug('Toolbar icon click ignored — tab missing');
    return;
  }

  log.info('Toolbar icon clicked', { tabId: tab.id, url: tab.url, trigger: 'action' });

  // Если URL не поддерживается, сообщаем пользователю через бейдж.
  if (!isSupportedUrl(tab.url)) {
    chrome.action.setBadgeText({ tabId: tab.id, text: 'N/A' }); // N/A — Not Available/Applicable
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 2000);
    return;
  }

  // Запрашиваем переключение PiP.
  await requestToggle(tab.id, 'action');
});

// Обработчик команд, определённых в manifest.json (например, горячих клавиш).
chrome.commands.onCommand.addListener(async (command, tab) => {
  // Реагируем только на нашу команду.
  if (command !== 'toggle-pip') return;

  try {
    // Определяем целевую вкладку: либо та, где была нажата комбинация, либо текущая активная.
    const targetTabId = tab?.id ?? (await getActiveTabId());
    if (targetTabId === undefined) {
      log.debug('No target tab for keyboard command', { command });
      return;
    }

    // Получаем полную информацию о вкладке.
    const targetTab = tab ?? await chrome.tabs.get(targetTabId);
    log.info('Keyboard command received', { tabId: targetTabId, url: targetTab?.url, trigger: 'command' });

    // Игнорируем команду на неподдерживаемых страницах.
    if (!isSupportedUrl(targetTab.url)) {
      log.debug('Command ignored — unsupported URL', { tabId: targetTabId, url: targetTab?.url });
      return;
    }

    // Запрашиваем переключение PiP.
    await requestToggle(targetTabId, 'command');
  } catch (error) {
    log.error('Failed to handle toggle command', error);
  }
});

// Обработчик сообщений от контент-скриптов.
chrome.runtime.onMessage.addListener((message, sender) => {
  // Убеждаемся, что сообщение пришло от нашего скрипта со страницы.
  if (!message || message.source !== 'pip-page') return;

  const tabId = sender.tab?.id;
  if (tabId === undefined) return;

  log.debug('Message received from pip-page', { tabId, type: message.type });

  // Обрабатываем сообщения в зависимости от их типа.
  switch (message.type) {
    // Сообщение об изменении состояния PiP (открыто/закрыто).
    case 'PIP_STATE':
      TAB_STATE.set(tabId, message.state === 'open');
      updateBadge(tabId); // Обновляем бейдж на иконке.
      log.info('Updated PiP state', { tabId, state: message.state, trigger: message.trigger });
      break;
    // Сообщение о том, что PiP не поддерживается на странице.
    case 'PIP_UNSUPPORTED':
      TAB_STATE.delete(tabId);
      chrome.action.setBadgeText({ tabId, text: '!' }); // ! — индикатор неподдерживаемости.
      setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2500);
      log.warn('Tab reported PiP as unsupported', { tabId, reason: message.reason, details: message.message });
      break;
    // Скрипт на странице просит восстановить окно PiP (например, при перезагрузке).
    case 'PIP_RESTORE_REQUEST':
      log.info('Tab requested PiP restore', { tabId, trigger: message.trigger });
      requestToggle(tabId, 'page-request');
      break;
    default:
      log.debug('Unknown message type received', { tabId, type: message.type });
      break;
  }
});

// Обработчик закрытия вкладки.
chrome.tabs.onRemoved.addListener((tabId) => {
  // Если для закрытой вкладки было состояние PiP, удаляем его, чтобы избежать утечек памяти.
  if (TAB_STATE.delete(tabId)) {
    log.debug('Cleared PiP state for closed tab', { tabId });
  }
});

// Обработчик переключения на другую вкладку.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  log.debug('Tab activated, refreshing badge', { tabId });
  // Обновляем бейдж, чтобы он соответствовал состоянию новой активной вкладки.
  updateBadge(tabId);
});

/**
 * Асинхронно получает ID текущей активной вкладки в активном окне.
 * @returns {Promise<number|undefined>}
 */
async function getActiveTabId() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id;
}

/**
 * Обновляет текст бейджа на иконке расширения для указанной вкладки.
 * @param {number} tabId - ID вкладки, для которой обновляется бейдж.
 */
function updateBadge(tabId) {
  const isOpen = TAB_STATE.get(tabId) === true;
  // Показываем "ON", если PiP активен, или убираем текст, если неактивен.
  chrome.action.setBadgeText({ tabId, text: isOpen ? 'ON' : '' });
  log.debug('Badge updated', { tabId, status: isOpen ? 'ON' : 'OFF' });
}