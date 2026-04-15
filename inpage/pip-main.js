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
  const TASK_HIGHLIGHT_CLASS = 'pipx-task-flash';
  const TASK_OVERDUE_BLINK_CLASS = 'pipx-task-overdue-blink';
  const TASK_HIGHLIGHT_DURATION_MS = 10000;
  const TASK_HIGHLIGHT_PULSE_DURATION_MS = 5000;
  const TASK_OVERDUE_THRESHOLD_MS = 10 * 60 * 1000;
  const TASK_OVERDUE_BLINK_ACTIVE_MS = 10000;
  const TASK_OVERDUE_BLINK_CYCLE_MS = TASK_OVERDUE_BLINK_ACTIVE_MS * 2;
  const GENERAL_POOL_PREFIXES = ['загальний пул', 'общий пул', 'general pool'];
  const DEFAULT_TASK_HIGHLIGHT_SETTINGS = Object.freeze({
    enabled: false,
    color: '#2fd212',
    overdueBlinkEnabled: false
  });

  let lastKnownSize = null;

  logger.info('In-page PiP controller bootstrapped');

  const state = {
    pipWindow: null,
    placeholder: null,
    styleObserver: null,
    styleMirror: null,
    titleObserver: null,
    mirrorObserver: null,
    taskHighlightSettingsObserver: null,
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
    mirroredElement: null,
    domMirrorMap: null,
    taskHighlightSettings: { ...DEFAULT_TASK_HIGHLIGHT_SETTINGS },
    taskHighlightExpirations: new Map(),
    taskHighlightCleanupTimer: null,
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
    'hub.daolog.net': [
      {
        patterns: ['/TimeTracker'],
        mode: 'mirror',
        selector: '#root > div > div > div.tasks-page',
        pipStyleProfile: 'daolog-time-tracker-compact',
        width: 390,
        height: 500
      },
      {
        patterns: ['/InstallSyrve'],
        selector: '#root > div > div > div.tasks-page',
        mode: 'page',
        width: 390,
        height: 500,
        lockSize: true
      }
    ]
  };

  function getSiteRule() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;

    const hostRules = SITE_RULES[hostname];
    if (!hostRules) return null;

    const normalizedRules = Array.isArray(hostRules) ? hostRules : [hostRules];
    for (const rule of normalizedRules) {
      if (rule.patterns && rule.patterns.length > 0) {
        const matches = rule.patterns.some((pattern) => {
          if (pattern instanceof RegExp) {
            try {
              return pattern.test(pathname);
            } catch {
              return false;
            }
          }
          return pathname.includes(pattern);
        });
        if (!matches) {
          continue;
        }
      }
      return rule;
    }

    return null;
  }

  function resolveTargetElement(selector) {
    if (!selector || typeof selector !== 'string') {
      return null;
    }

    let matches;
    try {
      matches = Array.from(document.querySelectorAll(selector));
    } catch (error) {
      logger.error('Invalid selector received', { selector, error });
      return null;
    }

    if (matches.length === 0) {
      logger.warn('Element not found by selector', { selector });
      return null;
    }

    if (matches.length === 1) {
      logger.info('Element found by selector', { selector });
      return { element: matches[0], matchedCount: 1 };
    }

    const ancestor = findSharedAncestor(matches);
    if (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      logger.info('Multiple elements matched selector — using shared ancestor', {
        selector,
        matched: matches.length,
        ancestorTag: ancestor.tagName?.toLowerCase() ?? null,
        ancestorClass: ancestor.className || null
      });
      return {
        element: ancestor,
        matchedCount: matches.length,
        usedAncestor: true
      };
    }

    logger.warn('Selector matched multiple elements but no safe ancestor was found — falling back to page mode', {
      selector,
      matched: matches.length
    });
    return { element: null, matchedCount: matches.length, forceMode: 'page' };
  }

  function findSharedAncestor(elements) {
    if (!elements || elements.length === 0) {
      return null;
    }

    const chains = elements.map((element) => {
      const lineage = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        lineage.push(current);
        current = current.parentElement;
      }
      if (document.documentElement) {
        lineage.push(document.documentElement);
      }
      return lineage;
    });

    let reference = chains[0] || null;
    for (const chain of chains) {
      if (!reference || chain.length < reference.length) {
        reference = chain;
      }
    }
    if (!reference) {
      return null;
    }

    for (const candidate of reference) {
      if (candidate && chains.every((chain) => chain.includes(candidate))) {
        return candidate;
      }
    }

    return null;
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
    let finalMode = mode || siteRule?.mode || null;
    let finalElement = null;
    let finalWidth = width ?? siteRule?.width ?? null;
    let finalHeight = height ?? siteRule?.height ?? null;

    // Если передан селектор или есть правило для сайта с селектором
    const selector = targetSelector || siteRule?.selector;
    if (selector) {
      const resolution = resolveTargetElement(selector);
      if (resolution?.element) {
        finalElement = resolution.element;
        if (!finalMode || finalMode === 'element') {
          finalMode = 'element';
        }
        // Используем размеры из правил или переданные параметры
        finalWidth = finalWidth || siteRule?.width;
        finalHeight = finalHeight || siteRule?.height;
      } else if (resolution?.forceMode) {
        finalMode = resolution.forceMode;
      }
    }

    if (siteRule?.mode === 'mirror' && finalElement && finalMode !== 'page') {
      if (finalMode !== 'mirror') {
        logger.info('Overriding requested PiP mode with site mirror rule', {
          trigger,
          requestedMode: finalMode,
          enforcedMode: siteRule.mode
        });
      }
      finalMode = 'mirror';
    }

    // Если режим не определен, используем режим 'element' если есть элемент, иначе 'page'
    if (!finalMode) {
      finalMode = finalElement ? 'element' : 'page';
    }

    if ((finalMode === 'element' || finalMode === 'mirror') && !finalElement) {
      logger.warn('Element-based mode requested but no element resolved — falling back to page mode');
      finalMode = 'page';
    }

    // Если режим 'element-only' (из старого API), преобразуем в 'element'
    if (finalMode === 'element-only') {
      finalMode = 'element';
    }

    const customSize = finalWidth && finalHeight ? { width: finalWidth, height: finalHeight } : null;
    const lockSize = Boolean(siteRule?.lockSize);

    if ((finalMode === 'element' || finalMode === 'mirror') && finalElement) {
      return openPip({ 
        mode: finalMode,
        element: finalElement, 
        trigger,
        customSize,
        lockSize,
        siteRule
      });
    }

    return openPip({ mode: 'page', trigger, customSize, lockSize, siteRule });
  }

  async function toggle(trigger) {
    return toggleWithOptions({ trigger });
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
      const lockSize = Boolean(siteRule?.lockSize);
      
      openElementInPip(target, selectionTrigger, customSize, lockSize, siteRule).catch((error) => {
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

  async function openElementInPip(element, trigger, customSize = null, lockSize = false, siteRule = null) {
    const mode = siteRule?.mode === 'mirror' ? 'mirror' : 'element';
    return openPip({ mode, element, trigger, customSize, lockSize, siteRule });
  }

  async function openPip({ mode, element, trigger, customSize, lockSize = false, siteRule = null }) {
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
    disconnectMirrorObserver();
    resetTaskHighlights();
    captureActiveTaskHighlightSettings();

    state.openPromise = (async () => {
      const options = { preferInitialWindowPlacement: true };
      
      // Приоритет: customSize > initialElementSize > lastKnownSize > fallbackSize
      if (customSize && customSize.width && customSize.height) {
        const clamped = clampPipWindowSize(customSize.width, customSize.height);
        options.width = clamped.width;
        options.height = clamped.height;
        logger.info('Using custom size for PiP window', { width: clamped.width, height: clamped.height });
      } else {
        const initialElementSize = mode === 'element' || mode === 'mirror'
          ? getElementPreferredPipSize(element)
          : null;

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
      state.mirroredElement = null;
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
        } else if (mode === 'mirror') {
          if (!element || !(element instanceof Element) || !element.isConnected) {
            throw new Error('Selected element is not available in the document');
          }
          const result = createMirroredFragment(element);
          fragment = result.fragment;
          state.selectedElement = result.sourceElement;
          state.mirroredElement = result.mirroredElement;
          state.domMirrorMap = result.mirrorMap;
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

        if (mode !== 'mirror') {
          document.documentElement?.setAttribute('data-pipx-active', 'true');
          body.setAttribute('data-pipx-state', mode === 'page' ? 'placeholder' : 'element-placeholder');
        }

        preparePipWindow(
          pipWindow,
          fragment,
          state.originalBackground,
          state.htmlAttributes,
          state.bodyAttributes,
          siteRule
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

        if ((mode === 'element' || mode === 'mirror') && !lockSize) {
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
          if (lockSize) {
            logger.debug('Automatic PiP resizing disabled — size locked by rule');
          }
          disconnectElementResizeObserver();
        }

        if (mode === 'mirror' && state.selectedElement) {
          attachMirrorObserver(state.selectedElement);
        }

        attachTaskHighlightSettingsObserver();

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
          } else if (mode === 'mirror') {
            state.selectedElement = null;
            state.mirroredElement = null;
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
      disconnectMirrorObserver();
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
      } else if (mode === 'mirror') {
        state.selectedElement = null;
        state.mirroredElement = null;
        state.placeholder = null;
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

  function createMirroredFragment(element) {
    const fragment = document.createDocumentFragment();
    const mirroredElement = element.cloneNode(true);

    if (element instanceof Element && element.classList.contains('tasks-page')) {
      captureTimeTrackerTaskSnapshot(mirroredElement, { applyDomMetadata: true });
    }

    const mirrorMap = createDomMirrorMap(element, mirroredElement);
    fragment.appendChild(mirroredElement);

    return {
      fragment,
      mirroredElement,
      sourceElement: element,
      mirrorMap
    };
  }

  function registerDomMirrorSubtree(sourceNode, mirroredNode, mirrorMap) {
    if (!sourceNode || !mirroredNode || !(mirrorMap instanceof Map)) {
      return;
    }

    mirrorMap.set(sourceNode, mirroredNode);

    const sourceChildren = Array.from(sourceNode.childNodes || []);
    const mirroredChildren = Array.from(mirroredNode.childNodes || []);
    const childCount = Math.min(sourceChildren.length, mirroredChildren.length);

    for (let index = 0; index < childCount; index += 1) {
      registerDomMirrorSubtree(sourceChildren[index], mirroredChildren[index], mirrorMap);
    }
  }

  function unregisterDomMirrorSubtree(sourceNode, mirrorMap) {
    if (!sourceNode || !(mirrorMap instanceof Map)) {
      return;
    }

    mirrorMap.delete(sourceNode);
    Array.from(sourceNode.childNodes || []).forEach((childNode) => {
      unregisterDomMirrorSubtree(childNode, mirrorMap);
    });
  }

  function createDomMirrorMap(sourceRoot, mirroredRoot) {
    const mirrorMap = new Map();
    registerDomMirrorSubtree(sourceRoot, mirroredRoot, mirrorMap);
    return mirrorMap;
  }

  function normalizeTaskIdentityPart(value) {
    return (value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function normalizeTaskHighlightColor(value, fallback = DEFAULT_TASK_HIGHLIGHT_SETTINGS.color) {
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

  function hexToRgbChannels(hexColor) {
    const normalizedColor = normalizeTaskHighlightColor(hexColor);
    return {
      r: parseInt(normalizedColor.slice(1, 3), 16),
      g: parseInt(normalizedColor.slice(3, 5), 16),
      b: parseInt(normalizedColor.slice(5, 7), 16)
    };
  }

  function getTaskHighlightTextColor(hexColor) {
    const { r, g, b } = hexToRgbChannels(hexColor);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128 ? '#050505' : '#f8fafc';
  }

  function readTaskHighlightSettingsFromDocument() {
    const root = document.documentElement;
    return {
      enabled: root?.dataset?.pipxTaskHighlightEnabled === 'true',
      color: normalizeTaskHighlightColor(root?.dataset?.pipxTaskHighlightColor),
      overdueBlinkEnabled: root?.dataset?.pipxTaskOverdueBlinkEnabled === 'true'
    };
  }

  function captureActiveTaskHighlightSettings() {
    const nextSettings = readTaskHighlightSettingsFromDocument();
    state.taskHighlightSettings = nextSettings;
    return nextSettings;
  }

  function applyTaskHighlightTheme(pipDoc) {
    if (!(pipDoc?.documentElement instanceof Element)) {
      return;
    }

    const activeSettings = state.taskHighlightSettings || DEFAULT_TASK_HIGHLIGHT_SETTINGS;
    const fillColor = normalizeTaskHighlightColor(activeSettings.color);
    const { r, g, b } = hexToRgbChannels(fillColor);

    pipDoc.documentElement.style.setProperty('--pipx-task-highlight-fill', fillColor);
    pipDoc.documentElement.style.setProperty('--pipx-task-highlight-text', getTaskHighlightTextColor(fillColor));
    pipDoc.documentElement.style.setProperty('--pipx-task-highlight-rgb', `${r} ${g} ${b}`);
  }

  function handleTaskHighlightSettingsMutation() {
    const previousSettings = state.taskHighlightSettings || DEFAULT_TASK_HIGHLIGHT_SETTINGS;
    const nextSettings = captureActiveTaskHighlightSettings();

    if (previousSettings.enabled && !nextSettings.enabled) {
      resetTaskHighlights();
    }

    if (state.pipWindow && !state.pipWindow.closed) {
      applyTaskHighlightTheme(state.pipWindow.document);
    }

    refreshTaskHighlights();
  }

  function attachTaskHighlightSettingsObserver() {
    disconnectTaskHighlightSettingsObserver();

    const root = document.documentElement;
    if (!(root instanceof Element)) {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      const hasRelevantMutation = mutations.some((mutation) => (
        mutation.type === 'attributes' &&
        (
          mutation.attributeName === 'data-pipx-task-highlight-enabled' ||
          mutation.attributeName === 'data-pipx-task-highlight-color' ||
          mutation.attributeName === 'data-pipx-task-overdue-blink-enabled'
        )
      ));

      if (!hasRelevantMutation) {
        return;
      }

      handleTaskHighlightSettingsMutation();
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        'data-pipx-task-highlight-enabled',
        'data-pipx-task-highlight-color',
        'data-pipx-task-overdue-blink-enabled'
      ]
    });

    state.taskHighlightSettingsObserver = observer;
  }

  function disconnectTaskHighlightSettingsObserver() {
    if (state.taskHighlightSettingsObserver) {
      state.taskHighlightSettingsObserver.disconnect();
      state.taskHighlightSettingsObserver = null;
    }
  }

  function getTimeTrackerSourceRoot() {
    return state.selectedElement instanceof Element ? state.selectedElement : null;
  }

  function getTimeTrackerSourceNode(mirroredNode) {
    if (!mirroredNode) {
      return null;
    }

    const mirrorMap = state.domMirrorMap;
    if (!(mirrorMap instanceof Map)) {
      return null;
    }

    for (const [sourceNode, mirroredMatch] of mirrorMap.entries()) {
      if (mirroredMatch === mirroredNode) {
        return sourceNode;
      }
    }

    return null;
  }

  function findTimeTrackerSourceTaskCard(mirroredControl) {
    const mirroredCard = mirroredControl?.closest('.task-card');
    const sourceRoot = getTimeTrackerSourceRoot();
    if (!(mirroredCard instanceof Element) || !(sourceRoot instanceof Element)) {
      return null;
    }

    const directSourceCard = getTimeTrackerSourceNode(mirroredCard);
    if (directSourceCard instanceof Element && directSourceCard.classList.contains('task-card')) {
      return directSourceCard;
    }

    const poolIndex = Number.parseInt(mirroredCard.dataset?.pipxPoolIndex || '', 10);
    const cardIndex = Number.parseInt(mirroredCard.dataset?.pipxCardIndex || '', 10);
    if (Number.isInteger(poolIndex) && poolIndex >= 0 && Number.isInteger(cardIndex) && cardIndex >= 0) {
      const sourceSections = Array.from(sourceRoot.children).filter(
        (child) => child instanceof Element && child.classList.contains('pool-section')
      );
      const sourceSection = sourceSections[poolIndex];
      if (sourceSection instanceof Element) {
        const sourceCards = Array.from(sourceSection.querySelectorAll('.task-card'));
        const sourceCard = sourceCards[cardIndex];
        if (sourceCard instanceof Element) {
          return sourceCard;
        }
      }
    }

    const taskKey = mirroredCard.dataset?.pipxTaskKey;
    if (!taskKey) {
      return null;
    }

    return captureTimeTrackerTaskSnapshot(sourceRoot).find((entry) => entry.key === taskKey)?.element || null;
  }

  function findVisibleTimeTrackerNotificationOverlay(root) {
    if (!(root instanceof Element)) {
      return null;
    }

    const overlays = Array.from(root.querySelectorAll('.notification-overlay'));
    const visibleOverlay = overlays.find((overlay) => {
      if (!(overlay instanceof HTMLElement)) {
        return false;
      }
      const styles = window.getComputedStyle(overlay);
      return (
        !overlay.hasAttribute('hidden') &&
        overlay.getAttribute('aria-hidden') !== 'true' &&
        styles.display !== 'none' &&
        styles.visibility !== 'hidden'
      );
    });

    return visibleOverlay || overlays[0] || null;
  }

  function resolveTimeTrackerSourceControl(mirroredControl) {
    if (!(mirroredControl instanceof Element)) {
      return null;
    }

    const directSourceControl = getTimeTrackerSourceNode(mirroredControl);
    if (directSourceControl instanceof Element) {
      return directSourceControl;
    }

    if (mirroredControl.matches('.ask-help-btn, .no-help-btn')) {
      const sourceTaskCard = findTimeTrackerSourceTaskCard(mirroredControl);
      if (!(sourceTaskCard instanceof Element)) {
        return null;
      }

      if (mirroredControl.matches('.ask-help-btn')) {
        return sourceTaskCard.querySelector('.ask-help-btn');
      }

      return sourceTaskCard.querySelector('.no-help-btn');
    }

    if (mirroredControl.matches('.notification-close, .notification-btn.ok, .notification-btn.no-help')) {
      const sourceRoot = getTimeTrackerSourceRoot();
      const sourceOverlay = findVisibleTimeTrackerNotificationOverlay(sourceRoot);
      if (!(sourceOverlay instanceof Element)) {
        return null;
      }

      if (mirroredControl.matches('.notification-close')) {
        return sourceOverlay.querySelector('.notification-close');
      }

      if (mirroredControl.matches('.notification-btn.ok')) {
        return sourceOverlay.querySelector('.notification-btn.ok');
      }

      return sourceOverlay.querySelector('.notification-btn.no-help');
    }

    return null;
  }

  function createSyntheticMouseEventInit(sourceControl, buttons = 0, detail = 0) {
    const controlWindow = sourceControl.ownerDocument?.defaultView || window;
    const rect = sourceControl.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: controlWindow,
      button: 0,
      buttons,
      detail,
      clientX,
      clientY
    };
  }

  function dispatchSyntheticPointerEvent(sourceControl, type, buttons) {
    if (typeof PointerEvent !== 'function') {
      return;
    }

    sourceControl.dispatchEvent(new PointerEvent(type, {
      ...createSyntheticMouseEventInit(sourceControl, buttons),
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      pressure: buttons === 0 ? 0 : 0.5
    }));
  }

  function dispatchSyntheticMouseEvent(sourceControl, type, buttons, detail = 0) {
    sourceControl.dispatchEvent(new MouseEvent(
      type,
      createSyntheticMouseEventInit(sourceControl, buttons, detail)
    ));
  }

  function proxyClickToSourceControl(sourceControl) {
    if (!(sourceControl instanceof HTMLElement)) {
      return false;
    }

    if (!sourceControl.isConnected) {
      return false;
    }

    if (
      (sourceControl instanceof HTMLButtonElement ||
        sourceControl instanceof HTMLInputElement ||
        sourceControl instanceof HTMLSelectElement ||
        sourceControl instanceof HTMLTextAreaElement) &&
      sourceControl.disabled
    ) {
      return false;
    }

    if (sourceControl.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    dispatchSyntheticPointerEvent(sourceControl, 'pointerdown', 1);
    dispatchSyntheticMouseEvent(sourceControl, 'mousedown', 1);
    sourceControl.focus?.({ preventScroll: true });

    if (!sourceControl.isConnected) {
      return true;
    }

    dispatchSyntheticPointerEvent(sourceControl, 'pointerup', 0);
    dispatchSyntheticMouseEvent(sourceControl, 'mouseup', 0);

    if (!sourceControl.isConnected) {
      return true;
    }

    if (typeof sourceControl.click === 'function') {
      sourceControl.click();
      return true;
    }

    dispatchSyntheticMouseEvent(sourceControl, 'click', 0, 1);
    return true;
  }

  function isTimeTrackerMirrorRoot(element) {
    return Boolean(
      state.mode === 'mirror' &&
      element instanceof Element &&
      element.classList.contains('tasks-page')
    );
  }

  function getTimeTrackerPoolIdentifier(section, poolIndex) {
    const title = normalizeTaskIdentityPart(
      section?.querySelector('.pool-title, .pool-title-m')?.textContent || ''
    );
    return title || `pool-${poolIndex}`;
  }

  function getTimeTrackerTaskKey(card, poolIdentifier, cardIndex) {
    const planfixLink = card.querySelector('a[href*="/task/"]')?.getAttribute('href')?.trim();
    if (planfixLink) {
      return `planfix:${planfixLink}`;
    }

    const taskName = normalizeTaskIdentityPart(
      card.querySelector('.task-name')?.textContent || ''
    );

    if (taskName) {
      return `fallback:${poolIdentifier}:${taskName}:${cardIndex}`;
    }

    return `fallback:${poolIdentifier}:index:${cardIndex}`;
  }

  function parseTimeTrackerElapsedMs(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      return null;
    }

    const parts = normalizedValue.split(':').map((part) => part.trim());
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
      return null;
    }

    const numericParts = parts.map((part) => Number.parseInt(part, 10));
    if (numericParts.some((part) => !Number.isFinite(part))) {
      return null;
    }

    if (numericParts.length === 2) {
      const [minutes, seconds] = numericParts;
      return ((minutes * 60) + seconds) * 1000;
    }

    const [hours, minutes, seconds] = numericParts;
    return (((hours * 60 * 60) + (minutes * 60) + seconds) * 1000);
  }

  function getTimeTrackerTaskElapsedMs(card) {
    if (!(card instanceof Element)) {
      return null;
    }

    const timerText = card.querySelector('.task-timer, .status-timer')?.textContent || '';
    return parseTimeTrackerElapsedMs(timerText);
  }

  function isGeneralPoolIdentifier(poolIdentifier) {
    const normalizedPoolIdentifier = normalizeTaskIdentityPart(poolIdentifier);
    return GENERAL_POOL_PREFIXES.some((prefix) => normalizedPoolIdentifier.startsWith(prefix));
  }

  function getTaskOverdueBlinkElapsedMs(entry) {
    if (!state.taskHighlightSettings?.overdueBlinkEnabled) {
      return null;
    }

    if (!isGeneralPoolIdentifier(entry?.poolIdentifier)) {
      return null;
    }

    const elapsedMs = entry?.elapsedMs;
    // TimeTracker shows new tasks as a countdown from 10:00 to 00:00.
    // After expiration it switches to 10:00+ and starts counting up,
    // so strict "greater than" avoids treating a brand-new 10:00 task as overdue.
    if (!Number.isFinite(elapsedMs) || elapsedMs <= TASK_OVERDUE_THRESHOLD_MS) {
      return null;
    }

    const cycleElapsed = (elapsedMs - TASK_OVERDUE_THRESHOLD_MS) % TASK_OVERDUE_BLINK_CYCLE_MS;
    if (cycleElapsed >= TASK_OVERDUE_BLINK_ACTIVE_MS) {
      return null;
    }

    return cycleElapsed;
  }

  function captureTimeTrackerTaskSnapshot(root, options = {}) {
    if (!(root instanceof Element)) {
      return [];
    }

    const applyDomMetadata = options.applyDomMetadata === true;

    const sections = Array.from(root.children).filter(
      (child) => child instanceof Element && child.classList.contains('pool-section')
    );

    const snapshot = [];

    sections.forEach((section, poolIndex) => {
      const poolIdentifier = getTimeTrackerPoolIdentifier(section, poolIndex);
      const cards = Array.from(section.querySelectorAll('.task-card'));

      cards.forEach((card, cardIndex) => {
        const key = getTimeTrackerTaskKey(card, poolIdentifier, cardIndex);
        if (applyDomMetadata && card instanceof HTMLElement) {
          card.dataset.pipxTaskKey = key;
          card.dataset.pipxPoolIndex = String(poolIndex);
          card.dataset.pipxCardIndex = String(cardIndex);
        }
        snapshot.push({
          key,
          element: card,
          poolIdentifier,
          elapsedMs: getTimeTrackerTaskElapsedMs(card)
        });
      });
    });

    return snapshot;
  }

  function getNewTaskHighlightKeys(previousSnapshot, nextSnapshot) {
    const previousKeys = new Set(previousSnapshot.map((entry) => entry.key));
    const nextKeys = new Set();

    nextSnapshot.forEach((entry) => {
      if (!previousKeys.has(entry.key)) {
        nextKeys.add(entry.key);
      }
    });

    return nextKeys;
  }

  function clearTaskHighlightCleanupTimer() {
    if (state.taskHighlightCleanupTimer) {
      clearTimeout(state.taskHighlightCleanupTimer);
      state.taskHighlightCleanupTimer = null;
    }
  }

  function resetTaskHighlights() {
    clearTaskHighlightCleanupTimer();
    state.taskHighlightExpirations.clear();
  }

  function pruneExpiredTaskHighlights(now = Date.now()) {
    for (const [taskKey, expiresAt] of state.taskHighlightExpirations.entries()) {
      if (expiresAt <= now) {
        state.taskHighlightExpirations.delete(taskKey);
      }
    }
  }

  function getActiveTaskHighlightKeys(now = Date.now()) {
    pruneExpiredTaskHighlights(now);
    return new Set(state.taskHighlightExpirations.keys());
  }

  function applyTaskHighlightsFromSnapshot(snapshot, activeKeys, now = Date.now()) {
    snapshot.forEach((entry) => {
      const { key, element } = entry;
      const isActive = activeKeys.has(key);
      const overdueBlinkElapsed = getTaskOverdueBlinkElapsedMs(entry);
      const isOverdueBlinkActive = Number.isFinite(overdueBlinkElapsed);

      element.classList.toggle(TASK_HIGHLIGHT_CLASS, isActive);
      element.classList.toggle(TASK_OVERDUE_BLINK_CLASS, isOverdueBlinkActive);

      if (isActive) {
        const expiresAt = state.taskHighlightExpirations.get(key) ?? now;
        const elapsed = Math.max(0, TASK_HIGHLIGHT_DURATION_MS - Math.max(0, expiresAt - now));
        const pulseElapsed = Math.min(elapsed, TASK_HIGHLIGHT_PULSE_DURATION_MS);
        element.style.setProperty('--pipx-task-flash-delay', `${-pulseElapsed}ms`);
      } else {
        element.style.removeProperty('--pipx-task-flash-delay');
      }

      if (isOverdueBlinkActive) {
        element.style.setProperty('--pipx-task-overdue-delay', `${-overdueBlinkElapsed}ms`);
      } else {
        element.style.removeProperty('--pipx-task-overdue-delay');
      }
    });
  }

  function refreshTaskHighlights() {
    const mirroredElement = state.mirroredElement;
    if (!isTimeTrackerMirrorRoot(mirroredElement)) {
      return;
    }

    const now = Date.now();
    const snapshot = captureTimeTrackerTaskSnapshot(mirroredElement, { applyDomMetadata: true });
    const activeKeys = state.taskHighlightSettings?.enabled ? getActiveTaskHighlightKeys(now) : new Set();
    applyTaskHighlightsFromSnapshot(snapshot, activeKeys, now);
  }

  function scheduleTaskHighlightCleanup() {
    clearTaskHighlightCleanupTimer();

    if (state.taskHighlightExpirations.size === 0) {
      return;
    }

    let nextExpiry = Infinity;
    for (const expiresAt of state.taskHighlightExpirations.values()) {
      nextExpiry = Math.min(nextExpiry, expiresAt);
    }

    const delay = Math.max(0, nextExpiry - Date.now() + 16);
    state.taskHighlightCleanupTimer = setTimeout(() => {
      pruneExpiredTaskHighlights();
      refreshTaskHighlights();
      scheduleTaskHighlightCleanup();
    }, delay);
  }

  function registerTaskHighlights(taskKeys) {
    if (!state.taskHighlightSettings?.enabled) {
      return new Set();
    }

    if (!taskKeys || taskKeys.size === 0) {
      return getActiveTaskHighlightKeys();
    }

    const expiresAt = Date.now() + TASK_HIGHLIGHT_DURATION_MS;
    taskKeys.forEach((taskKey) => {
      state.taskHighlightExpirations.set(taskKey, expiresAt);
    });

    scheduleTaskHighlightCleanup();
    return getActiveTaskHighlightKeys();
  }

  function syncMirroredElement() {
    const sourceElement = state.selectedElement;
    const mirroredElement = state.mirroredElement;
    const pipWindow = state.pipWindow;

    if (!sourceElement || !mirroredElement || !pipWindow || pipWindow.closed) {
      return;
    }

    if (!sourceElement.isConnected) {
      logger.warn('Source element disconnected while PiP mirror is active');
      restore('mirror-source-disconnected');
      return;
    }

    const previousSnapshot = isTimeTrackerMirrorRoot(mirroredElement)
      ? captureTimeTrackerTaskSnapshot(mirroredElement, { applyDomMetadata: true })
      : [];
    const nextMirror = sourceElement.cloneNode(true);
    const nextSnapshot = isTimeTrackerMirrorRoot(nextMirror)
      ? captureTimeTrackerTaskSnapshot(nextMirror, { applyDomMetadata: true })
      : [];
    const now = Date.now();
    const newTaskKeys = getNewTaskHighlightKeys(previousSnapshot, nextSnapshot);
    const activeHighlightKeys = registerTaskHighlights(newTaskKeys);
    applyTaskHighlightsFromSnapshot(nextSnapshot, activeHighlightKeys, now);

    if (mirroredElement.isConnected) {
      mirroredElement.replaceWith(nextMirror);
    } else {
      pipWindow.document.body.appendChild(nextMirror);
    }
    state.mirroredElement = nextMirror;
    state.domMirrorMap = createDomMirrorMap(sourceElement, nextMirror);
  }

  function syncMirroredMutations(mutations) {
    const sourceElement = state.selectedElement;
    const mirroredElement = state.mirroredElement;
    const pipWindow = state.pipWindow;
    const mirrorMap = state.domMirrorMap;

    if (!sourceElement || !mirroredElement || !pipWindow || pipWindow.closed) {
      return;
    }

    if (!sourceElement.isConnected) {
      logger.warn('Source element disconnected while PiP mirror is active');
      restore('mirror-source-disconnected');
      return;
    }

    if (!(mirrorMap instanceof Map) || mirrorMap.get(sourceElement) !== mirroredElement) {
      syncMirroredElement();
      return;
    }

    const previousSnapshot = isTimeTrackerMirrorRoot(mirroredElement)
      ? captureTimeTrackerTaskSnapshot(mirroredElement, { applyDomMetadata: true })
      : [];

    let requiresFullSync = false;

    for (const mutation of mutations) {
      if (requiresFullSync) {
        break;
      }

      if (mutation.type === 'childList') {
        const mirroredTarget = mirrorMap.get(mutation.target);
        if (!(mirroredTarget instanceof Node)) {
          requiresFullSync = true;
          break;
        }

        mutation.removedNodes.forEach((node) => {
          const mirroredNode = mirrorMap.get(node);
          if (mirroredNode instanceof Node) {
            mirroredNode.remove();
          }
          unregisterDomMirrorSubtree(node, mirrorMap);
        });

        mutation.addedNodes.forEach((node) => {
          const nextSiblingClone = mutation.nextSibling ? mirrorMap.get(mutation.nextSibling) : null;
          const mirroredNode = node.cloneNode(true);
          registerDomMirrorSubtree(node, mirroredNode, mirrorMap);
          mirroredTarget.insertBefore(mirroredNode, nextSiblingClone instanceof Node ? nextSiblingClone : null);
        });
      } else if (mutation.type === 'attributes') {
        if (!(mutation.target instanceof Element) || !mutation.attributeName) {
          continue;
        }

        const mirroredNode = mirrorMap.get(mutation.target);
        if (!(mirroredNode instanceof Element)) {
          requiresFullSync = true;
          break;
        }

        const value = mutation.target.getAttribute(mutation.attributeName);
        if (value === null) {
          mirroredNode.removeAttribute(mutation.attributeName);
        } else {
          mirroredNode.setAttribute(mutation.attributeName, value);
        }
      } else if (mutation.type === 'characterData') {
        const mirroredNode = mirrorMap.get(mutation.target);
        if (!(mirroredNode instanceof Node)) {
          requiresFullSync = true;
          break;
        }

        mirroredNode.textContent = mutation.target.textContent;
      }
    }

    if (requiresFullSync) {
      syncMirroredElement();
      return;
    }

    const now = Date.now();
    const nextSnapshot = isTimeTrackerMirrorRoot(mirroredElement)
      ? captureTimeTrackerTaskSnapshot(mirroredElement, { applyDomMetadata: true })
      : [];
    const newTaskKeys = getNewTaskHighlightKeys(previousSnapshot, nextSnapshot);
    const activeHighlightKeys = registerTaskHighlights(newTaskKeys);
    applyTaskHighlightsFromSnapshot(nextSnapshot, activeHighlightKeys, now);
  }

  function attachMirrorObserver(element) {
    disconnectMirrorObserver();
    if (!element) return;

    let syncQueued = false;
    let pendingMutations = [];
    const scheduleSync = (mutations = []) => {
      if (mutations.length > 0) {
        pendingMutations = pendingMutations.concat(mutations);
      }

      if (syncQueued) return;
      syncQueued = true;

      const activeWindow = state.pipWindow && !state.pipWindow.closed
        ? state.pipWindow
        : window;
      const requestFrame = typeof activeWindow?.requestAnimationFrame === 'function'
        ? activeWindow.requestAnimationFrame.bind(activeWindow)
        : null;

      if (requestFrame) {
        requestFrame(() => {
          syncQueued = false;
          const nextBatch = pendingMutations;
          pendingMutations = [];
          if (nextBatch.length > 0) {
            syncMirroredMutations(nextBatch);
          } else {
            syncMirroredElement();
          }
        });
        return;
      }

      queueMicrotask(() => {
        syncQueued = false;
        const nextBatch = pendingMutations;
        pendingMutations = [];
        if (nextBatch.length > 0) {
          syncMirroredMutations(nextBatch);
        } else {
          syncMirroredElement();
        }
      });
    };

    const observer = new MutationObserver((mutations) => {
      scheduleSync(mutations);
    });
    observer.observe(element, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true
    });

    state.mirrorObserver = observer;
  }

  function disconnectMirrorObserver() {
    if (state.mirrorObserver) {
      state.mirrorObserver.disconnect();
      state.mirrorObserver = null;
    }
  }

  function preparePipWindow(pipWindow, fragment, backgroundColor, htmlAttributes, bodyAttributes, siteRule) {
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
    applyTaskHighlightTheme(pipDoc);
    injectPipStyles(pipDoc, siteRule);

    pipDoc.body.appendChild(fragment);
    attachPipInteractions(pipWindow, siteRule);
  }

  function attachPipInteractions(pipWindow, siteRule) {
    if (siteRule?.pipStyleProfile !== 'daolog-time-tracker-compact') {
      return;
    }

    const pipDoc = pipWindow.document;
    if (pipDoc.body.dataset.pipxTaskLinksBound === 'true') {
      return;
    }

    pipDoc.body.dataset.pipxTaskLinksBound = 'true';
    pipDoc.addEventListener('click', (event) => {
      const interactionTarget = event.target instanceof Element ? event.target : null;
      if (!(interactionTarget instanceof Element)) {
        return;
      }

      const link = interactionTarget.closest('.tasks-page .task-link-btn[href]');

      if (!(link instanceof HTMLAnchorElement)) {
        const proxiedControl = interactionTarget.closest(
          '.tasks-page .ask-help-btn, .tasks-page .no-help-btn, .tasks-page .notification-close, .tasks-page .notification-btn.ok, .tasks-page .notification-btn.no-help'
        );

        if (!(proxiedControl instanceof Element)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const sourceControl = resolveTimeTrackerSourceControl(proxiedControl);
        if (!sourceControl) {
          logger.warn('Unable to resolve source control for PiP interaction', {
            classes: proxiedControl.className
          });
          return;
        }

        const clicked = proxyClickToSourceControl(sourceControl);
        if (!clicked) {
          logger.debug('Skipped PiP proxy click for disabled or unsupported control', {
            classes: proxiedControl.className
          });
        }
        return;
      }

      const href = link.href?.trim();
      if (!href) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      try {
        const openedWindow = window.open(href, link.target || '_blank', 'noopener,noreferrer');
        openedWindow?.focus?.();
      } catch (error) {
        logger.warn('Failed to open task link from PiP window', { href, error });
      }
    }, true);
  }

  function injectPipStyles(pipDoc, siteRule) {
    const style = pipDoc.createElement('style');
    style.id = 'pipx-style';
    style.textContent = `
:root {
  color-scheme: ${document.documentElement?.style?.colorScheme || 'auto'};
  --pipx-task-highlight-fill: #2fd212;
  --pipx-task-highlight-text: #050505;
  --pipx-task-highlight-rgb: 47 210 18;
  --pipx-task-overdue-rgb: 239 68 68;
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
${getSiteSpecificPipStyles(siteRule)}
`;
    pipDoc.head.appendChild(style);
  }

  function getSiteSpecificPipStyles(siteRule) {
    if (siteRule?.pipStyleProfile !== 'daolog-time-tracker-compact') {
      return '';
    }

    return `

/* TimeTracker compact profile for PiP */
.tasks-page {
  gap: 4px !important;
  padding: 8px !important;
}

.tasks-page .pool-section {
  padding: 8px !important;
  margin-bottom: 0 !important;
  border-radius: 8px !important;
}

.tasks-page .pool-section:last-child {
  margin-bottom: 0 !important;
}

.tasks-page .pool-header {
  display: none !important;
}

.tasks-page .pool-header-left {
  display: none !important;
}

.tasks-page .pool-title,
.tasks-page .pool-title-m {
  gap: 6px !important;
  line-height: 1.15 !important;
}

.tasks-page .task-count,
.tasks-page .task-count-m,
.tasks-page .server-count {
  line-height: 1.1 !important;
}

.tasks-page .pool-section .tasks-list {
  display: flex !important;
  flex-direction: column !important;
  gap: 4px !important;
}

.tasks-page .task-card {
  margin: 0 !important;
  border-radius: 6px !important;
  position: relative !important;
  overflow: visible !important;
  transform-origin: center center !important;
  transition: box-shadow 0.2s ease, transform 0.2s ease !important;
}

.tasks-page .task-card.${TASK_HIGHLIGHT_CLASS} {
  animation: pipx-task-flash-pulse ${TASK_HIGHLIGHT_PULSE_DURATION_MS}ms ease-out 1 both !important;
  animation-delay: var(--pipx-task-flash-delay, 0ms) !important;
  will-change: transform, box-shadow;
  z-index: 4 !important;
  background-color: var(--pipx-task-highlight-fill) !important;
  color: var(--pipx-task-highlight-text) !important;
}

.tasks-page .task-card.${TASK_HIGHLIGHT_CLASS} .task-name,
.tasks-page .task-card.${TASK_HIGHLIGHT_CLASS} .task-info,
.tasks-page .task-card.${TASK_HIGHLIGHT_CLASS} .task-timer,
.tasks-page .task-card.${TASK_HIGHLIGHT_CLASS} .status-timer,
.tasks-page .task-card.${TASK_HIGHLIGHT_CLASS} .task-link-btn,
.tasks-page .task-card.${TASK_HIGHLIGHT_CLASS} a,
.tasks-page .task-card.${TASK_HIGHLIGHT_CLASS} span,
.tasks-page .task-card.${TASK_HIGHLIGHT_CLASS} div {
  color: var(--pipx-task-highlight-text) !important;
}

.tasks-page .task-card.${TASK_OVERDUE_BLINK_CLASS} {
  animation: pipx-task-overdue-pulse ${TASK_HIGHLIGHT_PULSE_DURATION_MS}ms ease-out 2 both !important;
  animation-delay: var(--pipx-task-overdue-delay, 0ms) !important;
  will-change: transform, box-shadow;
  z-index: 4 !important;
}

@keyframes pipx-task-flash-pulse {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0) !important;
  }
  10% {
    transform: scale(1.03);
    box-shadow: 0 0 0 3px rgb(var(--pipx-task-highlight-rgb) / 0.92), 0 0 10px 4px rgb(var(--pipx-task-highlight-rgb) / 0.72), 0 0 18px 8px rgb(var(--pipx-task-highlight-rgb) / 0.34) !important;
  }
  20% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0) !important;
  }
  30% {
    transform: scale(1.045);
    box-shadow: 0 0 0 3px rgb(var(--pipx-task-highlight-rgb) / 0.96), 0 0 12px 4px rgb(var(--pipx-task-highlight-rgb) / 0.8), 0 0 20px 9px rgb(var(--pipx-task-highlight-rgb) / 0.4) !important;
  }
  40% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0) !important;
  }
  50% {
    transform: scale(1.055);
    box-shadow: 0 0 0 3px rgb(var(--pipx-task-highlight-rgb) / 0.98), 0 0 14px 5px rgb(var(--pipx-task-highlight-rgb) / 0.84), 0 0 22px 10px rgb(var(--pipx-task-highlight-rgb) / 0.44) !important;
  }
  60% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0) !important;
  }
  70% {
    transform: scale(1.065);
    box-shadow: 0 0 0 3px rgb(var(--pipx-task-highlight-rgb) / 1), 0 0 15px 5px rgb(var(--pipx-task-highlight-rgb) / 0.88), 0 0 24px 10px rgb(var(--pipx-task-highlight-rgb) / 0.5) !important;
  }
  80% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0) !important;
  }
  90% {
    transform: scale(1.075);
    box-shadow: 0 0 0 3px rgb(var(--pipx-task-highlight-rgb) / 1), 0 0 16px 6px rgb(var(--pipx-task-highlight-rgb) / 0.94), 0 0 26px 10px rgb(var(--pipx-task-highlight-rgb) / 0.56) !important;
  }
  96% {
    transform: scale(1);
    box-shadow: 0 0 0 1px rgb(var(--pipx-task-highlight-rgb) / 0.18), 0 0 5px 1px rgb(var(--pipx-task-highlight-rgb) / 0.12) !important;
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0) !important;
  }
}

@keyframes pipx-task-overdue-pulse {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgb(var(--pipx-task-overdue-rgb) / 0) !important;
  }
  10% {
    transform: scale(1.03);
    box-shadow: 0 0 0 3px rgb(var(--pipx-task-overdue-rgb) / 0.92), 0 0 10px 4px rgb(var(--pipx-task-overdue-rgb) / 0.72), 0 0 18px 8px rgb(var(--pipx-task-overdue-rgb) / 0.34) !important;
  }
  20% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgb(var(--pipx-task-overdue-rgb) / 0) !important;
  }
  30% {
    transform: scale(1.045);
    box-shadow: 0 0 0 3px rgb(var(--pipx-task-overdue-rgb) / 0.96), 0 0 12px 4px rgb(var(--pipx-task-overdue-rgb) / 0.8), 0 0 20px 9px rgb(var(--pipx-task-overdue-rgb) / 0.4) !important;
  }
  40% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgb(var(--pipx-task-overdue-rgb) / 0) !important;
  }
  50% {
    transform: scale(1.055);
    box-shadow: 0 0 0 3px rgb(var(--pipx-task-overdue-rgb) / 0.98), 0 0 14px 5px rgb(var(--pipx-task-overdue-rgb) / 0.84), 0 0 22px 10px rgb(var(--pipx-task-overdue-rgb) / 0.44) !important;
  }
  60% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgb(var(--pipx-task-overdue-rgb) / 0) !important;
  }
  70% {
    transform: scale(1.065);
    box-shadow: 0 0 0 3px rgb(var(--pipx-task-overdue-rgb) / 1), 0 0 15px 5px rgb(var(--pipx-task-overdue-rgb) / 0.88), 0 0 24px 10px rgb(var(--pipx-task-overdue-rgb) / 0.5) !important;
  }
  80% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgb(var(--pipx-task-overdue-rgb) / 0) !important;
  }
  90% {
    transform: scale(1.075);
    box-shadow: 0 0 0 3px rgb(var(--pipx-task-overdue-rgb) / 1), 0 0 16px 6px rgb(var(--pipx-task-overdue-rgb) / 0.94), 0 0 26px 10px rgb(var(--pipx-task-overdue-rgb) / 0.56) !important;
  }
  96% {
    transform: scale(1);
    box-shadow: 0 0 0 1px rgb(var(--pipx-task-overdue-rgb) / 0.18), 0 0 5px 1px rgb(var(--pipx-task-overdue-rgb) / 0.12) !important;
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgb(var(--pipx-task-overdue-rgb) / 0) !important;
  }
}

.tasks-page .task-content {
  align-items: center !important;
  gap: 6px !important;
  padding: 6px 8px !important;
  position: relative !important;
}

.tasks-page .task-info {
  gap: 2px !important;
  min-width: 0 !important;
  flex: 1 1 auto !important;
}

.tasks-page .task-name {
  font-size: 13px !important;
  line-height: 1.25 !important;
}

.tasks-page .task-actions {
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  position: absolute !important;
  top: 50% !important;
  right: 8px !important;
  transform: translateY(-50%) !important;
  z-index: 2 !important;
}

.tasks-page .task-link-btn {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 28px !important;
  height: 28px !important;
  border-radius: 999px !important;
  flex-shrink: 0 !important;
  background-color: rgba(26, 35, 50, 0.92) !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transform: none !important;
  transition: none !important;
}

.tasks-page .task-card .ask-help-btn,
.tasks-page .task-card .no-help-btn {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  position: absolute !important;
  top: 50% !important;
  z-index: 2 !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transform: translateY(-50%) !important;
  transition: none !important;
}

.tasks-page .task-card .ask-help-btn {
  right: 42px !important;
}

.tasks-page .task-card .no-help-btn {
  right: 76px !important;
}

.tasks-page .task-card:hover .task-link-btn,
.tasks-page .task-card:focus-within .task-link-btn {
  opacity: 1 !important;
  pointer-events: auto !important;
  transform: none !important;
}

.tasks-page .task-card:hover .ask-help-btn,
.tasks-page .task-card:hover .no-help-btn,
.tasks-page .task-card:focus-within .ask-help-btn,
.tasks-page .task-card:focus-within .no-help-btn,
.tasks-page .task-content:hover .ask-help-btn,
.tasks-page .task-content:hover .no-help-btn {
  opacity: 1 !important;
  pointer-events: auto !important;
  transform: translateY(-50%) !important;
}

.tasks-page .task-card:hover .ask-help-btn:disabled,
.tasks-page .task-card:hover .no-help-btn:disabled,
.tasks-page .task-card:focus-within .ask-help-btn:disabled,
.tasks-page .task-card:focus-within .no-help-btn:disabled,
.tasks-page .task-content:hover .ask-help-btn:disabled,
.tasks-page .task-content:hover .no-help-btn:disabled {
  opacity: 0.45 !important;
  pointer-events: none !important;
}

.tasks-page .task-card:hover .task-info,
.tasks-page .task-card:focus-within .task-info {
  padding-right: 112px !important;
}

.tasks-page .notification-overlay,
.tasks-page .notification-popup,
.tasks-page .notification-close,
.tasks-page .notification-btn {
  pointer-events: auto !important;
}

.tasks-page .pip-toggle-btn,
.tasks-page .reverse-timer-btn,
.tasks-page .collapse-btn {
  display: none !important;
}

.tasks-page .task-timer,
.tasks-page .status-timer {
  min-height: 24px !important;
  height: auto !important;
  padding: 2px 6px !important;
  font-size: 11px !important;
  line-height: 1.1 !important;
}

.tasks-page .no-tasks {
  padding: 8px 0 !important;
}

@media (max-width: 420px) {
  .tasks-page {
    gap: 4px !important;
    padding: 6px !important;
  }

  .tasks-page .pool-section {
    padding: 6px !important;
    margin-bottom: 0 !important;
  }

  .tasks-page .pool-title,
  .tasks-page .pool-title-m {
    font-size: 14px !important;
  }

  .tasks-page .task-count,
  .tasks-page .task-count-m,
  .tasks-page .server-count {
    font-size: 12px !important;
  }

  .tasks-page .pool-section .tasks-list {
    gap: 3px !important;
  }

  .tasks-page .task-content {
    gap: 5px !important;
    padding: 5px 6px !important;
  }

  .tasks-page .task-name {
    font-size: 12px !important;
    line-height: 1.2 !important;
  }

  .tasks-page .task-timer,
  .tasks-page .status-timer {
    min-height: 20px !important;
    padding: 1px 5px !important;
    font-size: 10px !important;
  }
}

@media (max-width: 340px) {
  .tasks-page {
    gap: 4px !important;
    padding: 4px !important;
  }

  .tasks-page .pool-section {
    padding: 4px !important;
  }

  .tasks-page .pool-section .tasks-list {
    gap: 2px !important;
  }

  .tasks-page .task-content {
    gap: 4px !important;
    padding: 4px 5px !important;
  }

  .tasks-page .task-name {
    font-size: 11px !important;
    line-height: 1.15 !important;
  }
}
`;
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
    disconnectMirrorObserver();
    disconnectTaskHighlightSettingsObserver();
    resetTaskHighlights();
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
    if (state.domMirrorMap) {
      state.domMirrorMap.clear();
      state.domMirrorMap = null;
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