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

  const PIP_MODE_DOCUMENT = 'document';
  const PIP_MODE_ELEMENT = 'element-only';
  const DEFAULT_PIP_OPTIONS = Object.freeze({ mode: PIP_MODE_DOCUMENT });
  const DEFAULT_TARGET_WAIT_MS = 1500;
  const FORCED_DOCUMENT_TRIGGERS = new Set(['action', 'command', 'extension', 'page-request']);

  if (window.__interactiveTabPiP) {
    logger.debug('PiP controller already initialised');
    return;
  }

  const EXTENSION_SOURCE = 'pip-extension';
  const PAGE_SOURCE = 'pip-page';

  let lastKnownSize = null;

  logger.info('In-page PiP controller bootstrapped');

  const state = {
    mode: PIP_MODE_DOCUMENT,
    lastOptions: DEFAULT_PIP_OPTIONS,
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
    movedNodes: null,
    elementState: null
  };

  function post(message) {
    logger.debug('Posting message to extension', { type: message.type, trigger: message.trigger });
    window.postMessage({ source: PAGE_SOURCE, ...message }, '*');
  }

  function isSupported() {
    return 'documentPictureInPicture' in window;
  }

  function clamp(value, min, max) {
    if (Number.isNaN(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && value.constructor === Object;
  }

  function isElement(value) {
    return typeof Element !== 'undefined' && value instanceof Element;
  }

  function normaliseToggleArgs(arg1, arg2) {
    let options = null;
    let trigger = 'page-call';

    if (isPlainObject(arg1) || isElement(arg1)) {
      options = isElement(arg1) ? { targetElement: arg1, mode: PIP_MODE_ELEMENT } : arg1;
      if (typeof arg2 === 'string') {
        trigger = arg2;
      } else if (typeof arg1?.trigger === 'string') {
        trigger = arg1.trigger;
      }
    } else if (typeof arg1 === 'string') {
      trigger = arg1;
    } else if (typeof arg2 === 'string') {
      trigger = arg2;
    }

    return { options, trigger };
  }

  function normaliseOpenOptions(options) {
    if (!options) return null;

    if (isElement(options)) {
      return {
        mode: PIP_MODE_ELEMENT,
        targetElement: options
      };
    }

    if (!isPlainObject(options)) return null;

    const mode = options.mode === PIP_MODE_ELEMENT ? PIP_MODE_ELEMENT : PIP_MODE_DOCUMENT;
    const result = { mode };

    if (mode === PIP_MODE_ELEMENT) {
      if (isElement(options.targetElement)) {
        result.targetElement = options.targetElement;
      }
      if (typeof options.targetSelector === 'string') {
        const selector = options.targetSelector.trim();
        if (selector.length > 0) {
          result.targetSelector = selector;
        }
      }
      if (Number.isFinite(options.waitForTargetMs)) {
        result.waitForTargetMs = Math.max(0, Number(options.waitForTargetMs));
      }
      if (typeof options.placeholderMessage === 'string' && options.placeholderMessage.trim()) {
        result.placeholderMessage = options.placeholderMessage.trim();
      }
    }

    return result;
  }

  function shouldForceDocumentMode(trigger) {
    return FORCED_DOCUMENT_TRIGGERS.has(trigger);
  }

  function cloneOptions(options) {
    if (!options) return null;
    const clone = { ...options };
    if (options.targetElement) {
      clone.targetElement = options.targetElement;
    }
    return clone;
  }

  function resolveToggleOptions(passedOptions, trigger) {
    const normalised = normaliseOpenOptions(passedOptions);
    if (normalised) {
      return normalised;
    }

    if (shouldForceDocumentMode(trigger)) {
      return { ...DEFAULT_PIP_OPTIONS };
    }

    if (state.lastOptions) {
      return cloneOptions(state.lastOptions) ?? { ...DEFAULT_PIP_OPTIONS };
    }

    return { ...DEFAULT_PIP_OPTIONS };
  }

  async function resolveTargetElement(options) {
    if (!options || options.mode !== PIP_MODE_ELEMENT) return null;

    if (isElement(options.targetElement)) {
      return options.targetElement;
    }

    if (!options.targetSelector) {
      return null;
    }

    const immediate = document.querySelector(options.targetSelector);
    if (immediate) {
      return immediate;
    }

    const waitMs = Number.isFinite(options.waitForTargetMs)
      ? Math.max(0, options.waitForTargetMs)
      : DEFAULT_TARGET_WAIT_MS;

    if (waitMs <= 0) return null;

    return waitForElement(options.targetSelector, waitMs);
  }

  function waitForElement(selector, timeoutMs) {
    return new Promise((resolve) => {
      const found = document.querySelector(selector);
      if (found) {
        resolve(found);
        return;
      }

      const root = document.documentElement || document;
      const observer = new MutationObserver(() => {
        const candidate = document.querySelector(selector);
        if (candidate) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(candidate);
        }
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);

      observer.observe(root, { childList: true, subtree: true });
    });
  }

  function captureElementRect(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null;
    const rect = element.getBoundingClientRect();
    if (!rect) return null;
    return {
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    };
  }

  async function autoResizePipWindowToElement(pipWindow, container, preferredRect) {
    if (!pipWindow || typeof pipWindow.resizeTo !== 'function') return null;

    const measure = () => {
      if (!container || typeof container.getBoundingClientRect !== 'function') return null;
      const rect = container.getBoundingClientRect();
      if (!rect) return null;
      return {
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height))
      };
    };

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let rect = preferredRect && preferredRect.width > 0 && preferredRect.height > 0 ? { ...preferredRect } : null;
    if (!rect) {
      rect = measure();
    }
    if (!rect || rect.width < 10 || rect.height < 10) {
      await delay(32);
      rect = measure();
    }
    if (!rect || rect.width < 10 || rect.height < 10) {
      logger.debug('Skipping auto resize — element rect is too small');
      return null;
    }

    const padding = 32; // provide breathing room around element
    const desiredWidth = rect.width + padding;
    const desiredHeight = rect.height + padding;

    const screenWidth = window.screen?.availWidth ?? window.innerWidth ?? 1280;
    const screenHeight = window.screen?.availHeight ?? window.innerHeight ?? 720;

    const minWidth = 320;
    const minHeight = 200;
    const maxWidth = Math.max(minWidth, screenWidth - 20);
    const maxHeight = Math.max(minHeight, screenHeight - 20);

    const targetWidth = clamp(desiredWidth, minWidth, maxWidth);
    const targetHeight = clamp(desiredHeight, minHeight, maxHeight);

    try {
      pipWindow.resizeTo(targetWidth, targetHeight);
      lastKnownSize = { width: targetWidth, height: targetHeight };
      logger.debug('Auto-resized PiP window to element', { targetWidth, targetHeight });
      return lastKnownSize;
    } catch (error) {
      logger.warn('Failed to resize PiP window to match element', error);
      return null;
    }
  }

  window.addEventListener('message', handleIncomingMessage, false);

  window.__interactiveTabPiP = {
    toggle: (arg1, arg2) => toggle(arg1, arg2),
    close: (trigger = 'page-call') => restore(trigger),
    isOpen: () => Boolean(state.pipWindow && !state.pipWindow.closed)
  };

  function handleIncomingMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== EXTENSION_SOURCE) return;

    logger.debug('Received message from extension', { type: data.type, trigger: data.trigger });

    if (data.type === 'TOGGLE') {
      toggle(undefined, data.trigger ?? 'extension');
    } else if (data.type === 'CLOSE') {
      restore(data.trigger ?? 'extension');
    }
  }

  async function toggle(arg1, arg2) {
    const { options: requestedOptions, trigger } = normaliseToggleArgs(arg1, arg2);
    const resolvedOptions = resolveToggleOptions(requestedOptions, trigger);

    logger.info('Toggle requested', {
      trigger,
      mode: resolvedOptions.mode,
      hasTargetSelector: Boolean(resolvedOptions.targetSelector),
      hasTargetElement: Boolean(resolvedOptions.targetElement)
    });

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

    const previousOptions = cloneOptions(state.lastOptions) ?? { ...DEFAULT_PIP_OPTIONS };
    state.lastOptions = { ...resolvedOptions };
    state.mode = resolvedOptions.mode;

    state.openPromise = open(trigger, resolvedOptions)
      .catch((error) => {
        state.lastOptions = previousOptions;
        state.mode = previousOptions?.mode ?? PIP_MODE_DOCUMENT;
        throw error;
      })
      .finally(() => {
        state.openPromise = null;
      });
    return state.openPromise;
  }

  async function open(trigger, options) {
    const pipWindowOptions = { preferInitialWindowPlacement: true };
    if (lastKnownSize) {
      pipWindowOptions.width = lastKnownSize.width;
      pipWindowOptions.height = lastKnownSize.height;
    }

    logger.info('Opening PiP window', { trigger, requestOptions: pipWindowOptions });

    let pipWindow;
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow(pipWindowOptions);
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

    const htmlAttributes = captureElementAttributes(document.documentElement);
    const bodyAttributes = captureElementAttributes(body);
    const backgroundColor = getPageBackgroundColor();

    let pipHideHandler = null;
    let pipResizeHandler = null;

    try {
      if (options.mode === PIP_MODE_ELEMENT) {
        const elementContext = await setupElementMode({
          pipWindow,
          body,
          backgroundColor,
          htmlAttributes,
          bodyAttributes,
          options
        });

        state.placeholder = null;
        state.movedNodes = null;
        state.originalBackground = backgroundColor;
        state.htmlAttributes = htmlAttributes;
        state.bodyAttributes = bodyAttributes;
        state.pipControls = elementContext.controls;
        state.elementState = {
          target: elementContext.target,
          parent: elementContext.parent,
          nextSibling: elementContext.nextSibling,
          placeholder: elementContext.placeholder,
          container: elementContext.container,
          selector: options.targetSelector ?? null,
          rect: elementContext.rect ?? null
        };
        state.lastOptions = {
          ...state.lastOptions,
          targetElement: elementContext.target
        };
      } else {
        const documentContext = setupDocumentMode({
          pipWindow,
          body,
          backgroundColor,
          htmlAttributes,
          bodyAttributes
        });

        state.placeholder = documentContext.placeholder;
        state.movedNodes = documentContext.movedNodes;
        state.originalBackground = backgroundColor;
        state.htmlAttributes = htmlAttributes;
        state.bodyAttributes = bodyAttributes;
        state.pipControls = documentContext.controls;
        state.elementState = null;
      }

      pipHideHandler = () => {
        if (state.isRestoring) return;
        logger.warn('PiP window closed by user — restoring content');
        restore('pip-window-closed');
      };
      pipWindow.addEventListener('pagehide', pipHideHandler);

      pipResizeHandler = () => {
        lastKnownSize = {
          width: pipWindow.innerWidth,
          height: pipWindow.innerHeight
        };
        logger.debug('PiP window resized', lastKnownSize);
      };
      pipWindow.addEventListener('resize', pipResizeHandler);

      state.pipWindow = pipWindow;
      state.scroll = previousScroll;
      state.lastFocus = previousFocus;
      state.pipHideHandler = pipHideHandler;
      state.pipResizeHandler = pipResizeHandler;

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

      post({ type: 'PIP_STATE', state: 'open', trigger, mode: options.mode });
      logger.info('PiP window initialised', { trigger, mode: options.mode });
    } catch (error) {
      logger.error('Failed to initialise PiP window', error);

      if (pipHideHandler) {
        pipWindow.removeEventListener('pagehide', pipHideHandler);
      }
      if (pipResizeHandler) {
        pipWindow.removeEventListener('resize', pipResizeHandler);
      }

      if (options.mode === PIP_MODE_ELEMENT) {
        rollbackElementMode(body);
      } else {
        rollbackDocumentMode(body);
      }

      cleanupObservers();
      if (state.pipControls) {
        state.pipControls.remove();
        state.pipControls = null;
      }

      try {
        if (pipWindow && !pipWindow.closed) {
          pipWindow.close();
        }
      } catch (closeError) {
        logger.warn('Unable to close PiP window after failure', closeError);
      }

      state.pipWindow = null;
      state.pipHideHandler = null;
      state.pipResizeHandler = null;
      state.placeholder = null;
      state.movedNodes = null;
      state.elementState = null;
      state.originalBackground = null;
      state.htmlAttributes = null;
      state.bodyAttributes = null;

      throw error;
    }
  }

  function configurePipDocument(pipWindow, { backgroundColor, htmlAttributes, bodyAttributes }) {
    logger.debug('Configuring PiP window document surface');

    const pipDoc = pipWindow.document;

    applyElementAttributes(pipDoc.documentElement, htmlAttributes);
    applyElementAttributes(pipDoc.body, bodyAttributes);

    pipDoc.title = document.title;
    pipDoc.documentElement.classList.add('pipx-html');
    pipDoc.body.classList.add('pipx-body');
    pipDoc.body.style.margin = '0';
    pipDoc.body.style.padding = '0';
    pipDoc.body.style.minHeight = '100%';

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

    return pipDoc;
  }

  function setupDocumentMode({ pipWindow, body, backgroundColor, htmlAttributes, bodyAttributes }) {
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

      const pipDoc = configurePipDocument(pipWindow, {
        backgroundColor,
        htmlAttributes,
        bodyAttributes
      });

      pipDoc.body.appendChild(fragment);

      const controls = createPipControls(pipDoc);
      pipDoc.body.appendChild(controls);

      return { placeholder, movedNodes, controls };
    } catch (error) {
      restoreNodesToBody(body, movedNodes);
      if (placeholder?.isConnected) {
        placeholder.remove();
      }
      document.documentElement?.removeAttribute('data-pipx-active');
      body.removeAttribute('data-pipx-state');
      throw error;
    }
  }

  async function setupElementMode({
    pipWindow,
    body,
    backgroundColor,
    htmlAttributes,
    bodyAttributes,
    options
  }) {
    const target = await resolveTargetElement(options);
    if (!target) {
      throw new Error(
        options.targetSelector
          ? `PiP target element not found for selector "${options.targetSelector}"`
          : 'PiP target element is not available'
      );
    }

    const originalRect = captureElementRect(target);
    const parent = target.parentNode;
    if (!parent) {
      throw new Error('PiP target element does not have a parent node');
    }

    const placeholder = createElementPlaceholder(target, options.placeholderMessage, originalRect);
    const nextSibling = target.nextSibling;

    let container = null;
    let controls = null;

    try {
      parent.insertBefore(placeholder, target);

      document.documentElement?.setAttribute('data-pipx-active', 'true');
      body.setAttribute('data-pipx-state', 'element-placeholder');

      const pipDoc = configurePipDocument(pipWindow, {
        backgroundColor,
        htmlAttributes,
        bodyAttributes
      });

      container = pipDoc.createElement('div');
      container.id = 'pipx-element-root';
      container.dataset.pipxMode = 'element';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.alignItems = 'stretch';
      container.style.justifyContent = 'flex-start';
      container.style.minHeight = '100%';
      container.style.width = '100%';
      pipDoc.body.appendChild(container);

      container.appendChild(target);

      controls = createPipControls(pipDoc);
      pipDoc.body.appendChild(controls);

  await autoResizePipWindowToElement(pipWindow, container, originalRect);

  return { placeholder, parent, nextSibling, target, container, controls, rect: originalRect };
    } catch (error) {
      if (container?.isConnected) {
        container.remove();
      }
      if (controls?.isConnected) {
        controls.remove();
      }
      if (placeholder?.isConnected) {
        placeholder.remove();
      }
      document.documentElement?.removeAttribute('data-pipx-active');
      body.removeAttribute('data-pipx-state');

      if (parent && target) {
        try {
          const adopted = target.ownerDocument === document ? target : document.adoptNode(target);
          parent.insertBefore(adopted, nextSibling ?? null);
        } catch (restoreError) {
          logger.warn('Unable to restore target element after failure', restoreError);
        }
      }

      throw error;
    }
  }

  function restoreNodesToBody(body, nodes) {
    if (!Array.isArray(nodes) || !body) return;
    nodes.forEach((node) => {
      try {
        const ownerDoc = node.ownerDocument;
        const restored = ownerDoc && ownerDoc !== document ? document.adoptNode(node) : node;
        body.appendChild(restored);
      } catch (error) {
        logger.warn('Failed to restore node back to document body', error);
      }
    });
  }

  function restoreDocumentMode(body) {
    if (state.placeholder?.isConnected) {
      try {
        state.placeholder.remove();
      } catch (error) {
        logger.warn('Unable to remove placeholder during document restore', error);
      }
    }
    state.placeholder = null;

    restoreNodesToBody(body, state.movedNodes);
    state.movedNodes = null;

    document.documentElement?.removeAttribute('data-pipx-active');
    body?.removeAttribute('data-pipx-state');
    state.elementState = null;
  }

  function restoreElementMode(body) {
    const info = state.elementState;
    if (!info) {
      document.documentElement?.removeAttribute('data-pipx-active');
      body?.removeAttribute('data-pipx-state');
      return;
    }

    const { target, parent, nextSibling, placeholder, container } = info;

    let restored = target;
    if (target && target.ownerDocument !== document) {
      try {
        restored = document.adoptNode(target);
      } catch (error) {
        logger.warn('Failed to adopt target element back into main document', error);
        restored = target;
      }
    }

    if (restored && parent) {
      try {
        if (placeholder?.parentNode === parent) {
          placeholder.replaceWith(restored);
        } else {
          parent.insertBefore(restored, nextSibling ?? null);
        }
      } catch (error) {
        logger.error('Unable to restore target element to its original parent', error);
        try {
          body?.appendChild(restored);
        } catch (fallbackError) {
          logger.error('Fallback restoration failed for element mode', fallbackError);
        }
      }
    } else if (restored && body) {
      try {
        body.appendChild(restored);
      } catch (error) {
        logger.error('Unable to append restored target element to body', error);
      }
    }

    if (placeholder?.isConnected) {
      placeholder.remove();
    }
    if (container?.isConnected) {
      container.remove();
    }

    if (restored) {
      state.lastOptions = {
        ...state.lastOptions,
        targetElement: restored
      };
    }

    state.elementState = null;
    document.documentElement?.removeAttribute('data-pipx-active');
    body?.removeAttribute('data-pipx-state');
    state.movedNodes = null;
    state.placeholder = null;
  }

  function rollbackDocumentMode(body) {
    restoreDocumentMode(body);
  }

  function rollbackElementMode(body) {
    restoreElementMode(body);
  }

  function restore(trigger) {
    if (state.restorePromise) {
      logger.debug('Restore skipped — restore promise already in progress');
      return state.restorePromise;
    }

    state.restorePromise = (async () => {
      state.isRestoring = true;
      const activeMode = state.mode;
      logger.info('Restoring tab content from PiP', { trigger, mode: activeMode });

      const body = document.body || (await waitForBody());
      const pipWindow = state.pipWindow;

      if (activeMode === PIP_MODE_ELEMENT) {
        restoreElementMode(body);
      } else {
        restoreDocumentMode(body);
      }

      if (state.pipControls) {
        try {
          state.pipControls.remove();
        } catch (error) {
          logger.debug('Unable to remove PiP controls during restore', error);
        }
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

      post({ type: 'PIP_STATE', state: 'closed', trigger, mode: activeMode });
      logger.info('Tab content restored', { trigger, mode: activeMode });

      const fallbackMode = state.lastOptions?.mode ?? PIP_MODE_DOCUMENT;
      state.mode = fallbackMode;
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

  function createElementPlaceholder(target, customMessage, rect) {
    logger.debug('Creating placeholder for element-mode PiP', {
      hasCustomMessage: Boolean(customMessage)
    });

    const placeholder = document.createElement('section');
    placeholder.className = 'pipx-element-placeholder';
    placeholder.setAttribute('role', 'status');
    placeholder.style.minHeight = `${Math.max(160, rect?.height ?? target?.clientHeight ?? 0)}px`;
    placeholder.style.width = '100%';

    const card = document.createElement('div');
    card.className = 'pipx-card pipx-element-card';

    const title = document.createElement('h3');
    title.className = 'pipx-element-title';
    title.textContent = 'Блок открыт в плавающем окне';

    const text = document.createElement('p');
    text.className = 'pipx-element-text';
    text.textContent = customMessage?.trim() || 'Этот блок сейчас отображается в окне «картинка в картинке». Закройте PiP, чтобы вернуть содержимое на страницу.';

    const hint = document.createElement('p');
    hint.className = 'pipx-element-hint';
    hint.textContent = 'Горячая клавиша: Alt+Shift+P (или ⌥⇧P на Mac).';

    card.appendChild(title);
    card.appendChild(text);
    card.appendChild(hint);
    placeholder.appendChild(card);

    return placeholder;
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