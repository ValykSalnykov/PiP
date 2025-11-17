/**
 * @file Основной in-page скрипт для Document Picture-in-Picture.
 * Добавляет выбор элемента и поток трансляции только выбранного узла.
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
    styleObserver: null,
    styleMirror: null,
    titleObserver: null,
    pipHideHandler: null,
    pipResizeHandler: null,
    elementResizeObserver: null,
    isRestoring: false,
    openPromise: null,
    restorePromise: null,
    scroll: { x: 0, y: 0 },
    lastFocus: null,
    originalBackground: null,
    htmlAttributes: null,
    bodyAttributes: null,
    movedNodes: null,
    mode: null,
    selectedElement: null,
    elementParent: null,
    elementNextSibling: null,
    elementPlaceholder: null,
    selection: null
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
    toggle: (options = {}) => {
      const trigger = options?.trigger ?? options ?? 'page-call';
      const mode = options?.mode || null;
      const targetSelector = options?.targetSelector || null;
      const width = options?.width || null;
      const height = options?.height || null;
      
      return toggleWithOptions({ trigger, mode, targetSelector, width, height });
    },
    close: (trigger = 'page-call') => restore(trigger),
    isOpen: () => Boolean(state.pipWindow && !state.pipWindow.closed)
  };

  // Правила для конкретных сайтов
  const SITE_RULES = {
    'hub.daolog.net': {
      patterns: ['/TimeTracker'],
      selector: '#root > div > div > div.tasks-page',
      width: 390,
      height: 500
    }
  };

  function getSiteRule() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    
    const rule = SITE_RULES[hostname];
    if (!rule) return null;
    
    // Проверяем, подходит ли текущий путь под паттерны
    if (rule.patterns && rule.patterns.length > 0) {
      const matches = rule.patterns.some(pattern => pathname.includes(pattern));
      if (!matches) return null;
    }
    
    return rule;
  }

  function handleIncomingMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== EXTENSION_SOURCE) return;

    logger.debug('Received message from extension', { type: data.type, trigger: data.trigger });

    if (data.type === 'TOGGLE') {
      toggle(data.trigger ?? 'extension');
    } else if (data.type === 'CLOSE') {
      restore(data.trigger ?? 'extension');
    } else if (data.type === 'SELECT_ELEMENT') {
      startElementSelection(data.trigger ?? 'extension').catch((error) => {
        logger.error('Failed to start element selection', error);
        post({
          type: 'PIP_SELECTION',
          state: 'idle',
          reason: 'failed',
          message: error?.message ?? String(error)
        });
      });
    }
  }

  async function toggleWithOptions({ trigger, mode, targetSelector, width, height }) {
    logger.info('Toggle with options requested', { trigger, mode, targetSelector, width, height });

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

    // Получаем правила для текущего сайта
    const siteRule = getSiteRule();
    
    // Определяем финальные параметры
    let finalMode = mode;
    let finalElement = null;
    let finalWidth = width;
    let finalHeight = height;

    // Если передан селектор или есть правило для сайта с селектором
  const selector = siteRule?.selector || targetSelector;
    if (selector) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          finalMode = 'element';
          finalElement = element;
          // Используем размеры из правил или переданные параметры
          finalWidth = finalWidth || siteRule?.width;
          finalHeight = finalHeight || siteRule?.height;
          logger.info('Element found by selector', { selector, width: finalWidth, height: finalHeight });
        } else {
          logger.warn('Element not found by selector', { selector });
        }
      } catch (error) {
        logger.error('Invalid selector', { selector, error });
      }
    }

    // Если режим не определен, используем режим 'element' если есть элемент, иначе 'page'
    if (!finalMode) {
      finalMode = finalElement ? 'element' : 'page';
    }

    // Если режим 'element-only' (из старого API), преобразуем в 'element'
    if (finalMode === 'element-only') {
      finalMode = 'element';
    }

    if (finalMode === 'element' && finalElement) {
      return openPip({ 
        mode: 'element', 
        element: finalElement, 
        trigger,
        customSize: finalWidth && finalHeight ? { width: finalWidth, height: finalHeight } : null
      });
    }

    return openPip({ mode: 'page', trigger });
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

    return openPip({ mode: 'page', trigger });
  }

  async function startElementSelection(trigger) {
    logger.info('Element selection requested', { trigger });

    if (!isSupported()) {
      logger.warn('Document Picture-in-Picture API is not available');
      showUnsupportedNotice();
      post({ type: 'PIP_UNSUPPORTED', reason: 'api-missing' });
      return;
    }

    if (state.selection) {
      cancelElementSelection('toggle');
      return;
    }

    try {
      if (state.openPromise) {
        await state.openPromise.catch(() => {});
      }
      if (state.restorePromise) {
        await state.restorePromise.catch(() => {});
      }
      if (state.pipWindow && !state.pipWindow.closed) {
        await restore('selection-start');
      }
    } catch (error) {
      logger.warn('Failed to settle previous PiP state before selection', error);
    }

    const body = document.body || (await waitForBody());
    if (!body) {
      throw new Error('Document body is not ready for element selection');
    }

    const overlay = document.createElement('div');
    overlay.id = 'pipx-selection-overlay';
    overlay.dataset.pipxSelectionOverlay = 'true';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483638';
    overlay.style.pointerEvents = 'none';
    overlay.style.background = 'rgba(15, 23, 42, 0.05)';
    overlay.style.backdropFilter = 'blur(1.5px)';
    overlay.style.transition = 'opacity 0.2s ease';

    const highlight = document.createElement('div');
    highlight.id = 'pipx-selection-highlight';
    highlight.dataset.pipxSelectionOverlay = 'true';
    highlight.style.position = 'fixed';
    highlight.style.pointerEvents = 'none';
    highlight.style.display = 'none';
    highlight.style.border = '2px solid rgba(59, 130, 246, 0.85)';
    highlight.style.background = 'rgba(59, 130, 246, 0.18)';
    highlight.style.borderRadius = '8px';
    highlight.style.boxShadow = '0 18px 40px rgba(37, 99, 235, 0.25)';

    const tooltip = document.createElement('div');
    tooltip.id = 'pipx-selection-tooltip';
    tooltip.dataset.pipxSelectionOverlay = 'true';
    tooltip.style.position = 'fixed';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.display = 'none';
    tooltip.style.padding = '6px 12px';
    tooltip.style.borderRadius = '999px';
    tooltip.style.background = 'rgba(15, 23, 42, 0.86)';
    tooltip.style.color = '#f8fafc';
    tooltip.style.font = '500 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif';
    tooltip.style.whiteSpace = 'nowrap';

    const hint = document.createElement('div');
    hint.id = 'pipx-selection-hint';
    hint.dataset.pipxSelectionOverlay = 'true';
    hint.style.position = 'fixed';
    hint.style.pointerEvents = 'none';
    hint.style.right = '24px';
    hint.style.bottom = '24px';
    hint.style.padding = '10px 16px';
    hint.style.borderRadius = '12px';
    hint.style.background = 'rgba(15, 23, 42, 0.82)';
    hint.style.color = '#f8fafc';
    hint.style.font = '500 12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif';
    hint.style.maxWidth = '280px';
    hint.textContent = 'Наведите курсор и кликните по элементу, чтобы вывести его в плавающее окно. Esc или правая кнопка — отмена.';

    overlay.appendChild(highlight);
    overlay.appendChild(tooltip);
    overlay.appendChild(hint);
    body.appendChild(overlay);

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';

    state.selection = {
      overlay,
      highlight,
      tooltip,
      hint,
      trigger,
      currentTarget: null,
      pendingTarget: null,
      previousCursor
    };

    document.addEventListener('pointermove', handleSelectionPointerMove, true);
    document.addEventListener('pointerdown', handleSelectionPointerDown, true);
    document.addEventListener('click', handleSelectionClick, true);
    document.addEventListener('keydown', handleSelectionKeyDown, true);
    window.addEventListener('scroll', handleSelectionViewportChange, true);
    window.addEventListener('resize', handleSelectionViewportChange, true);

    post({ type: 'PIP_SELECTION', state: 'active', trigger });
    logger.info('Element selection overlay enabled', { trigger });
  }

  function cancelElementSelection(reason = 'cancelled') {
    const selection = state.selection;
    if (!selection) return;

    document.removeEventListener('pointermove', handleSelectionPointerMove, true);
    document.removeEventListener('pointerdown', handleSelectionPointerDown, true);
    document.removeEventListener('click', handleSelectionClick, true);
    document.removeEventListener('keydown', handleSelectionKeyDown, true);
    window.removeEventListener('scroll', handleSelectionViewportChange, true);
    window.removeEventListener('resize', handleSelectionViewportChange, true);

    if (selection.overlay?.isConnected) {
      selection.overlay.remove();
    }

    if (selection.previousCursor !== undefined) {
      if (selection.previousCursor) {
        document.body.style.cursor = selection.previousCursor;
      } else {
        document.body.style.removeProperty('cursor');
      }
    }

    state.selection = null;
    post({ type: 'PIP_SELECTION', state: 'idle', reason });
    logger.info('Element selection overlay removed', { reason });
  }

  function finishElementSelection(target, trigger) {
    if (!target || !(target instanceof Element)) {
      logger.warn('No selectable element under cursor to stream');
      cancelElementSelection('empty');
      return;
    }
    const selectionTrigger = trigger ?? state.selection?.trigger ?? 'selection';
    cancelElementSelection('selected');

    queueMicrotask(() => {
      if (!target.isConnected) {
        logger.warn('Selected element is no longer in the document, aborting PiP');
        return;
      }
      
      // Проверяем, есть ли правило для текущего сайта
      const siteRule = getSiteRule();
      const customSize = siteRule?.width && siteRule?.height 
        ? { width: siteRule.width, height: siteRule.height }
        : null;
      
      openElementInPip(target, selectionTrigger, customSize).catch((error) => {
        logger.error('Failed to open selected element in PiP', error);
      });
    });
  }

  function handleSelectionPointerMove(event) {
    const selection = state.selection;
    if (!selection) return;

    const target = pickSelectableElement(event.clientX, event.clientY);
    selection.currentTarget = target || null;

    updateSelectionHighlight();
  }

  function handleSelectionPointerDown(event) {
    const selection = state.selection;
    if (!selection) return;

    if (event.button !== 0) {
      event.preventDefault();
      event.stopPropagation();
      cancelElementSelection('pointer-cancel');
      return;
    }

    const target = pickSelectableElement(event.clientX, event.clientY);
    if (!target) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    selection.pendingTarget = target;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleSelectionClick(event) {
    const selection = state.selection;
    if (!selection) return;

    event.preventDefault();
    event.stopPropagation();

    const target = selection.pendingTarget || selection.currentTarget;
    finishElementSelection(target, selection.trigger);
  }

  function handleSelectionKeyDown(event) {
    const selection = state.selection;
    if (!selection) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelElementSelection('escape');
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      finishElementSelection(selection.currentTarget, `${selection.trigger ?? 'selection'}-keyboard`);
    }
  }

  function handleSelectionViewportChange() {
    updateSelectionHighlight();
  }

  function updateSelectionHighlight() {
    const selection = state.selection;
    if (!selection) return;

    const target = selection.currentTarget;
    const { highlight, tooltip } = selection;

    if (!target || !(target instanceof Element)) {
      highlight.style.display = 'none';
      tooltip.style.display = 'none';
      selection.pendingTarget = null;
      return;
    }

    const rect = target.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      highlight.style.display = 'none';
      tooltip.style.display = 'none';
      return;
    }

    highlight.style.display = 'block';
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${Math.max(rect.width, 1)}px`;
    highlight.style.height = `${Math.max(rect.height, 1)}px`;

    tooltip.style.display = 'block';
    tooltip.textContent = describeElement(target);
    const tooltipRect = tooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width || tooltip.textContent.length * 8;
    const tooltipHeight = tooltipRect.height || 20;

    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    left = Math.min(Math.max(8, left), window.innerWidth - tooltipWidth - 8);
    let top = rect.top - tooltipHeight - 12;
    if (top < 8) {
      top = rect.bottom + 12;
    }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function pickSelectableElement(clientX, clientY) {
    let element = document.elementFromPoint(clientX, clientY);
    while (element) {
      if (!(element instanceof Element)) return null;
      if (element.dataset?.pipxSelectionOverlay === 'true') {
        element = element.parentElement;
        continue;
      }
      if (element.dataset?.pipx === 'element-placeholder') {
        element = element.parentElement;
        continue;
      }
      if (element === document.documentElement || element === document.body) {
        return null;
      }
      return element;
    }
    return null;
  }

  async function openElementInPip(element, trigger, customSize = null) {
    return openPip({ mode: 'element', element, trigger, customSize });
  }

  async function openPip({ mode, element, trigger, customSize }) {
    if (!isSupported()) {
      logger.warn('Document Picture-in-Picture API is not available');
      showUnsupportedNotice();
      post({ type: 'PIP_UNSUPPORTED', reason: 'api-missing' });
      return;
    }

    if (state.openPromise) {
      logger.debug('Open skipped — another open promise already in progress');
      return state.openPromise;
    }

    if (state.pipWindow && !state.pipWindow.closed) {
      logger.info('PiP already open, scheduling restore', { trigger, mode });
      return restore(trigger);
    }

    disconnectElementResizeObserver();

    state.openPromise = (async () => {
      const options = { preferInitialWindowPlacement: true };
      
      // Приоритет: customSize > initialElementSize > lastKnownSize > fallbackSize
      if (customSize && customSize.width && customSize.height) {
        const clamped = clampPipWindowSize(customSize.width, customSize.height);
        options.width = clamped.width;
        options.height = clamped.height;
        logger.info('Using custom size for PiP window', { width: clamped.width, height: clamped.height });
      } else {
        const initialElementSize = mode === 'element' ? getElementPreferredPipSize(element) : null;

        if (initialElementSize) {
          options.width = initialElementSize.width;
          options.height = initialElementSize.height;
        } else if (lastKnownSize) {
          options.width = lastKnownSize.width;
          options.height = lastKnownSize.height;
        } else {
          const fallbackSize = getDefaultPipWindowSize();
          options.width = fallbackSize.width;
          options.height = fallbackSize.height;
        }
      }

      let pipWindow;
      try {
        pipWindow = await window.documentPictureInPicture.requestWindow(options);
        logger.debug('PiP window handle acquired', {
          width: pipWindow.innerWidth,
          height: pipWindow.innerHeight,
          mode
        });
        lastKnownSize = {
          width: pipWindow.innerWidth,
          height: pipWindow.innerHeight
        };
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
      state.mode = mode;
      state.movedNodes = null;
      state.selectedElement = null;
      state.elementParent = null;
      state.elementNextSibling = null;
      state.elementPlaceholder = null;
      state.placeholder = null;

      let placeholder = null;
      let fragment = document.createDocumentFragment();

      try {
        if (mode === 'page') {
          const result = detachBodyContent(body);
          fragment = result.fragment;
          state.movedNodes = result.movedNodes;
          placeholder = createPagePlaceholder();
          body.appendChild(placeholder);
        } else if (mode === 'element') {
          if (!element || !(element instanceof Element) || !element.isConnected) {
            throw new Error('Selected element is not available in the document');
          }
          const result = detachElement(element);
          fragment = result.fragment;
          placeholder = result.placeholder;
          state.selectedElement = result.element;
          state.elementParent = result.parent;
          state.elementNextSibling = result.nextSibling;
          state.elementPlaceholder = placeholder;
        } else {
          throw new Error(`Unsupported PiP mode: ${String(mode)}`);
        }

        state.placeholder = placeholder;

        document.documentElement?.setAttribute('data-pipx-active', 'true');
        body.setAttribute('data-pipx-state', mode === 'page' ? 'placeholder' : 'element-placeholder');

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

        if (mode === 'element') {
          queueMicrotask(() => {
            const activeWindow = state.pipWindow;
            const target = state.selectedElement;
            if (!activeWindow || activeWindow.closed || !target) return;
            resizePipWindowToElement(activeWindow, target);
            activeWindow.requestAnimationFrame?.(() => {
              resizePipWindowToElement(activeWindow, target);
            });
            attachElementResizeObserver(activeWindow, target);
          });
        } else {
          disconnectElementResizeObserver();
        }

        post({ type: 'PIP_STATE', state: 'open', trigger, mode });
        logger.info('PiP window initialised', { trigger, mode });
      } catch (error) {
        logger.error('Failed to initialise PiP window', error);

        try {
          if (mode === 'page') {
            const movedNodes = state.movedNodes || [];
            movedNodes.forEach((node) => {
              body.appendChild(node);
            });
            state.movedNodes = null;
          } else if (mode === 'element') {
            if (state.selectedElement) {
              const adopt = state.selectedElement.ownerDocument === document
                ? state.selectedElement
                : document.adoptNode(state.selectedElement);
              const parent = state.elementParent;
              if (parent?.isConnected) {
                parent.insertBefore(adopt, state.elementNextSibling || null);
              }
            }
            if (state.elementPlaceholder?.isConnected) {
              state.elementPlaceholder.remove();
            }
            state.selectedElement = null;
            state.elementParent = null;
            state.elementNextSibling = null;
            state.elementPlaceholder = null;
          }
        } catch (rollbackError) {
          logger.warn('Rollback after PiP failure encountered an error', rollbackError);
        }

        if (placeholder?.isConnected) {
          placeholder.remove();
        }
        document.documentElement?.removeAttribute('data-pipx-active');
        body.removeAttribute('data-pipx-state');

        disconnectElementResizeObserver();
        cleanupObservers();

        try {
          if (pipWindow && !pipWindow.closed) {
            pipWindow.close();
          }
        } catch (closeError) {
          logger.warn('Unable to close PiP window after failure', closeError);
        }

        state.mode = null;
        throw error;
      }
    })().finally(() => {
      state.openPromise = null;
    });

    return state.openPromise;
  }

  function restore(trigger) {
    if (state.restorePromise) {
      logger.debug('Restore skipped — restore promise already in progress');
      return state.restorePromise;
    }

    state.restorePromise = (async () => {
      state.isRestoring = true;
      disconnectElementResizeObserver();
      const activeMode = state.mode;
      logger.info('Restoring content from PiP', { trigger, mode: activeMode });

      const body = document.body || (await waitForBody());
      const mode = activeMode;

      if (mode === 'page') {
        const movedNodes = state.movedNodes || [];
        movedNodes.forEach((node) => {
          body.appendChild(node);
        });
        state.movedNodes = null;

        if (state.placeholder?.isConnected) {
          state.placeholder.remove();
        }
      } else if (mode === 'element') {
        const parent = state.elementParent;
        const placeholder = state.elementPlaceholder;
        const nextSibling = state.elementNextSibling;
        const element = state.selectedElement;

        if (element && parent?.isConnected) {
          const adopt = element.ownerDocument === document ? element : document.adoptNode(element);
          if (placeholder?.parentNode === parent) {
            parent.insertBefore(adopt, placeholder);
            placeholder.remove();
          } else {
            parent.insertBefore(adopt, nextSibling || null);
            if (placeholder?.isConnected) {
              placeholder.remove();
            }
          }
        } else if (element) {
          document.body?.appendChild(document.adoptNode(element));
        }

        state.selectedElement = null;
        state.elementParent = null;
        state.elementNextSibling = null;
        state.elementPlaceholder = null;
        state.placeholder = null;
      }

      body?.removeAttribute('data-pipx-state');
      document.documentElement?.removeAttribute('data-pipx-active');

      cleanupObservers();

      if (state.pipWindow) {
        try {
          if (state.pipHideHandler) {
            state.pipWindow.removeEventListener('pagehide', state.pipHideHandler);
          }
          if (state.pipResizeHandler) {
            state.pipWindow.removeEventListener('resize', state.pipResizeHandler);
          }
          if (!state.pipWindow.closed) {
            state.pipWindow.close();
          }
        } catch (error) {
          logger.warn('Failed to close PiP window during restore', error);
        }
      }

      state.pipWindow = null;
      state.pipHideHandler = null;
      state.pipResizeHandler = null;

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

      state.originalBackground = null;
      state.htmlAttributes = null;
      state.bodyAttributes = null;
      state.mode = null;

      post({ type: 'PIP_STATE', state: 'closed', trigger, mode });
      logger.info('Content restored from PiP', { trigger, mode });
    })().finally(() => {
      state.isRestoring = false;
      state.restorePromise = null;
    });

    return state.restorePromise;
  }

  function createPagePlaceholder() {
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
    description.textContent =
      `Окно «картинка в картинке» остаётся поверх всех приложений. Верните содержимое во вкладку кнопкой ниже или сочетанием ${hotkey}.`;

    const actions = document.createElement('div');
    actions.className = 'pipx-actions';

    const returnButton = document.createElement('button');
    returnButton.type = 'button';
    returnButton.className = 'pipx-return';
    returnButton.textContent = 'Вернуть во вкладку';
    returnButton.addEventListener('click', () => restore('placeholder-button'));

    const note = document.createElement('p');
    note.className = 'pipx-note';
    note.textContent = 'Закрытие исходной вкладки автоматически закроет плавающее окно.';

    actions.appendChild(returnButton);
    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(actions);
    card.appendChild(note);
    wrapper.appendChild(card);

    return wrapper;
  }

  function detachBodyContent(body) {
    const fragment = document.createDocumentFragment();
    const movedNodes = [];
    while (body.firstChild) {
      const node = body.firstChild;
      movedNodes.push(node);
      fragment.appendChild(node);
    }
    return { fragment, movedNodes };
  }

  function detachElement(element) {
    const parent = element.parentNode;
    if (!parent) {
      throw new Error('Selected element has no parent node');
    }

    const placeholder = createElementPlaceholder(element);
    parent.insertBefore(placeholder, element);

    const nextSibling = element.nextSibling;
    const fragment = document.createDocumentFragment();
    fragment.appendChild(element);

    return {
      fragment,
      placeholder,
      parent,
      nextSibling,
      element
    };
  }

  function createElementPlaceholder(element) {
    const clone = element.cloneNode(true);
    clone.dataset.pipx = 'element-placeholder';
    clone.classList.add('pipx-element-placeholder');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.pointerEvents = 'none';
    clone.style.userSelect = 'none';
    clone.style.opacity = '0.25';
    clone.style.outline = '2px dashed rgba(59, 130, 246, 0.5)';
    clone.style.outlineOffset = '4px';
    clone.style.transition = 'opacity 0.2s ease, outline-color 0.2s ease';

    sanitizePlaceholder(clone);
    disableInteractiveDescendants(clone);

    clone.addEventListener('mouseenter', () => {
      clone.style.opacity = '0.35';
      clone.style.outlineColor = 'rgba(37, 99, 235, 0.65)';
    });
    clone.addEventListener('mouseleave', () => {
      clone.style.opacity = '0.25';
      clone.style.outlineColor = 'rgba(59, 130, 246, 0.5)';
    });

    return clone;
  }

  function preparePipWindow(pipWindow, fragment, backgroundColor, htmlAttributes, bodyAttributes) {
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

/* Ensure tasks-page shows all content */
.tasks-page {
  display: flex !important;
  flex-direction: column !important;
  width: 100% !important;
  height: auto !important;
  min-height: 100% !important;
  overflow: visible !important;
  gap: 16px !important;
}

.tasks-page > * {
  flex-shrink: 0 !important;
}

.tasks-page .pool-section {
  width: 100% !important;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
}

.tasks-page .pool-section .tasks-list {
  display: block !important;
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
}

.tasks-page .pool-section + .pool-section,
.tasks-page .pool-section:last-of-type,
.tasks-page > div:nth-child(2),
.tasks-page > div:last-child {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  height: auto !important;
  max-height: none !important;
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
    disconnectElementResizeObserver();
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

  function sanitizePlaceholder(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.hasAttribute('id')) {
        node.removeAttribute('id');
      }
      Array.from(node.attributes).forEach((attr) => {
        if (attr.name.startsWith('on')) {
          node.removeAttribute(attr.name);
        }
      });
      stack.push(...node.children);
    }
  }

  function disableInteractiveDescendants(root) {
    if (!(root instanceof Element)) return;
    root.querySelectorAll('a, button, input, textarea, select, summary, details, [tabindex]').forEach((el) => {
      el.setAttribute('tabindex', '-1');
      el.setAttribute('aria-hidden', 'true');
      if ('disabled' in el) {
        try {
          el.disabled = true;
        } catch {
          /* ignore */
        }
      }
    });
  }

  function describeElement(element) {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const classList = element.classList.length
      ? '.' + Array.from(element.classList).slice(0, 3).join('.')
      : '';
    return `${tag}${id}${classList}`;
  }

  function getElementPreferredPipSize(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null;
    try {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return null;
      }
      return clampPipWindowSize(rect.width, rect.height);
    } catch (error) {
      logger.warn('Unable to calculate element size for PiP window', error);
      return null;
    }
  }

  function clampPipWindowSize(width, height) {
    const MIN_WIDTH = 80;
    const MIN_HEIGHT = 60;
    const screenWidth = window.screen?.availWidth ?? 1920;
    const screenHeight = window.screen?.availHeight ?? 1080;
    const MAX_WIDTH = Math.max(MIN_WIDTH, Math.min(screenWidth, 1920));
    const MAX_HEIGHT = Math.max(MIN_HEIGHT, Math.min(screenHeight, 1200));

    const safeWidth = Number.isFinite(width) && width > 0 ? width : 640;
    const safeHeight = Number.isFinite(height) && height > 0 ? height : 360;

    return {
      width: Math.round(Math.min(Math.max(safeWidth, MIN_WIDTH), MAX_WIDTH)),
      height: Math.round(Math.min(Math.max(safeHeight, MIN_HEIGHT), MAX_HEIGHT))
    };
  }

  function getDefaultPipWindowSize() {
    const baseWidth = window.innerWidth ? window.innerWidth * 0.6 : 640;
    const baseHeight = window.innerHeight ? window.innerHeight * 0.6 : 360;
    return clampPipWindowSize(baseWidth, baseHeight);
  }

  function resizePipWindowToElement(pipWindow, element) {
    if (!pipWindow || pipWindow.closed || !element) return;
    try {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const { width, height } = clampPipWindowSize(rect.width, rect.height);
      if (
        lastKnownSize &&
        Math.abs(lastKnownSize.width - width) <= 1 &&
        Math.abs(lastKnownSize.height - height) <= 1
      ) {
        return;
      }
      if (typeof pipWindow.resizeTo === 'function') {
        pipWindow.resizeTo(width, height);
      }
      lastKnownSize = { width, height };
      logger.debug('Adjusted PiP window to match element', { width, height });
    } catch (error) {
      logger.warn('Failed to resize PiP window to match element', error);
    }
  }

  function attachElementResizeObserver(pipWindow, element) {
    disconnectElementResizeObserver();
    if (!pipWindow || pipWindow.closed || !element) return;

    const ResizeObserverCtor = pipWindow.ResizeObserver || window.ResizeObserver;
    if (typeof ResizeObserverCtor !== 'function') {
      logger.debug('ResizeObserver unavailable — skipping automatic PiP resizing');
      return;
    }

    try {
      const observer = new ResizeObserverCtor(() => {
        resizePipWindowToElement(pipWindow, element);
      });
      observer.observe(element);
      state.elementResizeObserver = observer;
    } catch (error) {
      logger.warn('Unable to attach ResizeObserver for PiP element', error);
    }
  }

  function disconnectElementResizeObserver() {
    const observer = state.elementResizeObserver;
    if (!observer) return;
    try {
      observer.disconnect();
    } catch (error) {
      logger.warn('Failed to disconnect element ResizeObserver', error);
    }
    state.elementResizeObserver = null;
  }
})();