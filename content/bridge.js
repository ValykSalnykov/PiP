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
  const TASK_HIGHLIGHT_STORAGE_KEYS = {
    enabled: 'pipTimeTrackerTaskHighlightEnabled',
    color: 'pipTimeTrackerTaskHighlightColor',
    overdueBlinkEnabled: 'pipTimeTrackerTaskOverdueBlinkEnabled'
  };
  const DEFAULT_TASK_HIGHLIGHT_SETTINGS = Object.freeze({
    enabled: false,
    color: '#2fd212',
    overdueBlinkEnabled: false
  });

  const scriptUrl = chrome.runtime.getURL('inpage/pip-main.js');
  const styleUrl = chrome.runtime.getURL('inpage/pip-placeholder.css');

  applyTaskHighlightSettingsToDom(root, DEFAULT_TASK_HIGHLIGHT_SETTINGS);
  logger.info('Injecting PiP controller assets', { scriptUrl, styleUrl });

  injectStyle(styleUrl);
  injectMainScript(scriptUrl);
  syncTaskHighlightSettingsToDom(root);

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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (
      !(TASK_HIGHLIGHT_STORAGE_KEYS.enabled in changes) &&
      !(TASK_HIGHLIGHT_STORAGE_KEYS.color in changes) &&
      !(TASK_HIGHLIGHT_STORAGE_KEYS.overdueBlinkEnabled in changes)
    ) {
      return;
    }

    syncTaskHighlightSettingsToDom(root);
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

  function normalizeHexColor(value, fallback = DEFAULT_TASK_HIGHLIGHT_SETTINGS.color) {
    const normalizedValue = String(value || '').trim();
    const shortHexMatch = normalizedValue.match(/^#([\da-fA-F]{3})$/);
    if (shortHexMatch) {
      return `#${shortHexMatch[1].split('').map((char) => `${char}${char}`).join('')}`.toLowerCase();
    }

    if (/^#([\da-fA-F]{6})$/.test(normalizedValue)) {
      return normalizedValue.toLowerCase();
    }

    return fallback;
  }

  function applyTaskHighlightSettingsToDom(target, settings) {
    if (!(target instanceof Element)) {
      return;
    }

    const nextSettings = {
      enabled: settings?.enabled === true,
      color: normalizeHexColor(settings?.color),
      overdueBlinkEnabled: settings?.overdueBlinkEnabled === true
    };

    target.dataset.pipxTaskHighlightEnabled = nextSettings.enabled ? 'true' : 'false';
    target.dataset.pipxTaskHighlightColor = nextSettings.color;
    target.dataset.pipxTaskOverdueBlinkEnabled = nextSettings.overdueBlinkEnabled ? 'true' : 'false';
    logger.debug('Applied task highlight settings to DOM dataset', nextSettings);
  }

  function syncTaskHighlightSettingsToDom(target) {
    chrome.storage.local.get(
      [
        TASK_HIGHLIGHT_STORAGE_KEYS.enabled,
        TASK_HIGHLIGHT_STORAGE_KEYS.color,
        TASK_HIGHLIGHT_STORAGE_KEYS.overdueBlinkEnabled
      ],
      (result) => {
        applyTaskHighlightSettingsToDom(target, {
          enabled: result?.[TASK_HIGHLIGHT_STORAGE_KEYS.enabled] === true,
          color: result?.[TASK_HIGHLIGHT_STORAGE_KEYS.color],
          overdueBlinkEnabled: result?.[TASK_HIGHLIGHT_STORAGE_KEYS.overdueBlinkEnabled] === true
        });
      }
    );
  }
})();