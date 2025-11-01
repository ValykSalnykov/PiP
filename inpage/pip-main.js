/**
 * @file Основной in-page скрипт, управляющий Document Picture-in-Picture.
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

  const logger = createLogger('inpage', 'info');

  if (window.__interactiveTabPiP) {
    logger.debug('PiP controller already initialised');
    return;
  }

  const EXTENSION_SOURCE = 'pip-extension';
  const PAGE_SOURCE = 'pip-page';

  let lastKnownSize = null;

  logger.info('In-page PiP controller bootstrapped');

  const state = {
    pipWindow: null,
    placeholder: null,
    pipControls: null,
    styleObserver: null,
    styleMirror: null,
    titleObserver: null,
    pipHideHandler: null,
    pipResizeHandler: null,
    isRestoring: false,
    openPromise: null,
    restorePromise: null,
    scroll: { x: 0, y: 0 },
    lastFocus: null,
    originalBackground: null,
    htmlAttributes: null,
    bodyAttributes: null,
    movedNodes: null
  };

  function post(message) {
    logger.debug('Posting message to extension', { type: message.type, trigger: message.trigger });
    window.postMessage({ source: PAGE_SOURCE, ...message }, '*');
  }

  function isSupported() {
    return 'documentPictureInPicture' in window;
  }

  window.addEventListener('message', handleIncomingMessage, false);

  window.__interactiveTabPiP = {
    toggle: (trigger = 'page-call') => toggle(trigger),
    close: (trigger = 'page-call') => restore(trigger),
    isOpen: () => Boolean(state.pipWindow && !state.pipWindow.closed)
  };

  function handleIncomingMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== EXTENSION_SOURCE) return;

    logger.debug('Received message from extension', { type: data.type, trigger: data.trigger });

    if (data.type === 'TOGGLE') {
      toggle(data.trigger ?? 'extension');
    } else if (data.type === 'CLOSE') {
      restore(data.trigger ?? 'extension');
    }
  }

  async function toggle(trigger) {
    logger.info('Toggle requested', { trigger });

    if (!isSupported()) {
      logger.warn('Document Picture-in-Picture API is not available');
      showUnsupportedNotice();
      post({ type: 'PIP_UNSUPPORTED', reason: 'api-missing' });
      return;
    }

    if (state.openPromise) {
      logger.debug('Toggle skipped — open promise already in progress');
      return state.openPromise;
    }

    if (state.pipWindow && !state.pipWindow.closed) {
      logger.info('PiP already open, scheduling restore', { trigger });
      return restore(trigger);
    }

    state.openPromise = open(trigger).finally(() => {
      state.openPromise = null;
    });
    return state.openPromise;
  }

  async function open(trigger) {
    const options = { preferInitialWindowPlacement: true };
    if (lastKnownSize) {
      options.width = lastKnownSize.width;
      options.height = lastKnownSize.height;
    }

    logger.info('Opening PiP window', { trigger, options });

    let pipWindow;
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow(options);
      logger.debug('PiP window handle acquired', {
        width: pipWindow.innerWidth,
        height: pipWindow.innerHeight
      });
    } catch (error) {
      logger.error('requestWindow failed', error);
      showUnsupportedNotice();
      post({ type: 'PIP_UNSUPPORTED', reason: 'request-failed', message: error?.message });
      throw error;
    }

    const body = document.body || (await waitForBody());
    if (!body) {
      logger.warn('Document body missing — closing PiP window');
      pipWindow.close();
      post({ type: 'PIP_UNSUPPORTED', reason: 'body-missing' });
      return;
    }

    const previousFocus = getActiveFocusableElement(body);
    const previousScroll = { x: window.scrollX, y: window.scrollY };

    state.originalBackground = getPageBackgroundColor();
    state.htmlAttributes = captureElementAttributes(document.documentElement);
    state.bodyAttributes = captureElementAttributes(body);

    const fragment = document.createDocumentFragment();
    const movedNodes = [];
    while (body.firstChild) {
      const node = body.firstChild;
      movedNodes.push(node);
      fragment.appendChild(node);
    }

    const placeholder = createPlaceholder();

    try {
      body.appendChild(placeholder);

      document.documentElement?.setAttribute('data-pipx-active', 'true');
      body.setAttribute('data-pipx-state', 'placeholder');

      preparePipWindow(
        pipWindow,
        fragment,
        state.originalBackground,
        state.htmlAttributes,
        state.bodyAttributes
      );

      const pipHideHandler = () => {
        if (state.isRestoring) return;
        logger.warn('PiP window closed by user — restoring content');
        restore('pip-window-closed');
      };
      pipWindow.addEventListener('pagehide', pipHideHandler);

      const pipResizeHandler = () => {
        lastKnownSize = {
          width: pipWindow.innerWidth,
          height: pipWindow.innerHeight
        };
        logger.debug('PiP window resized', lastKnownSize);
      };
      pipWindow.addEventListener('resize', pipResizeHandler);

      state.placeholder = placeholder;
      state.pipWindow = pipWindow;
      state.scroll = previousScroll;
      state.lastFocus = previousFocus;
      state.pipHideHandler = pipHideHandler;
      state.pipResizeHandler = pipResizeHandler;
      state.movedNodes = movedNodes;

      if (previousFocus && typeof previousFocus.focus === 'function') {
        queueMicrotask(() => {
          try {
            previousFocus.focus({ preventScroll: true });
          } catch (focusError) {
            logger.warn('Failed to refocus previous element, focusing PiP window', focusError);
            pipWindow.focus();
          }
        });
      } else {
        pipWindow.focus();
      }

      post({ type: 'PIP_STATE', state: 'open', trigger });
      logger.info('PiP window initialised', { trigger });
    } catch (error) {
      logger.error('Failed to initialise PiP window', error);

      try {
        if (placeholder?.isConnected) {
          placeholder.remove();
        }
      } catch (placeholderError) {
        logger.warn('Unable to remove placeholder during failure', placeholderError);
      }

      document.documentElement?.removeAttribute('data-pipx-active');
      body.removeAttribute('data-pipx-state');

      cleanupObservers();
      if (state.pipControls) {
        state.pipControls.remove();
        state.pipControls = null;
      }

      try {
        movedNodes.forEach((node) => {
          const ownerDoc = node.ownerDocument;
          if (ownerDoc && ownerDoc !== document) {
            body.appendChild(document.adoptNode(node));
          } else {
            body.appendChild(node);
          }
        });
      } catch (restoreError) {
        logger.warn('Unable to move nodes back into body', restoreError);
      }

      try {
        if (pipWindow && !pipWindow.closed) {
          pipWindow.close();
        }
      } catch (closeError) {
        logger.warn('Unable to close PiP window after failure', closeError);
      }

      state.placeholder = null;
      state.movedNodes = null;
      state.originalBackground = null;
      state.htmlAttributes = null;
      state.bodyAttributes = null;

      throw error;
    }
  }

  function preparePipWindow(
    pipWindow,
    fragment,
    backgroundColor,
    htmlAttributes,
    bodyAttributes
  ) {
    logger.debug('Preparing PiP window document');

    const pipDoc = pipWindow.document;

    applyElementAttributes(pipDoc.documentElement, htmlAttributes);
    applyElementAttributes(pipDoc.body, bodyAttributes);

    pipDoc.title = document.title;
    pipDoc.documentElement.classList.add('pipx-html');
    pipDoc.body.classList.add('pipx-body');
    pipDoc.body.style.margin = '0';
    pipDoc.body.style.padding = '0';

    if (backgroundColor) {
      if (!pipDoc.documentElement.style.backgroundColor) {
        pipDoc.documentElement.style.backgroundColor = backgroundColor;
      }
      if (!pipDoc.body.style.backgroundColor) {
        pipDoc.body.style.backgroundColor = backgroundColor;
      }
    }

    copyStylesheets(pipDoc);
    mirrorTitle(pipDoc);
    injectPipStyles(pipDoc);

    pipDoc.body.appendChild(fragment);

    const controls = createPipControls(pipDoc);
    pipDoc.body.appendChild(controls);
    state.pipControls = controls;
  }

  function restore(trigger) {
    if (state.restorePromise) {
      logger.debug('Restore skipped — restore promise already in progress');
      return state.restorePromise;
    }

    state.restorePromise = (async () => {
      state.isRestoring = true;
      logger.info('Restoring tab content from PiP', { trigger });

      const body = document.body || (await waitForBody());
      const pipWindow = state.pipWindow;

      if (state.placeholder) {
        try {
          state.placeholder.remove();
        } catch (placeholderError) {
          logger.warn('Unable to remove placeholder during restore', placeholderError);
        }
      }
      state.placeholder = null;

      body?.removeAttribute('data-pipx-state');
      document.documentElement?.removeAttribute('data-pipx-active');

      const movedNodes = state.movedNodes || [];
      if (body && movedNodes.length) {
        movedNodes.forEach((node) => {
          try {
            const ownerDoc = node.ownerDocument;
            if (ownerDoc && ownerDoc !== document) {
              body.appendChild(document.adoptNode(node));
            } else {
              body.appendChild(node);
            }
          } catch (error) {
            logger.warn('Failed to move node back into main document', error);
          }
        });
      }
      state.movedNodes = null;

      if (state.pipControls) {
        state.pipControls.remove();
        state.pipControls = null;
      }

      cleanupObservers();

      if (pipWindow) {
        try {
          if (state.pipHideHandler) {
            pipWindow.removeEventListener('pagehide', state.pipHideHandler);
          }
        } catch (error) {
          logger.debug('Failed to detach pagehide listener', error);
        }
        try {
          if (state.pipResizeHandler) {
            pipWindow.removeEventListener('resize', state.pipResizeHandler);
          }
        } catch (error) {
          logger.debug('Failed to detach resize listener', error);
        }
        try {
          if (!pipWindow.closed) {
            pipWindow.close();
          }
        } catch (error) {
          logger.warn('Failed to close PiP window during restore', error);
        }
      }

      state.pipWindow = null;
      state.pipHideHandler = null;
      state.pipResizeHandler = null;
      state.originalBackground = null;
      state.htmlAttributes = null;
      state.bodyAttributes = null;

      const { x, y } = state.scroll || { x: 0, y: 0 };
      window.scrollTo(x, y);

      if (state.lastFocus && body?.contains(state.lastFocus)) {
        setTimeout(() => {
          try {
            state.lastFocus.focus({ preventScroll: true });
          } catch (focusError) {
            logger.debug('Unable to restore focus to previous element', focusError);
          }
        }, 0);
      }
      state.lastFocus = null;

      post({ type: 'PIP_STATE', state: 'closed', trigger });
      logger.info('Tab content restored', { trigger });
    })().finally(() => {
      state.isRestoring = false;
      state.restorePromise = null;
    });

    return state.restorePromise;
  }

  function createPlaceholder() {
    logger.debug('Creating placeholder for original tab content');

    const wrapper = document.createElement('section');
    wrapper.id = 'pipx-placeholder';
    wrapper.setAttribute('role', 'status');

    const card = document.createElement('div');
    card.className = 'pipx-card';

    const title = document.createElement('h1');
    title.className = 'pipx-title';
    title.textContent = 'Страница открыта в плавающем окне';

    const description = document.createElement('p');
    description.className = 'pipx-text';
    const hotkey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥⇧P' : 'Alt+Shift+P';
    description.textContent = `Окно «картинка в картинке» остаётся поверх всех приложений.`;

    const note = document.createElement('p');
    note.className = 'pipx-note';
    note.textContent = 'Закрытие исходной вкладки автоматически закроет плавающее окно.';

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(note);
    wrapper.appendChild(card);

    return wrapper;
  }

  function createPipControls(pipDoc) {
    logger.debug('Creating PiP overlay controls');

    const controls = pipDoc.createElement('div');
    controls.id = 'pipx-controls';

    // Кнопки "Вернуть во вкладку" и "Обновить" удалены

    return controls;
  }

  function injectPipStyles(pipDoc) {
    const style = pipDoc.createElement('style');
    style.id = 'pipx-style';
    style.textContent = `
:root {
  color-scheme: ${document.documentElement?.style?.colorScheme || 'auto'};
}

html.pipx-html,
body.pipx-body {
  width: 100%;
  height: 100%;
  overflow: auto;
  margin: 0;
  padding: 0;
}

#pipx-controls {
  position: fixed;
  inset-block-start: 12px;
  inset-inline-end: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 2147483647;
  pointer-events: none;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

#pipx-controls .pipx-btn {
  pointer-events: auto;
  background: rgba(15, 23, 42, 0.86);
  color: #f8fafc;
  border: none;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.3);
  transition: transform 0.15s ease, background 0.2s ease;
}

#pipx-controls .pipx-btn:hover {
  transform: translateY(-1px);
  background: rgba(37, 99, 235, 0.95);
}

#pipx-controls .pipx-hint {
  pointer-events: none;
  color: rgba(241, 245, 249, 0.85);
  font-size: 11px;
  text-shadow: 0 2px 6px rgba(15, 23, 42, 0.75);
  max-width: 200px;
}

@media (prefers-color-scheme: light) {
  #pipx-controls .pipx-btn {
    background: rgba(29, 78, 216, 0.92);
  }
}
`;
    pipDoc.head.appendChild(style);
  }

  function copyStylesheets(pipDoc) {
    logger.debug('Mirroring stylesheets into PiP window');

    const mirrorMap = new Map();
    const head = document.head;
    if (!head) {
      state.styleMirror = mirrorMap;
      return;
    }

    const shouldMirror = (node) =>
      node &&
      node.nodeType === Node.ELEMENT_NODE &&
      isStylesheetNode(node) &&
      !(node instanceof Element && node.dataset?.pipxNoMirror === 'true');

    const nodes = head.querySelectorAll('link[rel~="stylesheet"], style');
    nodes.forEach((node) => {
      if (!shouldMirror(node)) return;
      const clone = node.cloneNode(true);
      pipDoc.head.appendChild(clone);
      mirrorMap.set(node, clone);
    });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (shouldMirror(node) && !mirrorMap.has(node)) {
              const clone = node.cloneNode(true);
              pipDoc.head.appendChild(clone);
              mirrorMap.set(node, clone);
            }
          });

          mutation.removedNodes.forEach((node) => {
            const clone = mirrorMap.get(node);
            if (clone) {
              clone.remove();
              mirrorMap.delete(node);
            }
          });
        } else if (mutation.type === 'attributes') {
          if (
            mutation.target instanceof Element &&
            mutation.target.dataset?.pipxNoMirror === 'true'
          ) {
            continue;
          }
          const clone = mirrorMap.get(mutation.target);
          if (clone && mutation.attributeName) {
            const value = mutation.target.getAttribute(mutation.attributeName);
            if (value === null) {
              clone.removeAttribute(mutation.attributeName);
            } else {
              clone.setAttribute(mutation.attributeName, value);
            }
          }
        } else if (mutation.type === 'characterData') {
          const owner = mutation.target.parentNode;
          const clone = mirrorMap.get(owner);
          if (clone) {
            clone.textContent = owner.textContent;
          }
        }
      }
    });

    observer.observe(head, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['media', 'disabled', 'href', 'crossorigin']
    });

    state.styleObserver = observer;
    state.styleMirror = mirrorMap;
  }

  function mirrorTitle(pipDoc) {
    logger.debug('Mirroring document title into PiP window');

    const titleElement = document.querySelector('title');
    pipDoc.title = document.title;
    if (!titleElement) return;

    const observer = new MutationObserver(() => {
      pipDoc.title = document.title;
    });
    observer.observe(titleElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    state.titleObserver = observer;
  }

  function cleanupObservers() {
    if (state.styleObserver) {
      state.styleObserver.disconnect();
      state.styleObserver = null;
    }
    if (state.titleObserver) {
      state.titleObserver.disconnect();
      state.titleObserver = null;
    }
    if (state.styleMirror) {
      state.styleMirror.clear();
      state.styleMirror = null;
    }
    logger.debug('Cleaned up observers and mirrors');
  }

  function isStylesheetNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.tagName === 'STYLE') return true;
    if (node.tagName === 'LINK') {
      const rel = node.getAttribute('rel') || '';
      return /\bstylesheet\b/i.test(rel);
    }
    return false;
  }

  function captureElementAttributes(element) {
    if (!element) return null;
    return Array.from(element.attributes, ({ name, value }) => ({ name, value }));
  }

  function applyElementAttributes(target, attributes) {
    if (!target || !attributes) return;
    for (const { name, value } of attributes) {
      if (name === 'data-pipx-active' || name === 'data-pipx-state') continue;
      if (name === 'class') {
        target.className = value;
      } else if (name === 'style') {
        target.setAttribute('style', value);
      } else {
        target.setAttribute(name, value);
      }
    }
  }

  function getPageBackgroundColor() {
    const html = document.documentElement;
    const body = document.body;

    const getColor = (element) => {
      if (!element) return null;
      const color = window.getComputedStyle(element).backgroundColor;
      if (!color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
        return null;
      }
      return color;
    };

    return getColor(body) || getColor(html) || null;
  }

  function getActiveFocusableElement(root) {
    const active = document.activeElement;
    if (!active || active === document.body || active === root) return null;
    if (typeof active.focus === 'function') return active;
    return null;
  }

  function waitForBody() {
    if (document.body) return Promise.resolve(document.body);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (document.body) {
          observer.disconnect();
          resolve(document.body);
        }
      });
      observer.observe(document.documentElement || document, { childList: true, subtree: true });
    });
  }

  function showUnsupportedNotice() {
    if (document.getElementById('pipx-unsupported-banner')) return;
    logger.warn('Showing unsupported API notice banner');

    const banner = document.createElement('div');
    banner.id = 'pipx-unsupported-banner';
    banner.textContent =
      'Document Picture-in-Picture API недоступно. Обновите Chrome до версии 116+ или используйте десктопную версию Chrome/Edge.';

    banner.style.position = 'fixed';
    banner.style.insetInlineEnd = '20px';
    banner.style.insetBlockEnd = '20px';
    banner.style.padding = '14px 18px';
    banner.style.borderRadius = '14px';
    banner.style.fontFamily = 'Inter, "Segoe UI", sans-serif';
    banner.style.fontSize = '0.95rem';
    banner.style.color = '#f8fafc';
    banner.style.background = 'rgba(220, 38, 38, 0.92)';
    banner.style.zIndex = '2147483600';
    banner.style.boxShadow = '0 18px 40px rgba(153, 27, 27, 0.35)';
    banner.style.maxWidth = 'min(360px, 90vw)';

    const target = document.body || document.documentElement;
    target.appendChild(banner);

    setTimeout(() => {
      banner.remove();
      logger.debug('Unsupported API banner removed automatically');
    }, 6000);
  }
})();