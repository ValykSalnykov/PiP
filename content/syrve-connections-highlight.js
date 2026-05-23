(() => {
  const CONNECTIONS_PATH = '/resto/service/monitoring/connections.jsp';
  const LAST_ACTIVITY_HEADER = 'last activity';
  const STALE_THRESHOLD_MS = 20 * 1000;
  const REFRESH_INTERVAL_MS = 60 * 1000;
  const STYLE_ID = 'dao-tools-connections-highlight-style';
  const STALE_ROW_CLASS = 'dao-tools-connections-row--stale';
  const STALE_CELL_CLASS = 'dao-tools-connections-cell--stale';
  const HIGHLIGHTED_ATTR = 'data-dao-tools-stale-license';
  const ACTION_BAR_ID = 'dao-tools-stale-license-action-bar';
  const ACTION_BUTTON_ID = 'dao-tools-stale-license-helpdesk-button';
  const ACTION_STATUS_ID = 'dao-tools-stale-license-helpdesk-status';
  const CONTEXT_RETRY_LIMIT = 8;
  const CONTEXT_RETRY_DELAY_MS = 1000;
  const ACTION_REMOVE_DELAY_MS = 2500;
  const STALE_LICENSE_CACHE_TTL_MS = 5000;
  const COLUMN_LABELS = {
    ipAddress: 'ip address',
    computerName: 'computer name',
    terminalName: 'terminal name',
    login: 'login',
    moduleId: 'module id',
    moduleName: 'module name',
    moduleDisplayName: 'module display name',
    lastActivity: LAST_ACTIVITY_HEADER
  };
  let hasHelpDeskContext = false;
  let contextRequestPromise = null;
  let contextRetryCount = 0;
  let activeStaleLicenseRequestId = '';
  let activeHelpDeskRequestId = '';
  let actionRemoveTimerId = null;
  let lastStaleLicenses = [];
  let lastStaleSeenAt = 0;

  if (window.location.pathname !== CONNECTIONS_PATH) {
    return;
  }

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const ensureStyles = () => {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      tr.${STALE_ROW_CLASS} {
        background: #fff1f2 !important;
        box-shadow: inset 0 -3px 0 #dc2626, inset 4px 0 0 #dc2626 !important;
      }

      tr.${STALE_ROW_CLASS} > td {
        border-bottom: 2px solid #dc2626 !important;
      }

      td.${STALE_CELL_CLASS} {
        color: #991b1b !important;
        font-weight: 700 !important;
        text-decoration: underline !important;
        text-decoration-color: #dc2626 !important;
        text-decoration-thickness: 2px !important;
        text-underline-offset: 3px !important;
      }

      #${ACTION_BAR_ID} {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        position: fixed;
        z-index: 2147483647;
        width: 220px;
        margin: 0;
        padding: 10px 12px;
        background: #fff7ed;
        border: 1px solid #fed7aa;
        border-radius: 6px;
        color: #7c2d12;
        font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      }

      #${ACTION_BUTTON_ID} {
        width: 100%;
        border: 0;
        border-radius: 4px;
        padding: 6px 12px;
        background: #ea580c;
        color: #fff;
        cursor: pointer;
        font: 700 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      }

      #${ACTION_BUTTON_ID}:hover:not(:disabled) {
        background: #c2410c;
      }

      #${ACTION_BUTTON_ID}:disabled {
        cursor: default;
        opacity: 0.62;
      }

      #${ACTION_STATUS_ID} {
        display: block;
        width: 100%;
        color: #7c2d12;
        overflow-wrap: anywhere;
      }

      @media (max-width: 900px) {
        #${ACTION_BAR_ID} {
          left: auto !important;
          right: 8px !important;
          top: 8px !important;
          width: min(220px, calc(100vw - 16px));
        }
      }
    `;

    document.head.appendChild(style);
  };

  const sendRuntimeMessage = (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || 'Помилка обробки запиту.'));
        return;
      }

      resolve(response);
    });
  });

  const parseLastActivityTime = (value) => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      return null;
    }

    const parsedTime = Date.parse(normalizedValue);
    return Number.isFinite(parsedTime) ? parsedTime : null;
  };

  const formatStaleTitle = (ageMs) => {
    const totalSeconds = Math.max(0, Math.floor(ageMs / 1000));
    if (totalSeconds < 60) {
      return `Last activity відстає на ${totalSeconds} сек.`;
    }

    const totalMinutes = Math.max(0, Math.floor(ageMs / (60 * 1000)));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours <= 0) {
      return `Last activity відстає на ${minutes} хв.`;
    }

    return `Last activity відстає на ${hours} год. ${minutes} хв.`;
  };

  const findLastActivityColumn = (table) => {
    const rows = Array.from(table.querySelectorAll('tr'));
    for (const row of rows) {
      const cells = Array.from(row.children).filter((cell) => cell instanceof HTMLTableCellElement);
      const columnIndex = cells.findIndex((cell) => normalizeText(cell.textContent).toLowerCase() === LAST_ACTIVITY_HEADER);
      if (columnIndex !== -1) {
        return { headerRow: row, columnIndex };
      }
    }

    return null;
  };

  const buildColumnMap = (headerRow) => {
    const map = {};
    const cells = Array.from(headerRow.children).filter((cell) => cell instanceof HTMLTableCellElement);
    cells.forEach((cell, index) => {
      const normalizedHeader = normalizeText(cell.textContent).toLowerCase();
      Object.entries(COLUMN_LABELS).forEach(([key, label]) => {
        if (normalizedHeader === label) {
          map[key] = index;
        }
      });
    });
    return map;
  };

  const getCellText = (cells, index) => {
    if (!Number.isInteger(index) || !cells[index]) {
      return '';
    }

    return normalizeText(cells[index].textContent);
  };

  const formatAgeLabel = (lastActivity) => {
    const lastActivityTime = parseLastActivityTime(lastActivity);
    if (lastActivityTime === null) {
      return '';
    }

    const ageMs = Math.max(0, Date.now() - lastActivityTime);
    const totalSeconds = Math.floor(ageMs / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds} сек.`;
    }

    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) {
      return `${minutes} хв.`;
    }

    return `${hours} год. ${minutes} хв.`;
  };

  const clearStaleRow = (row) => {
    row.classList.remove(STALE_ROW_CLASS);
    row.removeAttribute(HIGHLIGHTED_ATTR);
    delete row.dataset.daoToolsStaleLicenseAgeMinutes;
    delete row.dataset.daoToolsStaleLicenseAgeSeconds;
    if (row.dataset.daoToolsOriginalTitle !== undefined) {
      row.title = row.dataset.daoToolsOriginalTitle;
      delete row.dataset.daoToolsOriginalTitle;
    }

    row.querySelectorAll(`td.${STALE_CELL_CLASS}`).forEach((cell) => {
      cell.classList.remove(STALE_CELL_CLASS);
    });
  };

  const markStaleRow = (row, activityCell, ageMs) => {
    const ageMinutes = String(Math.floor(ageMs / (60 * 1000)));
    row.classList.add(STALE_ROW_CLASS);
    row.setAttribute(HIGHLIGHTED_ATTR, 'true');
    row.dataset.daoToolsStaleLicenseAgeMinutes = ageMinutes;
    row.dataset.daoToolsStaleLicenseAgeSeconds = String(Math.floor(ageMs / 1000));

    if (row.dataset.daoToolsOriginalTitle === undefined) {
      row.dataset.daoToolsOriginalTitle = row.getAttribute('title') || '';
    }

    row.title = formatStaleTitle(ageMs);
    row.querySelectorAll(`td.${STALE_CELL_CLASS}`).forEach((cell) => {
      if (cell !== activityCell) {
        cell.classList.remove(STALE_CELL_CLASS);
      }
    });
    activityCell.classList.add(STALE_CELL_CLASS);
  };

  const highlightStaleConnections = () => {
    ensureStyles();

    const now = Date.now();
    document.querySelectorAll('table').forEach((table) => {
      const columnInfo = findLastActivityColumn(table);
      if (!columnInfo) {
        return;
      }

      Array.from(table.querySelectorAll('tr')).forEach((row) => {
        if (row === columnInfo.headerRow) {
          return;
        }

        const cells = Array.from(row.children).filter((cell) => cell instanceof HTMLTableCellElement);
        const activityCell = cells[columnInfo.columnIndex];
        if (!activityCell) {
          clearStaleRow(row);
          return;
        }

        const lastActivityTime = parseLastActivityTime(activityCell.textContent);
        if (lastActivityTime === null) {
          clearStaleRow(row);
          return;
        }

        const ageMs = now - lastActivityTime;
        if (ageMs >= STALE_THRESHOLD_MS) {
          markStaleRow(row, activityCell, ageMs);
        } else {
          clearStaleRow(row);
        }
      });
    });

    renderHelpDeskActionBar();
  };

  const collectStaleLicenses = () => {
    const result = [];
    document.querySelectorAll('table').forEach((table) => {
      const columnInfo = findLastActivityColumn(table);
      if (!columnInfo) {
        return;
      }

      const columnMap = buildColumnMap(columnInfo.headerRow);
      Array.from(table.querySelectorAll(`tr[${HIGHLIGHTED_ATTR}="true"]`)).forEach((row) => {
        const cells = Array.from(row.children).filter((cell) => cell instanceof HTMLTableCellElement);
        const lastActivity = getCellText(cells, columnMap.lastActivity);
        result.push({
          ipAddress: getCellText(cells, columnMap.ipAddress),
          computerName: getCellText(cells, columnMap.computerName),
          terminalName: getCellText(cells, columnMap.terminalName),
          login: getCellText(cells, columnMap.login),
          moduleId: getCellText(cells, columnMap.moduleId),
          moduleName: getCellText(cells, columnMap.moduleName),
          moduleDisplayName: getCellText(cells, columnMap.moduleDisplayName),
          lastActivity,
          ageLabel: formatAgeLabel(lastActivity)
        });
      });
    });
    return result;
  };

  const getAvailableStaleLicenses = () => {
    const staleLicenses = collectStaleLicenses();
    if (staleLicenses.length > 0) {
      return staleLicenses;
    }

    return Date.now() - lastStaleSeenAt < STALE_LICENSE_CACHE_TTL_MS ? lastStaleLicenses : [];
  };

  const setActionStatus = (message, isError = false) => {
    const statusNode = document.getElementById(ACTION_STATUS_ID);
    if (!statusNode) {
      return;
    }

    statusNode.textContent = message || '';
    statusNode.style.color = isError ? '#991b1b' : '#7c2d12';
  };

  const setActionButtonBusy = (isBusy, label = 'Готуємо...') => {
    const button = document.getElementById(ACTION_BUTTON_ID);
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent || 'Створити заявку';
    }

    button.disabled = isBusy;
    button.textContent = isBusy ? label : button.dataset.defaultLabel;
  };

  const removeHelpDeskActionBar = () => {
    document.getElementById(ACTION_BAR_ID)?.remove();
  };

  const scheduleRemoveHelpDeskActionBar = () => {
    if (activeStaleLicenseRequestId || activeHelpDeskRequestId || actionRemoveTimerId !== null) {
      return;
    }

    actionRemoveTimerId = window.setTimeout(() => {
      actionRemoveTimerId = null;
      if (!activeStaleLicenseRequestId && !activeHelpDeskRequestId && collectStaleLicenses().length === 0) {
        removeHelpDeskActionBar();
      }
    }, ACTION_REMOVE_DELAY_MS);
  };

  const cancelScheduledActionBarRemoval = () => {
    if (actionRemoveTimerId === null) {
      return;
    }

    window.clearTimeout(actionRemoveTimerId);
    actionRemoveTimerId = null;
  };

  const updateHelpDeskActionBarPosition = () => {
    const actionBar = document.getElementById(ACTION_BAR_ID);
    const firstTable = document.querySelector('table');
    if (!(actionBar instanceof HTMLElement) || !(firstTable instanceof HTMLTableElement)) {
      return;
    }

    const tableRect = firstTable.getBoundingClientRect();
    const actionWidth = actionBar.offsetWidth || 244;
    const gap = 12;
    const top = Math.max(8, Math.min(tableRect.top, window.innerHeight - actionBar.offsetHeight - 8));
    const rightSpace = window.innerWidth - tableRect.right;
    const left = rightSpace >= actionWidth + gap
      ? tableRect.right + gap
      : Math.max(8, window.innerWidth - actionWidth - 8);

    actionBar.style.top = `${top}px`;
    actionBar.style.left = `${left}px`;
    actionBar.style.right = 'auto';
  };

  const createHelpDeskActionBar = () => {
    if (!document.body) {
      return null;
    }

    const actionBar = document.createElement('aside');
    actionBar.id = ACTION_BAR_ID;

    const button = document.createElement('button');
    button.id = ACTION_BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Створити заявку';
    button.addEventListener('click', handleCreateHelpDeskDraft);

    const status = document.createElement('span');
    status.id = ACTION_STATUS_ID;
    status.textContent = 'Є завислі ліцензії.';

    actionBar.appendChild(button);
    actionBar.appendChild(status);
    document.body.appendChild(actionBar);
    updateHelpDeskActionBarPosition();
    return actionBar;
  };

  const renderHelpDeskActionBar = () => {
    const staleLicenses = collectStaleLicenses();
    if (staleLicenses.length > 0) {
      lastStaleLicenses = staleLicenses;
      lastStaleSeenAt = Date.now();
    }

    const shouldShow = hasHelpDeskContext && (
      staleLicenses.length > 0 ||
      activeStaleLicenseRequestId ||
      activeHelpDeskRequestId ||
      Date.now() - lastStaleSeenAt < ACTION_REMOVE_DELAY_MS
    );
    const existingActionBar = document.getElementById(ACTION_BAR_ID);

    if (!shouldShow) {
      scheduleRemoveHelpDeskActionBar();
      return;
    }

    cancelScheduledActionBarRemoval();
    const actionBar = existingActionBar || createHelpDeskActionBar();
    if (!actionBar) {
      return;
    }

    updateHelpDeskActionBarPosition();
    const button = document.getElementById(ACTION_BUTTON_ID);
    if (button instanceof HTMLButtonElement && !activeStaleLicenseRequestId && !activeHelpDeskRequestId) {
      button.disabled = false;
      button.textContent = button.dataset.defaultLabel || 'Створити заявку';
    }
  };

  const refreshHelpDeskContext = async () => {
    if (contextRequestPromise) {
      return contextRequestPromise;
    }

    contextRequestPromise = sendRuntimeMessage({
      action: 'GET_CONNECTIONS_HELPDESK_CONTEXT'
    })
      .then((response) => {
        hasHelpDeskContext = response.available === true;
        renderHelpDeskActionBar();

        if (!hasHelpDeskContext && contextRetryCount < CONTEXT_RETRY_LIMIT) {
          contextRetryCount += 1;
          window.setTimeout(() => {
            void refreshHelpDeskContext();
          }, CONTEXT_RETRY_DELAY_MS);
        }
      })
      .catch(() => {
        hasHelpDeskContext = false;
        renderHelpDeskActionBar();
      })
      .finally(() => {
        contextRequestPromise = null;
      });

    return contextRequestPromise;
  };

  async function handleCreateHelpDeskDraft() {
    if (activeStaleLicenseRequestId || activeHelpDeskRequestId) {
      return;
    }

    const staleLicenses = getAvailableStaleLicenses();
    if (!staleLicenses.length) {
      setActionStatus('Завислі ліцензії не знайдено.', true);
      return;
    }

    setActionButtonBusy(true, 'Готуємо...');
    setActionStatus('Відкриваємо вибір екрана...');

    try {
      const response = await sendRuntimeMessage({
        action: 'CREATE_STALE_LICENSE_HELPDESK_DRAFT',
        sourceConnectionsUrl: window.location.href,
        staleLicenses
      });
      activeStaleLicenseRequestId = response.requestId || '';
      setActionStatus('Оберіть весь екран у вікні Chrome.');
      setActionButtonBusy(true, 'Очікуємо скріншот...');
    } catch (error) {
      activeStaleLicenseRequestId = '';
      activeHelpDeskRequestId = '';
      setActionButtonBusy(false);
      setActionStatus(error?.message || 'Не вдалося створити заявку.', true);
    }
  }

  const isCaptureReady = () => {
    highlightStaleConnections();
    return Boolean(document.querySelector('table')) && getAvailableStaleLicenses().length > 0;
  };

  const waitForCaptureReady = (timeoutMs = 4000) => new Promise((resolve, reject) => {
    if (isCaptureReady()) {
      resolve(true);
      return;
    }

    let intervalId = null;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Таблиця зайнятих ліцензій ще не готова до скріншота.'));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      checkReady();
    });

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      observer.disconnect();
    };

    const checkReady = () => {
      if (!isCaptureReady()) {
        return;
      }

      cleanup();
      resolve(true);
    };

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
    intervalId = window.setInterval(checkReady, 150);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === 'WAIT_STALE_LICENSE_CAPTURE_READY') {
      waitForCaptureReady(Number(message.timeoutMs) || 4000)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({
          ok: false,
          error: error?.message || 'Таблиця зайнятих ліцензій ще не готова до скріншота.'
        }));
      return true;
    }

    if (message?.action === 'STALE_LICENSE_HELPDESK_REQUEST_RESULT') {
      if (message.requestId && activeStaleLicenseRequestId && message.requestId !== activeStaleLicenseRequestId) {
        return;
      }

      activeStaleLicenseRequestId = '';
      if (message.ok === false) {
        activeHelpDeskRequestId = '';
        setActionButtonBusy(false);
        setActionStatus(message.error || 'Не вдалося створити заявку.', true);
        return;
      }

      activeHelpDeskRequestId = message.helpDeskRequestId || '';
      setActionStatus('Чернетку HelpDeskEddy відкрито, заповнюємо...');
      setActionButtonBusy(true, 'Заповнюємо...');
      return;
    }

    if (message?.action === 'HELPDESK_DRAFT_FILL_RESULT') {
      if (message.requestId && activeHelpDeskRequestId && message.requestId !== activeHelpDeskRequestId) {
        return;
      }

      activeHelpDeskRequestId = '';
      activeStaleLicenseRequestId = '';
      setActionButtonBusy(false);
      if (message.ok === false) {
        setActionStatus(message.error || 'Не вдалося заповнити чернетку HelpDeskEddy.', true);
        return;
      }

      setActionStatus('Чернетку HelpDeskEddy підготовлено.');
    }
  });

  const scheduleHighlight = (() => {
    let timerId = null;
    return () => {
      if (timerId !== null) {
        return;
      }

      timerId = window.setTimeout(() => {
        timerId = null;
        highlightStaleConnections();
      }, 100);
    };
  })();

  const shouldHandleMutations = (mutations) => {
    const actionBar = document.getElementById(ACTION_BAR_ID);
    return mutations.some((mutation) => {
      const target = mutation.target;
      return !(actionBar instanceof HTMLElement && target instanceof Node && actionBar.contains(target));
    });
  };

  const start = () => {
    highlightStaleConnections();
    void refreshHelpDeskContext();

    const observerRoot = document.body || document.documentElement;
    if (observerRoot) {
      const observer = new MutationObserver((mutations) => {
        if (shouldHandleMutations(mutations)) {
          scheduleHighlight();
        }
      });
      observer.observe(observerRoot, {
        childList: true,
        subtree: true
      });
    }

    window.addEventListener('scroll', updateHelpDeskActionBarPosition, { passive: true });
    window.addEventListener('resize', updateHelpDeskActionBarPosition);
    window.setInterval(highlightStaleConnections, REFRESH_INTERVAL_MS);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
