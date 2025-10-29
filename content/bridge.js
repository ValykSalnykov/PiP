/**
 * @file Content Script (bridge).
 * Добавлена пересылка команды выбора элемента.
 */
(() => {
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

  const logger = createLogger('bridge', 'info');

  if (window.top !== window) {
    logger.debug('Skipping injection inside iframe');
    return;
  }

  const root = document.documentElement || document;
  if (root.hasAttribute('data-pipx-extension-injected')) {
    logger.debug('Bridge already injected, aborting');
    return;
  }
  root.setAttribute('data-pipx-extension-injected', 'true');

  const EXTENSION_SOURCE = 'pip-extension';
  const PAGE_SOURCE = 'pip-page';

  const scriptUrl = chrome.runtime.getURL('inpage/pip-main.js');
  const styleUrl = chrome.runtime.getURL('inpage/pip-placeholder.css');

  logger.info('Injecting PiP controller assets', { scriptUrl, styleUrl });

  injectStyle(styleUrl);
  injectMainScript(scriptUrl);

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.command !== 'string') {
      logger.debug('Ignoring message without command');
      return;
    }

    logger.debug('Forwarding extension command to page', {
      command: message.command,
      trigger: message.trigger
    });

    if (message.command === 'PIP_TOGGLE_REQUEST') {
      window.postMessage(
        {
          source: EXTENSION_SOURCE,
          type: 'TOGGLE',
          trigger: message.trigger ?? 'unknown'
        },
        '*'
      );
    } else if (message.command === 'PIP_CLOSE_REQUEST') {
      window.postMessage(
        {
          source: EXTENSION_SOURCE,
          type: 'CLOSE',
          trigger: message.trigger ?? 'unknown'
        },
        '*'
      );
    } else if (message.command === 'PIP_SELECT_REQUEST') {
      window.postMessage(
        {
          source: EXTENSION_SOURCE,
          type: 'SELECT_ELEMENT',
          trigger: message.trigger ?? 'unknown'
        },
        '*'
      );
    } else {
      logger.debug('Unknown command received in bridge', { command: message.command });
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE) return;

    logger.debug('Relaying page message to background', {
      type: data.type,
      trigger: data.trigger
    });

    chrome.runtime.sendMessage(data);
  });

  function injectMainScript(src) {
    if (!src) {
      logger.warn('Skipping script injection — empty src');
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.type = 'module';
    script.dataset.pipx = 'true';
    (document.documentElement || document.head || document).appendChild(script);
    script.remove();
    logger.debug('Main script injected', { src });
  }

  function injectStyle(href) {
    if (document.querySelector(`link[data-pipx-css="true"][href="${href}"]`)) {
      logger.debug('Style already injected', { href });
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.pipxCss = 'true';
    link.dataset.pipxNoMirror = 'true';
    (document.head || document.documentElement || document).appendChild(link);
    logger.debug('Style injected', { href });
  }
})();