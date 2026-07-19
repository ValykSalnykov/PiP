(() => {
  const CONNECTIONS_PATH = '/resto/service/monitoring/connections.jsp';
  const LAST_ACTIVITY_HEADER = 'last activity';
  const STORAGE_KEYS = {
    staleLicenseThresholdMinutes: 'syrveConnectionsStaleLicenseThresholdMinutes'
  };
  const MS_PER_MINUTE = 60 * 1000;
  const DEFAULT_STALE_THRESHOLD_MINUTES =20;
  const MIN_STALE_THRESHOLD_MINUTES = 1;
  const MAX_STALE_THRESHOLD_MINUTES = 1440;
  const REFRESH_INTERVAL_MS = 60 * 1000;
  const STYLE_ID = 'dao-tools-connections-highlight-style';
  const LICENSE_SUMMARY_ID = 'dao-tools-license-summary';
  const LICENSE_SUMMARY_GROUPS_ID = 'dao-tools-license-summary-groups';
  const RESET_VERIFICATION_SESSION_KEY = 'daoToolsStaleLicenseResetVerification';
  const STALE_ROW_CLASS = 'dao-tools-connections-row--stale';
  const STALE_CELL_CLASS = 'dao-tools-connections-cell--stale';
  const HIGHLIGHTED_ATTR = 'data-dao-tools-stale-license';
  const ACTION_BAR_ID = 'dao-tools-stale-license-action-bar';
  const ACTION_BAR_INLINE_CLASS = 'dao-tools-stale-license-action-bar--inline';
  const ACTION_BUTTON_ID = 'dao-tools-stale-license-helpdesk-button';
  const ACTION_STATUS_ID = 'dao-tools-stale-license-helpdesk-status';
  const HELPDESK_ALLOWED_HOST_SUFFIX = '.syrve.online';
  const CONTEXT_RETRY_LIMIT = 8;
  const CONTEXT_RETRY_DELAY_MS = 1000;
  const ACTION_REMOVE_DELAY_MS = 2500;
  const STALE_LICENSE_CACHE_TTL_MS = 5000;
  const RESET_VERIFICATION_TTL_MS = 2 * 60 * 1000;
  const RESET_VERIFICATION_TIMEOUT_MS = 12000;
  const FRONT_OFFICE_LICENSE_MODULE_NAMES = new Set([
    'FRONT_OFFICE_FAST_FOOD',
    'FRONT_OFFICE_TABLE_SERVICE'
  ]);
  const PRIMARY_LICENSE_MODULE_PRIORITY = new Map([
    ['100', 0],
    ['101', 1],
    ['21011218', 2]
  ]);
  const PRIMARY_LICENSE_DISPLAY_PRIORITY = new Map([
    ['RMS (FRONT FAST FOOD)', 0],
    ['RMS (TABLESERVICE)', 1],
    ['CARD5 (FRONT)', 2]
  ]);
  const BACK_OFFICE_LICENSE_MODULE_NAMES = new Set([
    'BACK_OFFICE',
    'BACKOFFICE',
    'BACK_OFFICE_APP'
  ]);
  const ALLOWED_RELEASE_MODULE_CODES = new Set([100, 200]);
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
  let activeStaleLicenseResetRequestId = '';
  let actionRemoveTimerId = null;
  let lastStaleLicenses = [];
  let lastStaleSeenAt = 0;
  let resetFallbackEnabled = false;
  let pendingResetVerification = null;
  let staleThresholdMinutes = DEFAULT_STALE_THRESHOLD_MINUTES;

  if (window.location.pathname !== CONNECTIONS_PATH) {
    return;
  }

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const normalizeStaleThresholdMinutes = (value) => {
    const normalizedValue = Number(value);
    if (!Number.isFinite(normalizedValue)) {
      return DEFAULT_STALE_THRESHOLD_MINUTES;
    }

    const minutes = Math.floor(normalizedValue);
    return minutes >= MIN_STALE_THRESHOLD_MINUTES && minutes <= MAX_STALE_THRESHOLD_MINUTES
      ? minutes
      : DEFAULT_STALE_THRESHOLD_MINUTES;
  };

  const getStaleThresholdMs = () => staleThresholdMinutes * MS_PER_MINUTE;

  const normalizeModuleLabel = (value) => normalizeText(value).toUpperCase().replace(/[\s-]+/g, '_');

  const resolveReleaseModuleCode = (license) => {
    const explicitValues = [
      normalizeText(license?.moduleCode),
      normalizeText(license?.moduleId)
    ];

    for (const value of explicitValues) {
      const matchedCode = value.match(/\b(100|200)\b/);
      if (matchedCode) {
        return Number(matchedCode[1]);
      }
    }

    const labels = [
      normalizeModuleLabel(license?.moduleName),
      normalizeModuleLabel(license?.moduleDisplayName)
    ].filter(Boolean);

    if (labels.some((label) => FRONT_OFFICE_LICENSE_MODULE_NAMES.has(label) || (label.includes('FRONT') && label.includes('OFFICE')))) {
      return 100;
    }

    if (labels.some((label) => BACK_OFFICE_LICENSE_MODULE_NAMES.has(label) || (label.includes('BACK') && label.includes('OFFICE')))) {
      return 200;
    }

    return null;
  };

  const isTrackedLicenseModule = (license) => resolveReleaseModuleCode(license) !== null;

  const resolveReleaseModuleCodes = (licenses) => {
    const result = [];
    (Array.isArray(licenses) ? licenses : []).forEach((license) => {
      const moduleCode = resolveReleaseModuleCode(license);
      if (!ALLOWED_RELEASE_MODULE_CODES.has(moduleCode) || result.includes(moduleCode)) {
        return;
      }

      result.push(moduleCode);
    });
    return result;
  };

  const isSyrveOnlineHost = () => {
    const hostname = window.location.hostname.toLowerCase();
    return hostname === 'syrve.online' || hostname.endsWith(HELPDESK_ALLOWED_HOST_SUFFIX);
  };

  const isResetAllowedConnectionsPage = () => (
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    && window.location.pathname === CONNECTIONS_PATH
    && !isSyrveOnlineHost()
  );

  const getCurrentActionMode = () => (
    isResetAllowedConnectionsPage() && !resetFallbackEnabled ? 'reset' : 'helpdesk'
  );

  const getActionButtonDefaultLabel = () => (
    getCurrentActionMode() === 'reset' ? 'Сбросить лицензии' : 'Створити заявку'
  );

  const getActionFailureMessage = () => (
    getCurrentActionMode() === 'reset' ? 'Не вдалося скинути ліцензії.' : 'Не вдалося створити заявку.'
  );

  const getInitialActionStatus = () => {
    if (getCurrentActionMode() === 'reset') {
      return 'Є завислі ліцензії. Можна спробувати скинути їх автоматично.';
    }

    if (resetFallbackEnabled) {
      return 'Скидання не прибрало завислі ліцензії. Створіть заявку.';
    }

    return 'Є завислі ліцензії.';
  };

  const getMissingPlanfixContextStatus = () => (
    'Для створення заявки зайдіть на цю сторінку з відповідної задачі.'
  );

  const canUseCurrentActionWithoutPlanfixContext = () => getCurrentActionMode() === 'reset';

  const storageGet = (keys) => new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result || {});
    });
  });

  const loadStaleThresholdMinutes = async () => {
    const result = await storageGet([STORAGE_KEYS.staleLicenseThresholdMinutes]);
    staleThresholdMinutes = normalizeStaleThresholdMinutes(result[STORAGE_KEYS.staleLicenseThresholdMinutes]);
  };

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

      #${LICENSE_SUMMARY_ID} {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: fit-content;
        min-width: min(680px, calc(100vw - 16px));
        max-width: calc(100vw - 16px);
        margin: 0 0 10px;
        padding: 12px 14px;
        box-sizing: border-box;
        border: 1px solid #d7dce5;
        border-radius: 8px;
        background: #f8fafc;
        color: #0f172a;
        font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      }

      #${LICENSE_SUMMARY_ID} .dao-tools-license-summary__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      #${LICENSE_SUMMARY_ID} .dao-tools-license-summary__title {
        font-size: 15px;
        font-weight: 800;
      }

      #${LICENSE_SUMMARY_ID} .dao-tools-license-summary__threshold {
        color: #64748b;
        font-size: 12px;
        white-space: nowrap;
      }

      #${LICENSE_SUMMARY_GROUPS_ID} {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      #${LICENSE_SUMMARY_GROUPS_ID}:empty {
        display: none;
      }

      #${LICENSE_SUMMARY_ID} .dao-tools-license-summary__group {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 9px;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
        background: #fff;
        color: #334155;
        white-space: nowrap;
      }

      #${LICENSE_SUMMARY_ID} .dao-tools-license-summary__group--primary {
        border-color: #94a3b8;
        background: #f1f5f9;
        color: #1f2937;
        font-weight: 700;
      }

      #${LICENSE_SUMMARY_ID} .dao-tools-license-summary__group-count {
        min-width: 29px;
        padding: 2px 6px;
        border-radius: 999px;
        background: #e2e8f0;
        color: #334155;
        font-weight: 800;
        text-align: center;
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

      #${ACTION_BAR_ID}.${ACTION_BAR_INLINE_CLASS} {
        position: static;
        width: min(220px, 100%);
        margin: 12px 0 0 auto;
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
        #${LICENSE_SUMMARY_ID} {
          min-width: 0;
          width: calc(100vw - 16px);
        }

        #${LICENSE_SUMMARY_ID} .dao-tools-license-summary__header {
          align-items: flex-start;
          flex-direction: column;
          gap: 3px;
        }

        #${ACTION_BAR_ID}:not(.${ACTION_BAR_INLINE_CLASS}) {
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

  const getLicenseDisplayName = (license) => (
    normalizeText(license?.moduleDisplayName)
    || normalizeText(license?.moduleName)
    || (normalizeText(license?.moduleId) ? `Модуль ${normalizeText(license.moduleId)}` : 'Неизвестный модуль')
  );

  const getPrimaryLicensePriority = (license) => {
    const moduleId = normalizeText(license?.moduleId);
    if (PRIMARY_LICENSE_MODULE_PRIORITY.has(moduleId)) {
      return PRIMARY_LICENSE_MODULE_PRIORITY.get(moduleId);
    }

    const displayName = normalizeText(license?.displayName).toUpperCase();
    return PRIMARY_LICENSE_DISPLAY_PRIORITY.get(displayName) ?? null;
  };

  const collectLicenseConnections = () => {
    const result = [];
    const now = Date.now();

    document.querySelectorAll('table').forEach((table) => {
      const columnInfo = findLastActivityColumn(table);
      if (!columnInfo) {
        return;
      }

      const columnMap = buildColumnMap(columnInfo.headerRow);
      Array.from(table.querySelectorAll('tr')).forEach((row) => {
        if (row === columnInfo.headerRow) {
          return;
        }

        const cells = Array.from(row.children).filter((cell) => cell instanceof HTMLTableCellElement);
        const license = {
          moduleId: getCellText(cells, columnMap.moduleId),
          moduleName: getCellText(cells, columnMap.moduleName),
          moduleDisplayName: getCellText(cells, columnMap.moduleDisplayName),
          lastActivity: getCellText(cells, columnMap.lastActivity)
        };
        if (!license.moduleId && !license.moduleName && !license.moduleDisplayName) {
          return;
        }

        const lastActivityTime = parseLastActivityTime(license.lastActivity);
        const ageMs = lastActivityTime === null ? null : Math.max(0, now - lastActivityTime);
        result.push({
          ...license,
          displayName: getLicenseDisplayName(license),
          isActive: ageMs !== null && ageMs < getStaleThresholdMs(),
          isStale: ageMs !== null && ageMs >= getStaleThresholdMs()
        });
      });
    });

    return result;
  };

  const buildLicenseSummary = (connections) => {
    const groups = new Map();
    let activeCount = 0;
    let staleCount = 0;
    let unknownActivityCount = 0;

    connections.forEach((connection) => {
      if (connection.isActive) {
        activeCount += 1;
      } else if (connection.isStale) {
        staleCount += 1;
      } else {
        unknownActivityCount += 1;
      }

      const key = [connection.moduleId, connection.moduleName, connection.displayName].join('|');
      const group = groups.get(key) || {
        displayName: connection.displayName,
        moduleId: connection.moduleId,
        primaryPriority: getPrimaryLicensePriority(connection),
        activeCount: 0,
        occupiedCount: 0
      };
      group.occupiedCount += 1;
      if (connection.isActive) {
        group.activeCount += 1;
      }
      groups.set(key, group);
    });

    return {
      activeCount,
      occupiedCount: connections.length,
      staleCount,
      unknownActivityCount,
      groups: Array.from(groups.values()).sort((left, right) => (
        (left.primaryPriority ?? Number.MAX_SAFE_INTEGER) - (right.primaryPriority ?? Number.MAX_SAFE_INTEGER)
        || right.activeCount - left.activeCount
        || right.occupiedCount - left.occupiedCount
        || left.displayName.localeCompare(right.displayName, 'ru')
      ))
    };
  };

  const createSummaryNode = (tagName, className, textContent = '') => {
    const node = document.createElement(tagName);
    node.className = className;
    node.textContent = textContent;
    return node;
  };

  const formatThresholdLabel = () => {
    const thresholdMinutes = Math.max(1, Math.round(getStaleThresholdMs() / MS_PER_MINUTE));
    return `Порог активности: ${thresholdMinutes} мин.`;
  };

  const renderLicenseSummary = () => {
    const connectionsTable = Array.from(document.querySelectorAll('table')).find((table) => findLastActivityColumn(table));
    if (!(connectionsTable instanceof HTMLTableElement)) {
      document.getElementById(LICENSE_SUMMARY_ID)?.remove();
      return;
    }

    const summary = buildLicenseSummary(collectLicenseConnections());
    const signature = JSON.stringify({
      activeCount: summary.activeCount,
      occupiedCount: summary.occupiedCount,
      staleCount: summary.staleCount,
      unknownActivityCount: summary.unknownActivityCount,
      thresholdMinutes: staleThresholdMinutes,
      groups: summary.groups
    });
    let summaryNode = document.getElementById(LICENSE_SUMMARY_ID);

    if (summaryNode?.dataset.signature === signature) {
      if (summaryNode.nextElementSibling !== connectionsTable) {
        connectionsTable.insertAdjacentElement('beforebegin', summaryNode);
      }
      return;
    }

    if (!(summaryNode instanceof HTMLElement)) {
      summaryNode = document.createElement('section');
      summaryNode.id = LICENSE_SUMMARY_ID;
      summaryNode.setAttribute('aria-label', 'Сводка занятых лицензий Syrve');
    }

    summaryNode.replaceChildren();
    summaryNode.dataset.signature = signature;
    summaryNode.dataset.activeCount = String(summary.activeCount);
    summaryNode.dataset.occupiedCount = String(summary.occupiedCount);
    summaryNode.dataset.staleCount = String(summary.staleCount);

    const header = createSummaryNode('div', 'dao-tools-license-summary__header');
    header.appendChild(createSummaryNode('span', 'dao-tools-license-summary__title', 'Лицензии Syrve'));
    header.appendChild(createSummaryNode('span', 'dao-tools-license-summary__threshold', formatThresholdLabel()));

    const groups = createSummaryNode('div', '', '');
    groups.id = LICENSE_SUMMARY_GROUPS_ID;
    summary.groups.forEach((group) => {
      const groupClassName = `dao-tools-license-summary__group${group.primaryPriority === null ? '' : ' dao-tools-license-summary__group--primary'}`;
      const groupNode = createSummaryNode('span', groupClassName);
      const moduleSuffix = group.moduleId ? ` · ${group.moduleId}` : '';
      groupNode.title = `${group.displayName}${moduleSuffix}: всего занято ${group.occupiedCount}`;
      groupNode.appendChild(createSummaryNode('span', '', group.displayName));
      groupNode.appendChild(createSummaryNode(
        'strong',
        'dao-tools-license-summary__group-count',
        String(group.occupiedCount)
      ));
      groups.appendChild(groupNode);
    });

    summaryNode.appendChild(header);
    summaryNode.appendChild(groups);
    connectionsTable.insertAdjacentElement('beforebegin', summaryNode);
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

      const columnMap = buildColumnMap(columnInfo.headerRow);
      Array.from(table.querySelectorAll('tr')).forEach((row) => {
        if (row === columnInfo.headerRow) {
          return;
        }

        const cells = Array.from(row.children).filter((cell) => cell instanceof HTMLTableCellElement);
        const license = {
          moduleId: getCellText(cells, columnMap.moduleId),
          moduleName: getCellText(cells, columnMap.moduleName),
          moduleDisplayName: getCellText(cells, columnMap.moduleDisplayName)
        };
        if (!isTrackedLicenseModule(license)) {
          clearStaleRow(row);
          return;
        }

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
        if (ageMs >= getStaleThresholdMs()) {
          markStaleRow(row, activityCell, ageMs);
        } else {
          clearStaleRow(row);
        }
      });
    });

    renderLicenseSummary();
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
        const moduleId = getCellText(cells, columnMap.moduleId);
        const moduleName = getCellText(cells, columnMap.moduleName);
        const moduleDisplayName = getCellText(cells, columnMap.moduleDisplayName);
        const moduleCode = resolveReleaseModuleCode({ moduleId, moduleName, moduleDisplayName });
        if (!ALLOWED_RELEASE_MODULE_CODES.has(moduleCode)) {
          return;
        }

        const lastActivity = getCellText(cells, columnMap.lastActivity);
        result.push({
          ipAddress: getCellText(cells, columnMap.ipAddress),
          computerName: getCellText(cells, columnMap.computerName),
          terminalName: getCellText(cells, columnMap.terminalName),
          login: getCellText(cells, columnMap.login),
          moduleId,
          moduleCode,
          moduleName,
          moduleDisplayName,
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

  const readPendingResetVerification = () => {
    try {
      const rawValue = window.sessionStorage.getItem(RESET_VERIFICATION_SESSION_KEY);
      if (!rawValue) {
        return null;
      }

      const parsedValue = JSON.parse(rawValue);
      const createdAt = Number(parsedValue?.createdAt);
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > RESET_VERIFICATION_TTL_MS) {
        window.sessionStorage.removeItem(RESET_VERIFICATION_SESSION_KEY);
        return null;
      }

      return {
        requestId: String(parsedValue?.requestId || ''),
        moduleCodes: Array.isArray(parsedValue?.moduleCodes) ? parsedValue.moduleCodes : [],
        createdAt
      };
    } catch (error) {
      window.sessionStorage.removeItem(RESET_VERIFICATION_SESSION_KEY);
      return null;
    }
  };

  const savePendingResetVerification = (payload) => {
    try {
      window.sessionStorage.setItem(RESET_VERIFICATION_SESSION_KEY, JSON.stringify({
        requestId: payload.requestId,
        moduleCodes: payload.moduleCodes,
        createdAt: Date.now()
      }));
      return true;
    } catch (error) {
      return false;
    }
  };

  const clearPendingResetVerification = () => {
    pendingResetVerification = null;
    try {
      window.sessionStorage.removeItem(RESET_VERIFICATION_SESSION_KEY);
    } catch (error) {
      // Ignore storage cleanup failures.
    }
  };

  const waitForDelay = (timeoutMs) => new Promise((resolve) => {
    window.setTimeout(resolve, timeoutMs);
  });

  const isConnectionsTableReady = () => Array.from(document.querySelectorAll('table')).some((table) => findLastActivityColumn(table));

  const waitForPostResetStaleLicenses = async (timeoutMs = RESET_VERIFICATION_TIMEOUT_MS) => {
    const deadline = Date.now() + timeoutMs;
    let lastStaleLicensesSnapshot = [];
    let wasTableReady = false;

    while (Date.now() < deadline) {
      highlightStaleConnections();
      const staleLicenses = collectStaleLicenses();
      if (isConnectionsTableReady()) {
        wasTableReady = true;
        lastStaleLicensesSnapshot = staleLicenses;
        if (staleLicenses.length === 0) {
          return [];
        }
      }

      await waitForDelay(500);
    }

    highlightStaleConnections();
    if (!wasTableReady && !isConnectionsTableReady()) {
      throw new Error('Таблиця зайнятих ліцензій не завантажилась після скидання.');
    }

    const staleLicenses = collectStaleLicenses();
    return staleLicenses.length > 0 ? staleLicenses : lastStaleLicensesSnapshot;
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

    button.dataset.defaultLabel = getActionButtonDefaultLabel();

    button.disabled = isBusy;
    button.textContent = isBusy ? label : button.dataset.defaultLabel;
  };

  const removeHelpDeskActionBar = () => {
    document.getElementById(ACTION_BAR_ID)?.remove();
  };

  const scheduleRemoveHelpDeskActionBar = () => {
    if (activeStaleLicenseRequestId || activeHelpDeskRequestId || activeStaleLicenseResetRequestId || actionRemoveTimerId !== null) {
      return;
    }

    actionRemoveTimerId = window.setTimeout(() => {
      actionRemoveTimerId = null;
      if (!activeStaleLicenseRequestId && !activeHelpDeskRequestId && !activeStaleLicenseResetRequestId && collectStaleLicenses().length === 0) {
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
    const rightSpace = window.innerWidth - tableRect.right;
    if (rightSpace < actionWidth + gap) {
      actionBar.classList.add(ACTION_BAR_INLINE_CLASS);
      actionBar.style.top = '';
      actionBar.style.left = '';
      actionBar.style.right = '';
      firstTable.insertAdjacentElement('afterend', actionBar);
      return;
    }

    const top = Math.max(8, Math.min(tableRect.top, window.innerHeight - actionBar.offsetHeight - 8));
    const left = tableRect.right + gap;
    actionBar.classList.remove(ACTION_BAR_INLINE_CLASS);
    if (actionBar.parentElement !== document.body) {
      document.body.appendChild(actionBar);
    }
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
    button.textContent = getActionButtonDefaultLabel();
    button.addEventListener('click', handleActionButtonClick);

    const status = document.createElement('span');
    status.id = ACTION_STATUS_ID;
    status.textContent = getInitialActionStatus();

    actionBar.appendChild(button);
    actionBar.appendChild(status);
    document.body.appendChild(actionBar);
    updateHelpDeskActionBarPosition();
    return actionBar;
  };

  const updateActionBarMode = (isInfoOnly) => {
    const button = document.getElementById(ACTION_BUTTON_ID);
    if (button instanceof HTMLButtonElement) {
      button.hidden = isInfoOnly;
      button.disabled = isInfoOnly;
      if (!isInfoOnly) {
        button.dataset.defaultLabel = getActionButtonDefaultLabel();
        button.textContent = button.dataset.defaultLabel;
      }
    }

    if (isInfoOnly) {
      setActionStatus(getMissingPlanfixContextStatus());
      return;
    }

    const statusNode = document.getElementById(ACTION_STATUS_ID);
    if (statusNode?.textContent === getMissingPlanfixContextStatus()) {
      setActionStatus(getInitialActionStatus());
    }
  };

  const renderHelpDeskActionBar = () => {
    const staleLicenses = collectStaleLicenses();
    if (staleLicenses.length > 0) {
      lastStaleLicenses = staleLicenses;
      lastStaleSeenAt = Date.now();
    }

    const currentActionMode = getCurrentActionMode();
    const canUseAction = hasHelpDeskContext || canUseCurrentActionWithoutPlanfixContext();
    const shouldShowContextNotice = currentActionMode === 'helpdesk' && !hasHelpDeskContext;
    const shouldShow = (canUseAction || shouldShowContextNotice) && (
      staleLicenses.length > 0 ||
      activeStaleLicenseRequestId ||
      activeHelpDeskRequestId ||
      activeStaleLicenseResetRequestId ||
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
    updateActionBarMode(shouldShowContextNotice && !activeStaleLicenseRequestId && !activeHelpDeskRequestId && !activeStaleLicenseResetRequestId);
    const button = document.getElementById(ACTION_BUTTON_ID);
    if (button instanceof HTMLButtonElement && !activeStaleLicenseRequestId && !activeHelpDeskRequestId && !activeStaleLicenseResetRequestId) {
      if (shouldShowContextNotice) {
        return;
      }

      button.disabled = false;
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

        if (getCurrentActionMode() === 'helpdesk' && !hasHelpDeskContext && contextRetryCount < CONTEXT_RETRY_LIMIT) {
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

  function handleActionButtonClick() {
    if (getCurrentActionMode() === 'reset') {
      void handleResetStaleLicenses();
      return;
    }

    void handleCreateHelpDeskDraft();
  }

  async function handleResetStaleLicenses() {
    if (activeStaleLicenseRequestId || activeHelpDeskRequestId || activeStaleLicenseResetRequestId) {
      return;
    }

    const staleLicenses = getAvailableStaleLicenses();
    if (!staleLicenses.length) {
      setActionStatus('Завислі ліцензії не знайдено.', true);
      return;
    }

    const moduleCodes = resolveReleaseModuleCodes(staleLicenses);
    if (!moduleCodes.length) {
      resetFallbackEnabled = true;
      setActionButtonBusy(false);
      setActionStatus('Не вдалося визначити модуль ліцензії. Створіть заявку.', true);
      renderHelpDeskActionBar();
      void refreshHelpDeskContext();
      return;
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    activeStaleLicenseResetRequestId = requestId;
    setActionButtonBusy(true, 'Скидаємо...');
    setActionStatus('Відкриваємо службову сторінку Groovy...');

    try {
      const response = await sendRuntimeMessage({
        action: 'RESET_STALE_LICENSE_CONNECTIONS',
        requestId,
        sourceConnectionsUrl: window.location.href,
        staleLicenses,
        moduleCodes
      });

      const didSaveVerification = savePendingResetVerification({
        requestId,
        moduleCodes: response.moduleCodes || moduleCodes
      });
      if (!didSaveVerification) {
        activeStaleLicenseResetRequestId = '';
        resetFallbackEnabled = false;
        setActionButtonBusy(false);
        setActionStatus('Не вдалося підготувати перевірку після перезавантаження. Спробуйте скинути ліцензії ще раз.', true);
        renderHelpDeskActionBar();
        return;
      }

      setActionStatus('Скидання виконано. Оновлюємо таблицю...');
      setActionButtonBusy(true, 'Перевіряємо...');
      window.location.reload();
    } catch (error) {
      activeStaleLicenseResetRequestId = '';
      resetFallbackEnabled = false;
      setActionButtonBusy(false);
      setActionStatus(`${error?.message || getActionFailureMessage()} Спробуйте скинути ліцензії ще раз.`, true);
      renderHelpDeskActionBar();
    }
  }

  async function handleCreateHelpDeskDraft() {
    if (activeStaleLicenseRequestId || activeHelpDeskRequestId || activeStaleLicenseResetRequestId) {
      return;
    }

    const staleLicenses = getAvailableStaleLicenses();
    if (!staleLicenses.length) {
      setActionStatus('Завислі ліцензії не знайдено.', true);
      return;
    }

    if (!hasHelpDeskContext) {
      setActionStatus(getMissingPlanfixContextStatus(), true);
      void refreshHelpDeskContext();
      return;
    }

    setActionButtonBusy(true, 'Готуємо...');
    setActionStatus('Відкриваємо вибір екрана...');

    try {
      const response = await sendRuntimeMessage({
        action: 'CREATE_STALE_LICENSE_HELPDESK_DRAFT',
        sourceConnectionsUrl: window.location.href,
        staleLicenses,
        forceHelpDesk: resetFallbackEnabled === true
      });
      activeStaleLicenseRequestId = response.requestId || '';
      setActionStatus('Оберіть весь екран у вікні Chrome.');
      setActionButtonBusy(true, 'Очікуємо скріншот...');
    } catch (error) {
      activeStaleLicenseRequestId = '';
      activeHelpDeskRequestId = '';
      setActionButtonBusy(false);
      setActionStatus(error?.message || getActionFailureMessage(), true);
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
        setActionStatus(message.error || getActionFailureMessage(), true);
        return;
      }

      if (message.flow === 'report' || message.reportId || message.reportTabId) {
        activeHelpDeskRequestId = '';
        setActionButtonBusy(false);
        setActionStatus('Повідомлення зі скріншотом відкрито.');
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

  const verifyPendingResetAfterReload = async () => {
    const verification = pendingResetVerification;
    if (!verification) {
      return;
    }

    activeStaleLicenseResetRequestId = verification.requestId || `${Date.now()}-verify`;
    resetFallbackEnabled = false;
    renderHelpDeskActionBar();
    setActionButtonBusy(true, 'Перевіряємо...');
    setActionStatus('Перевіряємо результат скидання ліцензій...');

    try {
      const staleLicenses = await waitForPostResetStaleLicenses();
      activeStaleLicenseResetRequestId = '';
      clearPendingResetVerification();

      if (!staleLicenses.length) {
        lastStaleLicenses = [];
        lastStaleSeenAt = 0;
        removeHelpDeskActionBar();
        return;
      }

      lastStaleLicenses = staleLicenses;
      lastStaleSeenAt = Date.now();
      resetFallbackEnabled = true;
      setActionButtonBusy(false);
      setActionStatus('Скидання не прибрало завислі ліцензії. Створіть заявку.', true);
      renderHelpDeskActionBar();
      void refreshHelpDeskContext();
    } catch (error) {
      activeStaleLicenseResetRequestId = '';
      clearPendingResetVerification();
      resetFallbackEnabled = true;
      setActionButtonBusy(false);
      setActionStatus(`${error?.message || 'Не вдалося перевірити результат скидання.'} Створіть заявку.`, true);
      renderHelpDeskActionBar();
      void refreshHelpDeskContext();
    }
  };

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
    const licenseSummary = document.getElementById(LICENSE_SUMMARY_ID);
    return mutations.some((mutation) => {
      const target = mutation.target;
      const isActionBarMutation = actionBar instanceof HTMLElement && target instanceof Node && actionBar.contains(target);
      const isSummaryMutation = licenseSummary instanceof HTMLElement && target instanceof Node && licenseSummary.contains(target);
      return !isActionBarMutation && !isSummaryMutation;
    });
  };

  const start = () => {
    pendingResetVerification = readPendingResetVerification();
    if (pendingResetVerification) {
      activeStaleLicenseResetRequestId = pendingResetVerification.requestId || `${Date.now()}-verify`;
    }

    highlightStaleConnections();
    void loadStaleThresholdMinutes().then(() => {
      highlightStaleConnections();
    });
    void refreshHelpDeskContext();
    if (pendingResetVerification) {
      void verifyPendingResetAfterReload();
    }

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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEYS.staleLicenseThresholdMinutes]) {
      return;
    }

    staleThresholdMinutes = normalizeStaleThresholdMinutes(
      changes[STORAGE_KEYS.staleLicenseThresholdMinutes].newValue
    );
    lastStaleLicenses = [];
    lastStaleSeenAt = 0;
    highlightStaleConnections();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
