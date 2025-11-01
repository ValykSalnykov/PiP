/**
 * @file Content Script (bridge).
 * Этот скрипт внедряется непосредственно на страницу и служит "мостом"
 * между изолированным окружением фонового скрипта (background.js)
 * и контекстом веб-страницы, где работает основной скрипт (pip-main.js).
 *
 * Его основные задачи:
 * 1. Внедрить основной скрипт (`pip-main.js`) и стили (`pip-placeholder.css`) на страницу.
 * 2. Пересылать сообщения от `background.js` в `pip-main.js` с помощью `window.postMessage`.
 * 3. Прослушивать сообщения от `pip-main.js` и пересылать их в `background.js`
 *    с помощью `chrome.runtime.sendMessage`.
 */
(() => {
  // Пространство имён для логов.
  const LOG_NAMESPACE = 'Interactive PiP';
  const LOG_LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 };

  /**
   * Создаёт и возвращает объект логгера.
   * @param {string} scope - Область логирования (например, 'bridge').
   * @param {string} [level='info'] - Уровень логирования.
   * @returns {{error: Function, warn: Function, info: Function, debug: Function}}
   */
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

  const logger = createLogger('bridge', 'info');

  // Не внедряем скрипт в iframe, чтобы избежать дублирования и ошибок.
  if (window.top !== window) {
    logger.debug('Skipping injection inside iframe');
    return;
  }

  const root = document.documentElement || document;
  // Проверяем, был ли мост уже внедрён, чтобы избежать повторного выполнения.
  if (root.hasAttribute('data-pipx-extension-injected')) {
    logger.debug('Bridge already injected, aborting');
    return;
  }
  root.setAttribute('data-pipx-extension-injected', 'true');

  // Каналы сообщений.
  const EXTENSION_SOURCE = 'pip-extension'; // Сообщения, инициированные расширением.
  const PAGE_SOURCE = 'pip-page'; // Сообщения, инициированные скриптом на странице.

  // Получаем URL ресурсов из пакета расширения.
  const scriptUrl = chrome.runtime.getURL('inpage/pip-main.js');
  const styleUrl = chrome.runtime.getURL('inpage/pip-placeholder.css');

  logger.info('Injecting PiP controller assets', { scriptUrl, styleUrl });

  // Внедряем CSS и JS на страницу.
  injectStyle(styleUrl);
  injectMainScript(scriptUrl);

  // [Канал: Background -> Bridge -> Page]
  // Слушаем сообщения от фонового скрипта.
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.command !== 'string') {
      logger.debug('Ignoring message without command');
      return;
    }

    logger.debug('Forwarding extension command to page', { command: message.command, trigger: message.trigger });

    // Пересылаем команду на переключение PiP основному скрипту.
    if (message.command === 'PIP_TOGGLE_REQUEST') {
      window.postMessage(
        {
          source: EXTENSION_SOURCE,
          type: 'TOGGLE', // Тип сообщения для `pip-main.js`.
          trigger: message.trigger ?? 'unknown'
        },
        '*' // Отправляем в тот же origin.
      );
    // Пересылаем команду на закрытие PiP.
    } else if (message.command === 'PIP_CLOSE_REQUEST') {
      window.postMessage(
        {
          source: EXTENSION_SOURCE,
          type: 'CLOSE', // Тип сообщения для `pip-main.js`.
          trigger: message.trigger ?? 'unknown'
        },
        '*'
      );
    } else {
      logger.debug('Unknown command received in bridge', { command: message.command });
    }
  });

  // [Канал: Page -> Bridge -> Background]
  // Слушаем сообщения от основного скрипта (pip-main.js).
  window.addEventListener('message', (event) => {
    // Убеждаемся, что сообщение пришло из того же окна.
    if (event.source !== window) return;
    const data = event.data;
    // Проверяем, что это сообщение от нашего скрипта.
    if (!data || data.source !== PAGE_SOURCE) return;

    logger.debug('Relaying page message to background', { type: data.type, trigger: data.trigger });

    // Пересылаем сообщение фоновому скрипту.
    chrome.runtime.sendMessage(data);
  });

  /**
   * Внедряет основной скрипт на страницу.
   * @param {string} src - URL скрипта.
   */
  function injectMainScript(src) {
    if (!src) {
      logger.warn('Skipping script injection — empty src');
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.type = 'module';
    script.dataset.pipx = 'true'; // Маркер для идентификации.
    // Внедряем в <html> (или <head>), а затем сразу удаляем, чтобы не загрязнять DOM.
    // Скрипт всё равно будет загружен и выполнен браузером.
    (document.documentElement || document.head || document).appendChild(script);
    script.remove();
    logger.debug('Main script injected', { src });
  }

  /**
   * Внедряет файл стилей на страницу.
   * @param {string} href - URL файла стилей.
   */
  function injectStyle(href) {
    // Предотвращаем повторное внедрение того же файла стилей.
    if (document.querySelector(`link[data-pipx-css="true"][href="${href}"]`)) {
        logger.debug('Style already injected', { href });
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.pipxCss = 'true'; // Маркер для идентификации.
    link.dataset.pipxNoMirror = 'true';
    (document.head || document.documentElement || document).appendChild(link);
    logger.debug('Style injected', { href });
  }
})();