const waitForElement = (selector, timeout = 5000) => {
    return new Promise((resolve, reject) => {
        const interval = 100;
        let elapsed = 0;
        const checkExist = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(checkExist);
                resolve(element);
            }
            elapsed += interval;
            if (elapsed >= timeout) {
                clearInterval(checkExist);
                reject(new Error("Елемент не знайдено"));
            }
        }, interval);
    });
};

// Disco mode color constants
const DISCO_COLORS = {
    gradient: "linear-gradient(45deg, #ff0080, #ff8c00, #40e0d0, #ff0080)",
    textColor: "#000",
    borderColor: "#fff",
    boxShadow: "0 0 20px rgba(255, 0, 128, 0.6), 0 0 30px rgba(64, 224, 208, 0.4)",
    textShadow: "0 0 10px rgba(255, 255, 255, 0.8)"
};

// Function to apply disco style to button
const applyDiscoStyle = (button) => {
    // Store original styles for restoration
    if (!button.dataset.originalStyles) {
        button.dataset.originalStyles = JSON.stringify({
            background: button.style.background,
            backgroundSize: button.style.backgroundSize,
            animation: button.style.animation,
            color: button.style.color,
            fontWeight: button.style.fontWeight,
            border: button.style.border,
            boxShadow: button.style.boxShadow,
            textShadow: button.style.textShadow
        });
    }
    
    button.style.background = DISCO_COLORS.gradient;
    button.style.backgroundSize = "300% 300%";
    button.style.animation = "disco-gradient 3s ease infinite, disco-pulse 1s ease-in-out infinite";
    button.style.color = DISCO_COLORS.textColor;
    button.style.fontWeight = "bold";
    button.style.border = `2px solid ${DISCO_COLORS.borderColor}`;
    button.style.boxShadow = DISCO_COLORS.boxShadow;
    button.style.textShadow = DISCO_COLORS.textShadow;
    
    // Add keyframes if not already added
    if (!document.getElementById('disco-styles')) {
        const style = document.createElement('style');
        style.id = 'disco-styles';
        style.textContent = `
            @keyframes disco-gradient {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
            }
            @keyframes disco-pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.05); }
            }
        `;
        document.head.appendChild(style);
    }
};

// Function to remove disco style from button
const removeDiscoStyle = (button) => {
    // Restore original styles if they were saved
    if (button.dataset.originalStyles) {
        const originalStyles = JSON.parse(button.dataset.originalStyles);
        button.style.background = originalStyles.background;
        button.style.backgroundSize = originalStyles.backgroundSize;
        button.style.animation = originalStyles.animation;
        button.style.color = originalStyles.color;
        button.style.fontWeight = originalStyles.fontWeight;
        button.style.border = originalStyles.border;
        button.style.boxShadow = originalStyles.boxShadow;
        button.style.textShadow = originalStyles.textShadow;
    }
};

const splitCardServerAddressCandidates = (rawAddress) => {
    const normalizedAddress = String(rawAddress || '').trim();
    if (!normalizedAddress) {
        return [];
    }

    const parts = normalizedAddress.split(/\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts : [normalizedAddress];
};

const parseCardServerEndpoint = (value) => {
    const rawValue = String(value || '').trim();
    if (!rawValue) {
        return null;
    }

    const candidate = /^[a-z]+:\/\//i.test(rawValue) ? rawValue : `http://${rawValue}`;

    try {
        const parsed = new URL(candidate);
        return {
            server: parsed.hostname.trim().toLowerCase(),
            port: parsed.port.trim()
        };
    } catch (error) {
        const sanitizedValue = rawValue
            .replace(/^[a-z]+:\/\//i, '')
            .split(/[/?#]/)[0]
            .trim();

        if (!sanitizedValue) {
            return null;
        }

        const bracketMatch = sanitizedValue.match(/^\[([^\]]+)\](?::(\d+))?$/);
        if (bracketMatch) {
            return {
                server: bracketMatch[1].trim().toLowerCase(),
                port: (bracketMatch[2] || '').trim()
            };
        }

        const portMatch = sanitizedValue.match(/^([^:]+):(\d+)$/);
        if (portMatch) {
            return {
                server: portMatch[1].trim().toLowerCase(),
                port: portMatch[2].trim()
            };
        }

        return {
            server: sanitizedValue.toLowerCase(),
            port: ''
        };
    }
};

const normalizeServerHost = (value) => parseCardServerEndpoint(value)?.server || '';

const getCardIpv4Octets = (value) => {
    const normalizedValue = String(value || '').trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedValue)) {
        return null;
    }

    const octets = normalizedValue.split('.').map((part) => Number(part));
    return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? octets : null;
};

const isPrivateOrReservedCardIpv4Host = (value) => {
    const octets = getCardIpv4Octets(value);
    if (!octets) {
        return false;
    }

    const [first, second] = octets;

    if (first === 0 || first === 10 || first === 127 || first >= 224) {
        return true;
    }

    if (first === 169 && second === 254) {
        return true;
    }

    if (first === 172 && second >= 16 && second <= 31) {
        return true;
    }

    if (first === 192 && second === 168) {
        return true;
    }

    if (first === 100 && second >= 64 && second <= 127) {
        return true;
    }

    if (first === 198 && (second === 18 || second === 19)) {
        return true;
    }

    return false;
};

const isPublicCardIpv4Host = (value) => {
    const octets = getCardIpv4Octets(value);
    return Boolean(octets) && !isPrivateOrReservedCardIpv4Host(value);
};

const isPublicCardDomainHost = (value) => {
    const normalizedValue = normalizeServerHost(value);
    if (!normalizedValue || getCardIpv4Octets(normalizedValue)) {
        return false;
    }

    if (!normalizedValue.includes('.') || normalizedValue === 'localhost') {
        return false;
    }

    if (['.local', '.lan', '.home', '.internal', '.localhost'].some((suffix) => normalizedValue.endsWith(suffix))) {
        return false;
    }

    return normalizedValue.split('.').every((label) => (
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
        && !/^\d+$/.test(label)
    ));
};

const classifyCardServerHost = (value) => {
    const normalizedValue = normalizeServerHost(value);
    if (!normalizedValue) {
        return 'unknown';
    }

    if (isPublicCardDomainHost(normalizedValue)) {
        return 'public-domain';
    }

    if (isPublicCardIpv4Host(normalizedValue)) {
        return 'public-ipv4';
    }

    if (isPrivateOrReservedCardIpv4Host(normalizedValue)) {
        return 'private-ipv4';
    }

    return 'unknown';
};

const getCardServerAddressCandidates = (rawAddress) => splitCardServerAddressCandidates(rawAddress)
    .map((part) => {
        const endpoint = parseCardServerEndpoint(part);
        if (!endpoint?.server) {
            return null;
        }

        return {
            raw: part,
            server: endpoint.server,
            port: endpoint.port,
            hostType: classifyCardServerHost(endpoint.server)
        };
    })
    .filter(Boolean);

const selectPreferredCardServerCandidate = (candidates) => {
    const publicDomainCandidate = candidates.find((candidate) => candidate.hostType === 'public-domain');
    if (publicDomainCandidate) {
        return publicDomainCandidate;
    }

    const publicIpv4Candidate = candidates.find((candidate) => candidate.hostType === 'public-ipv4');
    if (publicIpv4Candidate) {
        return publicIpv4Candidate;
    }

    if (candidates.some((candidate) => candidate.hostType === 'private-ipv4')) {
        return { errorCode: 'private-only' };
    }

    return { errorCode: 'not-found' };
};

const selectPreferredCardServerAddress = (rawAddress) => {
    const candidates = getCardServerAddressCandidates(rawAddress);
    return selectPreferredCardServerCandidate(candidates);
};

const buildCardServerSelectionErrorMessage = (selectionResult) => {
    if (selectionResult?.errorCode === 'private-only') {
        return 'У полі адреси знайдено лише внутрішню адресу сервера. Вкажіть зовнішню адресу або публічний домен.';
    }

    return 'Адресу сервера не знайдено. Перевірте поле адреси.';
};

const extractDaoCloudAddress = (rawAddress) => {
    const selection = selectPreferredCardServerAddress(rawAddress);
    return selection?.server || null;
};

const copyTextToClipboard = async (value) => {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return;
        } catch (error) {
            console.warn("Clipboard API failed, trying fallback.", error);
        }
    }

    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    helper.style.pointerEvents = 'none';

    document.body.appendChild(helper);
    helper.focus();
    helper.select();

    try {
        const copied = document.execCommand('copy');
        if (!copied) {
            throw new Error('execCommand returned false');
        }
    } finally {
        helper.remove();
    }
};

// Listen for disco mode toggle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggleDiscoMode') {
        ['send-data-button'].forEach((buttonId) => {
            const button = document.getElementById(buttonId);
            if (!button) return;

            button.dataset.daoDiscoMode = message.discoMode ? 'true' : 'false';

            if (!message.discoMode && button.dataset.originalStyles) {
                removeDiscoStyle(button);
            }

            setCardLoginProgress(button.dataset.progressState || 'idle');

            syncCardLoginButtonWidth(button);
        });
        return;
    }

    if (message.action === 'HEALTH_PERIOD_RESULT') {
        if (!message.requestId || message.requestId !== activePeriodRequestId) {
            return;
        }

        const requestContext = activePeriodRequestContext;
        const scopeRoot = resolveCardVersionScopeRoot(requestContext);
        activePeriodRequestId = null;
        activePeriodRequestContext = null;

        if (message.error) {
            lastCardVersionCheckResult = null;
            clearCardVersionStatus(scopeRoot);
            setCardPeriodMessage(`Не вдалося отримати період: ${message.error}`);
            return;
        }

        if (message.period === undefined || message.period === null || message.period === '') {
            lastCardVersionCheckResult = null;
            clearCardVersionStatus(scopeRoot);
            setCardPeriodMessage('Не вдалося отримати період: значення відсутнє.');
            return;
        }

        const periodStartDate = String(message.periodStartDate || '').trim();
        setCardPeriodDetails({
            periodStartDate,
            period: message.period
        });

        const healthVersion = normalizeComparableCardVersion(message.versionRaw || message.version);
        if (!requestContext?.serverKey || !requestContext.cardVersion || !healthVersion) {
            lastCardVersionCheckResult = null;
            clearCardVersionStatus(scopeRoot);
            return;
        }

        lastCardVersionCheckResult = {
            serverKey: requestContext.serverKey,
            cardVersion: requestContext.cardVersion,
            displayVersion: (message.versionRaw || message.version || '').trim() || healthVersion,
            healthVersion,
            isMatch: requestContext.cardVersion === healthVersion
        };
        applyCardVersionCheckResult(scopeRoot, lastCardVersionCheckResult);
        return;
    }

    if (message.action === 'HELPDESK_DRAFT_FILL_RESULT') {
        if (!message.requestId || message.requestId !== activeHelpDeskDraftRequestId) {
            return;
        }

        activeHelpDeskDraftRequestId = null;
        resetActiveHelpDeskDraftButton();

        if (message.ok === false) {
            setCardErrorMessage(`Не вдалося підготувати чернетку HelpDeskEddy: ${message.error || 'невідома помилка'}`);
            return;
        }

        clearCardErrorMessage();
        setCardPeriodMessage('Чернетку HelpDeskEddy підготовлено. Перевірте форму та створіть заявку вручну.');
    }
});

// Функція для отримання параметра `key` з URL
const getKeyFromUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('key');
};

// Оновлена функція для асинхронного отримання даних з chrome.storage
const getUserInputFromStorage = async () => {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['userInput'], (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error('Помилка доступу до storage'));
            } else {
                resolve(result.userInput || 'default_value');
            }
        });
    });
};

const CARD_BUTTONS_ID = 'license-buttons-panel';
const CARD_ERROR_ID = 'license-buttons-panel-error';
const CARD_PERIOD_ID = 'license-buttons-panel-period';
const CARD_VERSION_STATUS_ATTR = 'data-dao-version-status';
const LOYALTY_BUTTON_ID = 'open-loyalty-button';
const WEB_BUTTON_ID = 'open-server-web-url-button';
const API_BUTTON_ID = 'open-server-api-url-button';
const HELPDESK_DRAFT_BUTTON_ID = 'open-helpdesk-draft-button';
const CARD_BUTTON_TOOLTIP_ATTR = 'data-card-button-tooltip';
const CARD_BUTTON_ACTION_DISABLED_ATTR = 'data-card-button-action-disabled';
const CARD_BUTTON_DISABLED_MESSAGES = Object.freeze({
    loyaltyMissing: 'Нема логіну Loyalty',
    webMissing: 'Нема адреси вебу',
    webInvalid: 'Некоректна адреса вебу',
    apiUnsupported: 'Адреса вебу не підходить для Веб:API'
});
const CARD_LICENSE_MODAL_ID = 'dao-license-check-modal';
const CARD_LICENSE_MODAL_STYLE_ID = 'dao-license-check-modal-styles';
const CARD_LICENSE_DISPLAY_MODE_STORAGE_KEY = 'planfixLicenseDisplayMode';
const CARD_LICENSE_MODAL_SCALE_STORAGE_KEY = 'planfixLicenseModalScale';
const CARD_LICENSE_DISPLAY_MODES = {
    cards: 'cards',
    list: 'list'
};
const BULK_LICENSE_ACTIONS = {
    check: 'check',
    update: 'update'
};
const BULK_LICENSE_MODE_FORMATS = {
    legacy: 'legacy',
    inline: 'inline'
};
const LEGACY_LICENSE_MANAGER_BASE = 'https://syrve-license-manager-1038989357415.us-west1.run.app/';
const CARD_LICENSE_MODAL_SCALE_STEPS = [50, 60, 70, 80, 90, 100, 110, 120, 130];
const CARD_LICENSE_MODAL_SCALE_DEFAULT = 100;
const CARD_SERVER_AVAILABILITY_ATTR = 'data-dao-server-availability';
const CARD_SERVER_AVAILABILITY_SERVICE_OFFLINE_ICON = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 10 10%27%3E%3Cpath d=%27M2.2 2.2l5.6 5.6M7.8 2.2 2.2 7.8%27 stroke=%27%23ffffff%27 stroke-width=%271.8%27 stroke-linecap=%27round%27/%3E%3C/svg%3E")';
const CARD_LOGIN_LONG_WAIT_MS = 7000;
const CARD_LOGIN_SUCCESS_RESET_MS = 1400;
const CARD_LOGIN_SUCCESS_MESSAGE_DELAY_MS = 220;
const CARD_SERVER_AVAILABILITY_CHECK_DEBOUNCE_MS = 450;
const CARD_SERVER_AVAILABILITY_RECHECK_INTERVAL_MS = 60 * 1000;
const CARD_LICENSE_GROUP_ORDER = ['pos', 'api', 'mobile', 'other'];
const CARD_LOGIN_BUTTON_LABELS = [
    'Увійти в бекофіс',
    'Відправка...',
    'Вхід виконується...',
    'Готово',
    'Довге очікування'
];
const SEND_DATA_SUCCESS_MESSAGE = 'Користувач вже має обліковку, все гуд';
const PLANFIX_DARK_THEME_CLASS = 'dark-theme';
const CARD_API_PATH = '/integration-management/index.html#/integrations';
const CARD_API_SUPPORTED_HOST_SUFFIX = '.syrve.app';
const CARD_BUTTON_INTENTS = {
    default: 'default',
    login: 'login',
    license: 'license',
    resto: 'resto',
    devices: 'devices',
    loyalty: 'loyalty',
    web: 'web',
    api: 'api',
    period: 'period',
    helpdesk: 'helpdesk'
};
const CARD_BUTTON_THEME_TOKENS = {
    light: {
        intents: {
            default: {
                background: '#475569',
                color: '#fff',
                border: '1px solid transparent',
                boxShadow: 'none'
            },
            login: {
                background: '#f87171',
                color: '#fff',
                border: '1px solid rgba(248, 113, 113, 0.42)',
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.12)'
            },
            license: {
                background: '#059669',
                color: '#fff',
                border: '1px solid transparent',
                boxShadow: 'none'
            },
            resto: {
                background: '#2563eb',
                color: '#fff',
                border: '1px solid transparent',
                boxShadow: 'none'
            },
            devices: {
                background: '#7c3aed',
                color: '#fff',
                border: '1px solid transparent',
                boxShadow: 'none'
            },
            loyalty: {
                background: '#db2777',
                color: '#fff',
                border: '1px solid transparent',
                boxShadow: 'none'
            },
            web: {
                background: '#0f766e',
                color: '#fff',
                border: '1px solid transparent',
                boxShadow: 'none'
            },
            api: {
                background: '#0369a1',
                color: '#fff',
                border: '1px solid transparent',
                boxShadow: 'none'
            },
            period: {
                background: '#0891b2',
                color: '#fff',
                border: '1px solid transparent',
                boxShadow: 'none'
            },
            helpdesk: {
                background: '#ea580c',
                color: '#fff',
                border: '1px solid transparent',
                boxShadow: 'none'
            }
        }
    },
    dark: {
        intents: {
            default: {
                background: 'rgba(71, 85, 105, 0.78)',
                color: '#e2e8f0',
                border: '1px solid rgba(148, 163, 184, 0.18)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.35)'
            },
            login: {
                background: 'rgba(127, 29, 29, 0.82)',
                color: '#f8fafc',
                border: '1px solid rgba(248, 113, 113, 0.18)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 2px 4px rgba(0, 0, 0, 0.38)'
            },
            license: {
                background: 'rgba(6, 95, 70, 0.82)',
                color: '#ecfdf5',
                border: '1px solid rgba(52, 211, 153, 0.14)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3)'
            },
            resto: {
                background: 'rgba(30, 64, 175, 0.8)',
                color: '#eff6ff',
                border: '1px solid rgba(96, 165, 250, 0.14)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3)'
            },
            devices: {
                background: 'rgba(91, 33, 182, 0.8)',
                color: '#f5f3ff',
                border: '1px solid rgba(167, 139, 250, 0.14)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3)'
            },
            loyalty: {
                background: 'rgba(157, 23, 77, 0.78)',
                color: '#fdf2f8',
                border: '1px solid rgba(244, 114, 182, 0.14)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3)'
            },
            web: {
                background: 'rgba(17, 94, 89, 0.8)',
                color: '#ecfeff',
                border: '1px solid rgba(45, 212, 191, 0.14)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3)'
            },
            api: {
                background: 'rgba(12, 74, 110, 0.8)',
                color: '#e0f2fe',
                border: '1px solid rgba(56, 189, 248, 0.14)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3)'
            },
            period: {
                background: 'rgba(21, 94, 117, 0.8)',
                color: '#ecfeff',
                border: '1px solid rgba(103, 232, 249, 0.14)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3)'
            },
            helpdesk: {
                background: 'rgba(154, 52, 18, 0.8)',
                color: '#fff7ed',
                border: '1px solid rgba(251, 146, 60, 0.14)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3)'
            }
        }
    }
};
const CARD_LICENSE_GROUP_LABELS = {
    mobile: 'Мобільні',
    api: 'API',
    pos: 'POS',
    other: 'Інше'
};
const CARD_CLOUD_SUBSCRIPTION_HOST_SUFFIX = '.syrve.online';
const CARD_CLOUD_ENTERPRISE_LICENSE_NAME = 'КЦ в бекофісі - Delivery (Callcenter)';
const CARD_CLOUD_SUBSCRIPTION_LABELS = {
    enterprise: 'CLOUD ENTERPRISE',
    pro: 'CLOUD PRO'
};
const SECURE_DEFAULT_PORT_DOMAINS = ['syrve.online', 'daocloud.it'];
const CARD_HTTP_ONLY_DOMAINS = ['daocloud.fun'];
const HELPDESK_DEFAULT_PRIORITY = 'Блокуюче';
const CARD_ERROR_SOURCE_MANUAL = 'manual';
const CARD_ERROR_SOURCE_SERVER_POLL = 'server-poll';
const DAO_SERVICE_STATUS_STATES = {
    checking: 'checking',
    online: 'online',
    offline: 'offline'
};

let cardErrorPollToken = 0;
let activePeriodRequestId = null;
let activePeriodRequestContext = null;
let lastCardVersionCheckResult = null;
let cardLoginStatusTimeoutId = 0;
let cardLoginRequestToken = 0;
let cardServerAvailabilityCheckToken = 0;
let cardServerAvailabilityCheckTimerId = 0;
let cardServerAvailabilityScheduledKey = '';
let cardServerAvailabilityInFlightKey = '';
let cardServerAvailabilitySnapshot = null;
let cardLicenseCheckRequestToken = 0;
let activeCardLicenseCheckButton = null;
let activeHelpDeskDraftRequestId = null;
let activeHelpDeskDraftButton = null;
let cardButtonThemeObserver = null;
let cardLicenseModalThemeObserver = null;
let cardLicenseModalScaleValue = CARD_LICENSE_MODAL_SCALE_DEFAULT;
let cardLicenseModalScaleLoadPromise = null;
let activeBulkLicenseRun = null;

const normalizeCardDaoServiceStatus = (value = {}) => {
    const normalizedState = String(value?.state || '').trim().toLowerCase();
    const numericStatusCode = Number(value?.statusCode);

    return {
        state: Object.values(DAO_SERVICE_STATUS_STATES).includes(normalizedState)
            ? normalizedState
            : DAO_SERVICE_STATUS_STATES.checking,
        checkedAt: typeof value?.checkedAt === 'string' ? value.checkedAt.trim() : '',
        statusCode: Number.isInteger(numericStatusCode) ? numericStatusCode : null,
        error: typeof value?.error === 'string' ? value.error.trim() : ''
    };
};

const isCardDaoServiceOffline = (status) => normalizeCardDaoServiceStatus(status).state === DAO_SERVICE_STATUS_STATES.offline;

const buildCardDaoServiceUnavailableMessage = (status, subject) => {
    const normalizedStatus = normalizeCardDaoServiceStatus(status);
    const normalizedSubject = String(subject || '').trim() || 'Ця дія';
    const detail = normalizedStatus.error ? ` ${normalizedStatus.error}` : '';
    return `DAO backend офлайн. ${normalizedSubject} тимчасово недоступна.${detail}`;
};

const getCardDaoServiceStatus = () => new Promise((resolve) => {
    chrome.runtime.sendMessage({
        action: 'GET_DAO_SERVICE_STATUS'
    }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
            resolve({ state: DAO_SERVICE_STATUS_STATES.checking });
            return;
        }

        resolve(normalizeCardDaoServiceStatus(response.status));
    });
});

const isCardHttpOnlyHost = (server) => {
    const normalizedServer = normalizeServerHost(server);
    return isPublicCardIpv4Host(normalizedServer)
        || CARD_HTTP_ONLY_DOMAINS.some((domain) => normalizedServer.endsWith(domain));
};

const requiresCardExplicitPort = (server) => isCardHttpOnlyHost(server);

const resolveCardServerContext = (server, port) => {
    const normalizedInput = server && typeof server === 'object'
        ? server
        : parseCardServerEndpoint(server);
    const normalizedServer = normalizeServerHost(normalizedInput?.server || server);
    if (!normalizedServer) {
        return null;
    }

    const explicitPort = (port || '').trim();
    const embeddedPort = String(normalizedInput?.port || '').trim();
    const resolvedPort = explicitPort || embeddedPort || (
        SECURE_DEFAULT_PORT_DOMAINS.some((domain) => normalizedServer.endsWith(domain))
            ? '443'
            : ''
    );

    return {
        server: normalizedServer,
        port: resolvedPort,
        hostType: normalizedInput?.hostType || classifyCardServerHost(normalizedServer)
    };
};

const buildCardPortRequiredErrorMessage = (server) => (
    isPublicCardIpv4Host(server)
        ? 'Для зовнішньої IP-адреси потрібно заповнити порт у картці ресторану.'
        : 'Для серверів daocloud.fun потрібно заповнити порт у картці ресторану.'
);

const resolveCardServerContextFromRawInput = (rawServer, port) => {
    const candidates = getCardServerAddressCandidates(rawServer);
    const availabilityPlan = buildCardServerAvailabilityPlan(candidates, port);
    const selection = selectPreferredCardServerCandidate(candidates);
    if (!selection?.server) {
        return {
            context: null,
            candidates,
            availabilityPlan,
            selection,
            errorMessage: buildCardServerSelectionErrorMessage(selection)
        };
    }

    const context = resolveCardServerContext(selection, port);
    if (!context?.server) {
        return {
            context: null,
            candidates,
            availabilityPlan,
            selection,
            errorMessage: 'Адресу сервера не знайдено. Перевірте поле адреси.'
        };
    }

    if (requiresCardExplicitPort(context.server) && !context.port) {
        return {
            context: null,
            candidates,
            availabilityPlan,
            selection,
            errorMessage: buildCardPortRequiredErrorMessage(context.server)
        };
    }

    return {
        context,
        candidates,
        availabilityPlan,
        selection,
        errorMessage: ''
    };
};

const buildCardServerUrl = (context, path = '/resto/') => {
    if (!context?.server) {
        return '';
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const protocol = isCardHttpOnlyHost(context.server) ? 'http' : 'https';
    const portSegment = context.port ? `:${context.port}` : '';
    return `${protocol}://${context.server}${portSegment}${normalizedPath}`;
};

const getCardServerAvailabilityUrl = (context) => {
    if (!context?.server) {
        return '';
    }

    return buildCardServerUrl(context, '/resto/');
};

const serializeCardServerAddressCandidate = (candidate) => {
    const normalizedServer = normalizeServerHost(candidate?.server || candidate);
    if (!normalizedServer) {
        return '';
    }

    const normalizedPort = String(candidate?.port || '').trim();
    const hostType = String(candidate?.hostType || classifyCardServerHost(normalizedServer)).trim() || 'unknown';
    return `${normalizedServer}:${normalizedPort}:${hostType}`;
};

const getCardServerAvailabilityCacheKey = (candidates, port) => {
    const serializedCandidates = candidates
        .map((candidate) => serializeCardServerAddressCandidate(candidate))
        .filter(Boolean);

    if (!serializedCandidates.length) {
        return '';
    }

    const normalizedPort = String(port || '').trim();
    return `${normalizedPort}|${serializedCandidates.join('|')}`;
};

const buildCardServerAvailabilityPlan = (candidates, port) => {
    const probeCandidates = candidates
        .filter((candidate) => candidate.hostType === 'public-domain' || candidate.hostType === 'public-ipv4')
        .slice(0, 2)
        .map((candidate) => {
            const context = resolveCardServerContext(candidate, port);
            const hasRequiredPort = Boolean(context?.server) && (!requiresCardExplicitPort(context.server) || context.port);

            return {
                raw: candidate.raw,
                server: candidate.server,
                port: candidate.port,
                hostType: candidate.hostType,
                context: hasRequiredPort ? context : null,
                url: hasRequiredPort ? getCardServerAvailabilityUrl(context) : '',
                errorMessage: hasRequiredPort ? '' : buildCardPortRequiredErrorMessage(candidate.server)
            };
        });

    const availableProbeCandidates = probeCandidates.filter((candidate) => candidate.context?.server && candidate.url);
    const portErrorCandidate = probeCandidates.find((candidate) => candidate.errorMessage);

    return {
        key: getCardServerAvailabilityCacheKey(candidates, port),
        candidates: availableProbeCandidates,
        errorMessage: availableProbeCandidates.length
            ? ''
            : portErrorCandidate?.errorMessage || buildCardServerSelectionErrorMessage(selectPreferredCardServerCandidate(candidates))
    };
};

const isCardApiAutologinSupportedHost = (server) => {
    const normalizedServer = normalizeServerHost(server);
    return normalizedServer === 'syrve.app' || normalizedServer.endsWith(CARD_API_SUPPORTED_HOST_SUFFIX);
};

const getFreshCardServerAvailabilitySnapshot = (cacheKey) => {
    if (!cacheKey || !cardServerAvailabilitySnapshot || cardServerAvailabilitySnapshot.key !== cacheKey) {
        return null;
    }

    if (Date.now() - cardServerAvailabilitySnapshot.checkedAt >= CARD_SERVER_AVAILABILITY_RECHECK_INTERVAL_MS) {
        return null;
    }

    return cardServerAvailabilitySnapshot;
};

const applyRecentCardServerAvailabilitySnapshot = (cacheKey, field72ValueElement) => {
    const snapshot = getFreshCardServerAvailabilitySnapshot(cacheKey);
    if (!snapshot) {
        return false;
    }

    setCardServerAvailabilityState(
        snapshot.state,
        snapshot.message,
        field72ValueElement
    );
    return true;
};

const resolveCardServerAvailabilityTarget = (field72ValueElement) => {
    if (field72ValueElement?.isConnected) {
        return field72ValueElement;
    }

    return document.querySelector('.field-target[f-id="72"] .ObjectEditFieldBase__view__value__text');
};

const resolveCardServerAvailabilityFailureState = (message = '') => {
    const normalizedMessage = String(message || '').trim().toLowerCase();
    if (!normalizedMessage) {
        return 'service-offline';
    }

    const serviceFailureMarkers = [
        'сервер перевірки доступності',
        'сервера перевірки доступності',
        'x-extension-key',
        'персональний доступ цього пристрою до перевірки доступності'
    ];

    return serviceFailureMarkers.some((marker) => normalizedMessage.includes(marker))
        ? 'service-offline'
        : 'offline';
};

const invalidateCardErrorPolling = () => {
    cardErrorPollToken += 1;
};

const getCardServerAvailabilityNode = (targetParent) => {
    if (!targetParent) {
        return null;
    }

    return [...targetParent.children].find((child) => child.getAttribute(CARD_SERVER_AVAILABILITY_ATTR) === 'true') || null;
};

const ensureCardServerInlineContainer = (field72ValueElement) => {
    if (!field72ValueElement) {
        return null;
    }

    const currentParent = field72ValueElement.parentElement;
    if (!currentParent) {
        return null;
    }

    if (currentParent.dataset.daoServerInline === 'true') {
        return currentParent;
    }

    const inlineContainer = document.createElement('span');
    inlineContainer.dataset.daoServerInline = 'true';
    inlineContainer.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
    `;

    currentParent.insertBefore(inlineContainer, field72ValueElement);
    inlineContainer.appendChild(field72ValueElement);
    return inlineContainer;
};

const ensureCardServerAvailabilityNode = (field72ValueElement) => {
    if (!field72ValueElement) {
        return null;
    }

    const inlineContainer = ensureCardServerInlineContainer(field72ValueElement);
    const targetParent = inlineContainer || field72ValueElement.parentElement;
    let statusNode = getCardServerAvailabilityNode(targetParent);

    if (!targetParent) {
        return statusNode;
    }

    if (!statusNode) {
        statusNode = document.createElement('span');
        statusNode.setAttribute(CARD_SERVER_AVAILABILITY_ATTR, 'true');
        statusNode.setAttribute('aria-hidden', 'true');
        statusNode.style.cssText = `
            width: 10px;
            height: 10px;
            border-radius: 999px;
            display: inline-block;
            flex: 0 0 10px;
            background: #9ca3af;
            background-repeat: no-repeat;
            background-position: center;
            background-size: 8px 8px;
            transition: background 0.18s ease, transform 0.18s ease, background-image 0.18s ease;
        `;
    }

    if (statusNode.parentElement !== targetParent || statusNode.nextElementSibling !== field72ValueElement) {
        targetParent.insertBefore(statusNode, field72ValueElement);
    }

    return statusNode;
};

const setCardServerAvailabilityState = (state, message = '', field72ValueElement = document.querySelector('.field-target[f-id="72"] .ObjectEditFieldBase__view__value__text')) => {
    const statusNode = ensureCardServerAvailabilityNode(field72ValueElement);
    if (!statusNode) {
        return;
    }

    const stateMap = {
        idle: {
            background: '#9ca3af',
            transform: 'scale(1)'
        },
        checking: {
            background: '#f59e0b',
            transform: 'scale(1.08)'
        },
        online: {
            background: '#16a34a',
            transform: 'scale(1)'
        },
        offline: {
            background: '#dc2626',
            transform: 'scale(1)'
        },
        'service-offline': {
            background: '#dc2626',
            transform: 'scale(1)',
            backgroundImage: CARD_SERVER_AVAILABILITY_SERVICE_OFFLINE_ICON
        }
    };

    const config = stateMap[state] || stateMap.idle;
    statusNode.style.background = config.background;
    statusNode.style.backgroundImage = config.backgroundImage || 'none';
    statusNode.style.transform = config.transform;
    statusNode.title = message || '';
};

const invalidateCardServerAvailabilityCheck = () => {
    cardServerAvailabilityCheckToken += 1;

    if (cardServerAvailabilityCheckTimerId) {
        clearTimeout(cardServerAvailabilityCheckTimerId);
        cardServerAvailabilityCheckTimerId = 0;
    }

    cardServerAvailabilityScheduledKey = '';
};

const wait = (delay) => new Promise((resolve) => {
    setTimeout(resolve, delay);
});

const buildCardServerAvailabilityAttemptLabel = (candidate) => {
    if (!candidate) {
        return '';
    }

    const context = candidate.context || candidate;
    return candidate.url || getCardServerAvailabilityUrl(context) || buildCardServerContextKey(context);
};

const buildCardServerAvailabilityCheckingMessage = (probeCandidates, attemptIndex = 0) => {
    const candidate = probeCandidates[attemptIndex];
    const candidateLabel = buildCardServerAvailabilityAttemptLabel(candidate);
    if (!candidateLabel) {
        return 'Перевірка доступності сервера';
    }

    if (probeCandidates.length > 1) {
        return `Перевірка ${candidateLabel} (${attemptIndex + 1}/${probeCandidates.length})`;
    }

    return `Перевірка ${candidateLabel}`;
};

const buildCardServerAvailabilityAttemptRecord = (candidate, state, message = '') => ({
    server: normalizeServerHost(candidate?.context?.server || candidate?.server || ''),
    port: String(candidate?.context?.port || candidate?.port || '').trim(),
    hostType: candidate?.hostType || classifyCardServerHost(candidate?.context?.server || candidate?.server || ''),
    url: buildCardServerAvailabilityAttemptLabel(candidate),
    state,
    message: String(message || '').trim()
});

const buildCardServerAvailabilitySummaryMessage = (attemptedCandidates, winningCandidate = null) => {
    const attemptedSummary = attemptedCandidates
        .map((candidate) => {
            const candidateLabel = candidate.url || buildCardServerContextKey(candidate) || candidate.server;
            const stateLabel = candidate.state === 'online'
                ? 'доступний'
                : candidate.state === 'service-offline'
                    ? 'сервіс перевірки недоступний'
                    : 'недоступний';
            return `${candidateLabel} — ${stateLabel}`;
        })
        .filter(Boolean)
        .join('; ');

    if (winningCandidate) {
        const winnerLabel = winningCandidate.url || buildCardServerContextKey(winningCandidate) || winningCandidate.server;
        return attemptedSummary
            ? `Доступний: ${winnerLabel}. Перевірено: ${attemptedSummary}.`
            : `Доступний: ${winnerLabel}.`;
    }

    const lastAttempt = attemptedCandidates[attemptedCandidates.length - 1] || null;
    if (!attemptedSummary) {
        return lastAttempt?.message || 'Не вдалося перевірити доступність сервера.';
    }

    return lastAttempt?.message
        ? `Перевірено: ${attemptedSummary}. Остання помилка: ${lastAttempt.message}`
        : `Перевірено: ${attemptedSummary}.`;
};

const probeCardServerAvailability = async (availabilityPlan, field72ValueElement, requestToken) => {
    const cacheKey = availabilityPlan?.key || '';
    const probeCandidates = availabilityPlan?.candidates || [];
    if (!cacheKey || !probeCandidates.length) {
        setCardServerAvailabilityState('idle', '', field72ValueElement);
        return false;
    }

    cardServerAvailabilityInFlightKey = cacheKey;
    console.debug('[DAO][server-availability] Перевіряю кандидати:', probeCandidates.map((candidate) => buildCardServerAvailabilityAttemptLabel(candidate)));

    try {
        const attemptedCandidates = [];

        for (let index = 0; index < probeCandidates.length; index += 1) {
            const candidate = probeCandidates[index];
            const targetNode = resolveCardServerAvailabilityTarget(field72ValueElement);
            const candidateLabel = buildCardServerAvailabilityAttemptLabel(candidate);
            setCardServerAvailabilityState(
                'checking',
                buildCardServerAvailabilityCheckingMessage(probeCandidates, index),
                targetNode
            );

            try {
                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({
                        action: 'PROBE_SERVER_AVAILABILITY',
                        server: candidate.context.server,
                        port: candidate.context.port
                    }, (result) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }

                        resolve(result);
                    });
                });

                if (requestToken !== cardServerAvailabilityCheckToken) {
                    return false;
                }

                if (!response?.ok) {
                    throw new Error(response?.error || `Не вдалося перевірити ${candidateLabel}.`);
                }

                const isReachable = response.reachable === true;
                const attemptMessage = String(response.error || `${candidateLabel} відповідає зі статусом ${response.status}.`).trim();
                const attemptRecord = buildCardServerAvailabilityAttemptRecord(
                    candidate,
                    isReachable ? 'online' : 'offline',
                    attemptMessage
                );

                attemptedCandidates.push(attemptRecord);
                if (!isReachable) {
                    continue;
                }

                const nextMessage = buildCardServerAvailabilitySummaryMessage(attemptedCandidates, attemptRecord);
                cardServerAvailabilitySnapshot = {
                    key: cacheKey,
                    checkedAt: Date.now(),
                    state: 'online',
                    message: nextMessage,
                    winningCandidate: {
                        server: attemptRecord.server,
                        port: attemptRecord.port,
                        hostType: attemptRecord.hostType,
                        url: attemptRecord.url
                    },
                    attemptedCandidates
                };
                setCardServerAvailabilityState(
                    'online',
                    nextMessage,
                    resolveCardServerAvailabilityTarget(field72ValueElement)
                );
                console.debug('[DAO][server-availability] Знайдено онлайн-кандидат:', attemptRecord.url);
                return true;
            } catch (error) {
                if (requestToken !== cardServerAvailabilityCheckToken) {
                    return false;
                }

                const attemptMessage = error?.message || `Не вдалося підключитися до ${candidateLabel}.`;
                const attemptState = resolveCardServerAvailabilityFailureState(attemptMessage);
                attemptedCandidates.push(buildCardServerAvailabilityAttemptRecord(candidate, attemptState, attemptMessage));

                if (attemptState === 'service-offline') {
                    break;
                }
            }
        }

        if (requestToken !== cardServerAvailabilityCheckToken) {
            return false;
        }

        const nextState = attemptedCandidates.some((candidate) => candidate.state === 'service-offline')
            ? 'service-offline'
            : 'offline';
        const nextMessage = buildCardServerAvailabilitySummaryMessage(attemptedCandidates);
        cardServerAvailabilitySnapshot = {
            key: cacheKey,
            checkedAt: Date.now(),
            state: nextState,
            message: nextMessage,
            winningCandidate: null,
            attemptedCandidates
        };
        setCardServerAvailabilityState(
            nextState,
            nextMessage,
            resolveCardServerAvailabilityTarget(field72ValueElement)
        );
        console.debug('[DAO][server-availability] Онлайн-кандидат не знайдено:', attemptedCandidates.map((candidate) => `${candidate.url || candidate.server}=${candidate.state}`));
        return false;
    } finally {
        if (cardServerAvailabilityInFlightKey === cacheKey) {
            cardServerAvailabilityInFlightKey = '';
        }
    }
};

const scheduleCardServerAvailabilityCheck = (availabilityPlan, field72ValueElement) => {
    if (!field72ValueElement) {
        return;
    }

    const cacheKey = availabilityPlan?.key || '';
    const probeCandidates = availabilityPlan?.candidates || [];
    if (!cacheKey || !probeCandidates.length) {
        invalidateCardServerAvailabilityCheck();
        setCardServerAvailabilityState('idle', '', field72ValueElement);
        return;
    }

    if (applyRecentCardServerAvailabilitySnapshot(cacheKey, field72ValueElement)) {
        return;
    }

    if (cardServerAvailabilityInFlightKey === cacheKey) {
        setCardServerAvailabilityState('checking', buildCardServerAvailabilityCheckingMessage(probeCandidates), field72ValueElement);
        return;
    }

    if (cardServerAvailabilityScheduledKey === cacheKey && cardServerAvailabilityCheckTimerId) {
        setCardServerAvailabilityState('checking', buildCardServerAvailabilityCheckingMessage(probeCandidates), field72ValueElement);
        return;
    }

    invalidateCardServerAvailabilityCheck();

    const requestToken = cardServerAvailabilityCheckToken;
    cardServerAvailabilityScheduledKey = cacheKey;
    cardServerAvailabilityCheckTimerId = window.setTimeout(async () => {
        cardServerAvailabilityCheckTimerId = 0;
        cardServerAvailabilityScheduledKey = '';

        if (requestToken !== cardServerAvailabilityCheckToken) {
            return;
        }

        await probeCardServerAvailability(availabilityPlan, field72ValueElement, requestToken);
    }, CARD_SERVER_AVAILABILITY_CHECK_DEBOUNCE_MS);
};

const ensureCardErrorNode = () => {
    let errorNode = document.getElementById(CARD_ERROR_ID);
    if (errorNode) {
        const buttonsContainer = document.getElementById(CARD_BUTTONS_ID);
        const periodNode = document.getElementById(CARD_PERIOD_ID);
        const anchorNode = periodNode || buttonsContainer;
        if (anchorNode && errorNode.previousElementSibling !== anchorNode) {
            anchorNode.after(errorNode);
        }
        return errorNode;
    }

    errorNode = document.createElement('div');
    errorNode.id = CARD_ERROR_ID;
    errorNode.style.cssText = `
        display: none;
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid rgba(220, 38, 38, 0.18);
        background: rgba(220, 38, 38, 0.08);
        color: #dc2626;
        font-size: 12px;
        line-height: 1.4;
        white-space: pre-wrap;
    `;

    const buttonsContainer = document.getElementById(CARD_BUTTONS_ID);
    const periodNode = document.getElementById(CARD_PERIOD_ID);
    const anchorNode = periodNode || buttonsContainer;
    if (anchorNode) {
        anchorNode.after(errorNode);
        return errorNode;
    }

    const wrapperBox = document.querySelector('.field-target[f-id="72"] .object-edit-field-bottom-panel-rc__wrapper-box');
    if (wrapperBox) {
        wrapperBox.after(errorNode);
    }

    return errorNode;
};

const ensureCardPeriodNode = () => {
    let periodNode = document.getElementById(CARD_PERIOD_ID);
    if (periodNode) {
        const buttonsContainer = document.getElementById(CARD_BUTTONS_ID);
        if (buttonsContainer && periodNode.previousElementSibling !== buttonsContainer) {
            buttonsContainer.after(periodNode);
        }
        return periodNode;
    }

    periodNode = document.createElement('div');
    periodNode.id = CARD_PERIOD_ID;
    periodNode.style.cssText = `
        display: none;
        margin-top: 8px;
        padding: 6px 2px 0 2px;
        color: #0f172a;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        font-weight: 500;
    `;

    const buttonsContainer = document.getElementById(CARD_BUTTONS_ID);
    if (buttonsContainer) {
        buttonsContainer.after(periodNode);
        return periodNode;
    }

    const wrapperBox = document.querySelector('.field-target[f-id="72"] .object-edit-field-bottom-panel-rc__wrapper-box');
    if (wrapperBox) {
        wrapperBox.after(periodNode);
    }

    return periodNode;
};

const createCardPeriodDetailNode = (label, value) => {
    const detailNode = document.createElement('div');
    detailNode.style.cssText = `
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
        padding: 6px 10px;
        border: 1px solid #d8e1ec;
        border-radius: 8px;
        background: #f8fbff;
    `;

    const labelNode = document.createElement('span');
    labelNode.textContent = `${label}:`;
    labelNode.style.cssText = `
        color: #64748b;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
    `;

    const valueNode = document.createElement('span');
    valueNode.textContent = value;
    valueNode.style.cssText = `
        color: #0f172a;
        font-weight: 600;
    `;

    detailNode.append(labelNode, valueNode);
    return detailNode;
};

const setCardPeriodDetails = ({ periodStartDate = '', period = '' }) => {
    const periodNode = ensureCardPeriodNode();
    if (!periodNode) return;

    const normalizedPeriod = String(period || '').trim();
    const normalizedDate = String(periodStartDate || '').trim();
    if (!normalizedPeriod) {
        periodNode.textContent = '';
        periodNode.style.display = 'none';
        return;
    }

    const detailsRow = document.createElement('div');
    detailsRow.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
    `;

    if (normalizedDate) {
        detailsRow.append(createCardPeriodDetailNode('Дата від', normalizedDate));
    }

    detailsRow.append(createCardPeriodDetailNode('Період', `${normalizedPeriod} днів`));
    periodNode.replaceChildren(detailsRow);
    periodNode.style.display = 'block';
};

const setCardPeriodMessage = (message) => {
    const periodNode = ensureCardPeriodNode();
    if (!periodNode) return;

    const normalizedMessage = (message || '').trim();
    periodNode.replaceChildren();
    periodNode.textContent = normalizedMessage;
    periodNode.style.display = normalizedMessage ? 'block' : 'none';
};

const clearCardPeriodMessage = () => {
    setCardPeriodMessage('');
};

const normalizeComparableCardVersion = (value) => {
    const match = String(value || '').match(/(\d+\.\d+\.\d+(?:\.\d+)*)/);
    if (!match) {
        return '';
    }

    const parts = match[1].split('.').filter(Boolean);
    if (parts.length < 3) {
        return '';
    }

    return [parts[0], parts[1], parts[2].slice(0, 1)]
        .filter(Boolean)
        .join('.');
};

const buildCardServerContextKey = (context) => {
    const normalizedServer = normalizeServerHost(context?.server || '');
    if (!normalizedServer) {
        return '';
    }

    const normalizedPort = String(context?.port || '').trim();
    return normalizedPort ? `${normalizedServer}:${normalizedPort}` : normalizedServer;
};

const resolveCardScopeRootByServerKey = (serverKey) => {
    if (!serverKey) {
        return document;
    }

    const serverFieldTargets = [...document.querySelectorAll('.field-target[f-id="72"]')];
    const matchedTarget = serverFieldTargets.find((serverFieldTarget) => {
        const scopeRoot = serverFieldTarget.closest('.g-popup-win-scroll-content, .page-layout-block.handbook-card-container, .object-edit-win-target, .object-edit-win-location-field')
            || document;
        const serverData = getServerData(scopeRoot, false);
        return buildCardServerContextKey(serverData) === serverKey;
    });

    return matchedTarget?.closest('.g-popup-win-scroll-content, .page-layout-block.handbook-card-container, .object-edit-win-target, .object-edit-win-location-field')
        || document;
};

const resolveCardVersionScopeRoot = (requestContext) => {
    if (requestContext?.scopeRoot?.isConnected) {
        return requestContext.scopeRoot;
    }

    return resolveCardScopeRootByServerKey(requestContext?.serverKey);
};

const getCardVersionValueElement = (scopeRoot = document) => (
    scopeRoot.querySelector('.field-target[f-id="96"] .ObjectEditFieldBase__view__value__text')
);

const getCardVersionStatusNode = (targetParent) => {
    if (!targetParent) {
        return null;
    }

    return [...targetParent.children].find((child) => child.getAttribute(CARD_VERSION_STATUS_ATTR) === 'true') || null;
};

const ensureCardVersionInlineContainer = (versionValueElement) => {
    if (!versionValueElement) {
        return null;
    }

    const currentParent = versionValueElement.parentElement;
    if (!currentParent) {
        return null;
    }

    if (currentParent.dataset.daoVersionInline === 'true') {
        return currentParent;
    }

    const inlineContainer = document.createElement('span');
    inlineContainer.dataset.daoVersionInline = 'true';
    inlineContainer.style.cssText = `
        display: inline-flex;
        align-items: center;
        flex-wrap: nowrap;
        gap: 6px;
        min-width: 0;
        max-width: 100%;
    `;

    currentParent.insertBefore(inlineContainer, versionValueElement);
    inlineContainer.appendChild(versionValueElement);
    return inlineContainer;
};

const ensureCardVersionStatusNode = (versionValueElement) => {
    if (!versionValueElement) {
        return null;
    }

    const inlineContainer = ensureCardVersionInlineContainer(versionValueElement);
    const targetParent = inlineContainer || versionValueElement.parentElement;
    let statusNode = getCardVersionStatusNode(targetParent);

    if (!targetParent) {
        return statusNode;
    }

    if (!statusNode) {
        statusNode = document.createElement('span');
        statusNode.setAttribute(CARD_VERSION_STATUS_ATTR, 'true');
        statusNode.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            font-weight: 700;
            line-height: 1.2;
            white-space: nowrap;
            flex: 0 0 auto;
        `;
    }

    let iconNode = statusNode.querySelector('[data-role="version-check-icon"]');
    if (!iconNode) {
        iconNode = document.createElement('span');
        iconNode.setAttribute('data-role', 'version-check-icon');
        iconNode.style.cssText = `
            width: 16px;
            height: 16px;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 16px;
            color: #ffffff;
            font-size: 10px;
            font-weight: 800;
            line-height: 1;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.16);
        `;
        statusNode.appendChild(iconNode);
    }

    let labelNode = statusNode.querySelector('[data-role="version-check-label"]');
    if (!labelNode) {
        labelNode = document.createElement('span');
        labelNode.setAttribute('data-role', 'version-check-label');
        labelNode.style.cssText = `
            display: none;
            line-height: 1.2;
        `;
        statusNode.appendChild(labelNode);
    }

    if (statusNode.parentElement !== targetParent || statusNode.nextElementSibling !== versionValueElement) {
        targetParent.insertBefore(statusNode, versionValueElement);
    }

    return statusNode;
};

const clearCardVersionStatus = (scopeRoot = document) => {
    scopeRoot.querySelectorAll(`[${CARD_VERSION_STATUS_ATTR}="true"]`).forEach((node) => node.remove());
};

const applyCardVersionCheckResult = (scopeRoot = document, result = lastCardVersionCheckResult) => {
    const versionValueElement = getCardVersionValueElement(scopeRoot);
    if (!versionValueElement) {
        return;
    }

    if (!result || !result.healthVersion) {
        clearCardVersionStatus(scopeRoot);
        return;
    }

    const statusNode = ensureCardVersionStatusNode(versionValueElement);
    if (!statusNode) {
        return;
    }

    const iconNode = statusNode.querySelector('[data-role="version-check-icon"]');
    const labelNode = statusNode.querySelector('[data-role="version-check-label"]');
    if (!iconNode || !labelNode) {
        return;
    }

    iconNode.textContent = result.isMatch ? '✓' : '✕';
    iconNode.style.background = result.isMatch ? '#16a34a' : '#dc2626';

    labelNode.textContent = result.isMatch ? '' : (result.displayVersion || result.healthVersion);
    labelNode.style.display = result.isMatch ? 'none' : 'inline';
    labelNode.style.color = result.isMatch ? '' : '#dc2626';

    statusNode.title = result.isMatch
        ? `Версія збігається: ${result.healthVersion}`
        : `У картці ${result.cardVersion || '—'}, на health.jsp ${result.displayVersion || result.healthVersion}, рекомендуємо оновити картку до актуальної версії.`;
};

const hasPersistentManualCardError = () => {
    const errorNode = document.getElementById(CARD_ERROR_ID);
    if (!errorNode) {
        return false;
    }

    const normalizedMessage = (errorNode.textContent || '').trim();
    return Boolean(normalizedMessage)
        && errorNode.style.display !== 'none'
        && errorNode.dataset.errorSource === CARD_ERROR_SOURCE_MANUAL;
};

const setCardErrorMessage = (message, options = {}) => {
    const { source = CARD_ERROR_SOURCE_MANUAL } = options;
    const errorNode = ensureCardErrorNode();
    if (!errorNode) return;

    const normalizedMessage = (message || '').trim();
    errorNode.textContent = normalizedMessage;
    errorNode.style.display = normalizedMessage ? 'block' : 'none';

    if (normalizedMessage) {
        errorNode.dataset.errorSource = source;
        return;
    }

    delete errorNode.dataset.errorSource;
};

const clearCardErrorMessage = (options = {}) => {
    const { preserveManual = false } = options;
    if (preserveManual && hasPersistentManualCardError()) {
        return;
    }

    setCardErrorMessage('');
};

const formatCardServerContextLabel = (context) => {
    if (!context?.server) {
        return '';
    }

    return context.port ? `${context.server}:${context.port}` : context.server;
};

const isPlanfixDarkTheme = () => document.body?.classList.contains(PLANFIX_DARK_THEME_CLASS) || false;

const getCardButtonThemePreset = () => CARD_BUTTON_THEME_TOKENS[isPlanfixDarkTheme() ? 'dark' : 'light'];

const getCardButtonIntentTheme = (intent) => {
    const preset = getCardButtonThemePreset();
    return preset.intents[intent] || preset.intents[CARD_BUTTON_INTENTS.default];
};

const isCardActionButtonActionDisabled = (button) => (
    button instanceof HTMLButtonElement
    && button.getAttribute(CARD_BUTTON_ACTION_DISABLED_ATTR) === 'true'
);

const canUseCardActionButtonHover = (button) => (
    button instanceof HTMLButtonElement
    && !button.disabled
    && !isCardActionButtonActionDisabled(button)
);

const syncCardActionButtonInteractivity = (button) => {
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    if (button.disabled) {
        button.style.cursor = 'wait';
        button.style.opacity = '0.82';
        button.style.filter = '';
        return;
    }

    const actionDisabled = isCardActionButtonActionDisabled(button);
    button.style.cursor = actionDisabled ? 'not-allowed' : 'pointer';
    button.style.opacity = actionDisabled ? '0.6' : '1';
    button.style.filter = actionDisabled ? 'saturate(0.16)' : '';
};

const applyCardActionButtonTheme = (button) => {
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    const theme = getCardButtonIntentTheme(button.dataset.cardButtonIntent || CARD_BUTTON_INTENTS.default);
    const isActionDisabled = isCardActionButtonActionDisabled(button);

    if (isActionDisabled) {
        button.style.background = isPlanfixDarkTheme()
            ? 'rgba(51, 65, 85, 0.82)'
            : 'rgba(226, 232, 240, 0.96)';
        button.style.color = isPlanfixDarkTheme()
            ? 'rgba(226, 232, 240, 0.78)'
            : '#64748b';
        button.style.border = isPlanfixDarkTheme()
            ? '1px solid rgba(148, 163, 184, 0.22)'
            : '1px solid rgba(148, 163, 184, 0.32)';
        button.style.boxShadow = isPlanfixDarkTheme()
            ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04)'
            : 'inset 0 1px 0 rgba(255, 255, 255, 0.7)';
    } else {
        button.style.background = theme.background;
        button.style.color = theme.color;
        button.style.border = theme.border;
        button.style.boxShadow = theme.boxShadow;
    }

    button.style.textShadow = '';
    syncCardActionButtonInteractivity(button);
};

const applyCardLoginButtonTheme = (button) => {
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    const theme = getCardButtonIntentTheme(CARD_BUTTON_INTENTS.login);

    if (button.dataset.originalStyles) {
        removeDiscoStyle(button);
    }

    button.style.background = theme.background;
    button.style.color = theme.color;
    button.style.border = theme.border;
    button.style.boxShadow = theme.boxShadow;
    button.style.backgroundSize = '';
    button.style.animation = '';
    button.style.textShadow = '';

    if (button.dataset.daoDiscoMode === 'true') {
        delete button.dataset.originalStyles;
        applyDiscoStyle(button);
    }
};

const applyThemeToExistingCardButtons = () => {
    const loginButton = document.getElementById('send-data-button');
    if (loginButton) {
        setCardLoginProgress(loginButton.dataset.progressState || 'idle');
        syncCardLoginButtonWidth(loginButton);
    }

    document.querySelectorAll(`#${CARD_BUTTONS_ID} button`).forEach((button) => {
        applyCompactCardActionButtonStyle(button);
    });
};

const ensureCardButtonThemeObserver = () => {
    if (cardButtonThemeObserver || !document.body) {
        return;
    }

    cardButtonThemeObserver = new MutationObserver((mutations) => {
        const hasThemeClassChange = mutations.some((mutation) => (
            mutation.type === 'attributes' && mutation.attributeName === 'class'
        ));

        if (hasThemeClassChange) {
            applyThemeToExistingCardButtons();
        }
    });

    cardButtonThemeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
    });

    applyThemeToExistingCardButtons();
};

const setCardActionButtonLoading = (button, isLoading, loadingLabel = '') => {
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.textContent || '';
    }

    button.disabled = isLoading;
    button.textContent = isLoading && loadingLabel ? loadingLabel : button.dataset.defaultLabel;
    syncCardActionButtonInteractivity(button);
};

const applyCompactCardActionButtonStyle = (button) => {
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    button.style.marginLeft = '0';
    button.style.padding = '3px 8px';
    button.style.fontSize = '12px';
    button.style.flex = '0 0 auto';
    button.style.transition = 'opacity 0.2s ease, transform 0.18s ease, background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease, color 0.25s ease';

    applyCardActionButtonTheme(button);
    syncCardActionButtonInteractivity(button);
};

const resetActiveHelpDeskDraftButton = () => {
    if (!(activeHelpDeskDraftButton instanceof HTMLButtonElement)) {
        activeHelpDeskDraftButton = null;
        return;
    }

    delete activeHelpDeskDraftButton.dataset.helpdeskDraftRequestId;
    setCardActionButtonLoading(activeHelpDeskDraftButton, false);
    activeHelpDeskDraftButton = null;
};

const resetActiveCardLicenseCheckButton = () => {
    if (!(activeCardLicenseCheckButton instanceof HTMLButtonElement)) {
        activeCardLicenseCheckButton = null;
        return;
    }

    delete activeCardLicenseCheckButton.dataset.licenseCheckToken;
    setCardActionButtonLoading(activeCardLicenseCheckButton, false);
    activeCardLicenseCheckButton = null;
};

const closeCardLicenseCheckModal = () => {
    cardLicenseCheckRequestToken += 1;
    resetActiveCardLicenseCheckButton();
    if (activeBulkLicenseRun?.processing) {
        activeBulkLicenseRun.aborted = true;
    } else {
        activeBulkLicenseRun = null;
    }
    const modal = document.getElementById(CARD_LICENSE_MODAL_ID);
    modal?.remove();
};

const ensureCardLicenseModalStyles = () => {
    if (document.getElementById(CARD_LICENSE_MODAL_STYLE_ID)) {
        return;
    }

    const style = document.createElement('style');
    style.id = CARD_LICENSE_MODAL_STYLE_ID;
    style.textContent = `
        #${CARD_LICENSE_MODAL_ID} {
            --dao-license-modal-scale: 1;
            --dao-license-modal-frame-gap: 12px;
            --dao-license-modal-controls-width: 118px;
            --dao-license-modal-controls-total-width: calc(var(--dao-license-modal-controls-width) + var(--dao-license-modal-frame-gap));
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            box-sizing: border-box;
            overflow: hidden;
            background: rgba(8, 11, 18, 0.76);
            backdrop-filter: blur(8px) saturate(1.02);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__frame {
            display: flex;
            align-items: flex-start;
            gap: var(--dao-license-modal-frame-gap);
            width: min(calc(980px + var(--dao-license-modal-controls-total-width)), 100%);
            max-width: 100%;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__dialog {
            flex: 1 1 auto;
            width: min(980px, calc(100% - var(--dao-license-modal-controls-total-width)));
            max-width: calc(100% - var(--dao-license-modal-controls-total-width));
            height: min(85vh, 1080px);
            height: min(85dvh, 1080px);
            max-height: calc(100vh - 48px);
            max-height: calc(100dvh - 48px);
            min-height: 0;
            position: relative;
            isolation: isolate;
            display: flex;
            flex-direction: column;
            background: linear-gradient(180deg, #ffffff 0%, #f4f6f7 100%);
            border-radius: 22px;
            border: 1px solid rgba(148, 163, 184, 0.2);
            box-shadow: 0 34px 88px rgba(15, 23, 42, 0.32), 0 10px 24px rgba(15, 23, 42, 0.16);
            overflow: hidden;
            color: #0f172a;
            font-family: "Inter", "Segoe UI", Arial, sans-serif;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__content-shell {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            min-height: 0;
            overflow: hidden;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__content {
            position: absolute;
            inset: 0 auto auto 0;
            display: flex;
            flex-direction: column;
            width: calc(100% / var(--dao-license-modal-scale));
            min-width: calc(100% / var(--dao-license-modal-scale));
            height: calc(100% / var(--dao-license-modal-scale));
            min-height: calc(100% / var(--dao-license-modal-scale));
            transform: scale(var(--dao-license-modal-scale));
            transform-origin: top left;
            will-change: transform;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__scale-controls {
            flex: 0 0 var(--dao-license-modal-controls-width);
            min-width: var(--dao-license-modal-controls-width);
            display: inline-flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            padding: 8px;
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            background: rgba(15, 23, 42, 0.72);
            box-shadow: 0 14px 32px rgba(2, 6, 23, 0.28);
            backdrop-filter: blur(12px);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__scale-button {
            width: 32px;
            height: 32px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            background: rgba(255, 255, 255, 0.14);
            color: #f8fafc;
            font-size: 18px;
            font-weight: 700;
            line-height: 1;
            cursor: pointer;
            transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__scale-button:hover:not(:disabled) {
            transform: translateY(-1px);
            background: rgba(255, 255, 255, 0.2);
            border-color: rgba(255, 255, 255, 0.2);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__scale-button:disabled {
            cursor: default;
            opacity: 0.42;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__scale-value {
            min-width: 34px;
            color: #f8fafc;
            font-size: 12px;
            font-weight: 800;
            line-height: 1;
            text-align: center;
            letter-spacing: 0.03em;
            font-variant-numeric: tabular-nums;
            user-select: none;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__dialog::before {
            content: '';
            position: absolute;
            inset: 0;
            z-index: 0;
            pointer-events: none;
            background:
                radial-gradient(circle at top left, rgba(148, 163, 184, 0.12), transparent 26%),
                radial-gradient(circle at 85% 12%, rgba(255, 255, 255, 0.9), transparent 22%),
                linear-gradient(180deg, rgba(255, 255, 255, 0.52), rgba(255, 255, 255, 0));
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__dialog > * {
            position: relative;
            z-index: 1;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__viewport {
            flex: 1 1 auto;
            min-height: 0;
            overflow-x: hidden;
            overflow-y: auto;
            overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
            padding: 10px 14px 14px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.28), rgba(241, 245, 249, 0.18));
            scrollbar-width: thin;
            scrollbar-color: rgba(100, 116, 139, 0.34) transparent;
            touch-action: pan-y;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__viewport::-webkit-scrollbar {
            width: 10px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__viewport::-webkit-scrollbar-track {
            background: transparent;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__viewport::-webkit-scrollbar-thumb {
            background: rgba(100, 116, 139, 0.28);
            border-radius: 999px;
            border: 2px solid transparent;
            background-clip: padding-box;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__header {
            flex: 0 0 auto;
            padding: 0;
            background: transparent;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__title-row {
            display: block;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__title-wrap {
            padding: 12px 14px 0;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__title-wrap[hidden] {
            display: none;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__title {
            margin: 0;
            font-size: 18px;
            line-height: 1.2;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__subtitle {
            margin: 4px 0 0;
            color: #475569;
            font-size: 13px;
            line-height: 1.4;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__icon-button,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__button {
            border: 1px solid transparent;
            cursor: pointer;
            transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__icon-button {
            width: 34px;
            height: 34px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(227, 241, 214, 0.72));
            border-color: rgba(98, 158, 53, 0.16);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92), 0 6px 14px rgba(51, 86, 28, 0.08);
            color: #33561c;
            font-size: 18px;
            flex: 0 0 auto;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__icon-button:hover,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__button:hover {
            transform: translateY(-1px);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__icon-button:hover {
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(219, 238, 202, 0.86));
            border-color: rgba(98, 158, 53, 0.24);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.96), 0 10px 18px rgba(51, 86, 28, 0.1);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__body {
            min-height: 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-width: 0;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__panel {
            position: relative;
            overflow: hidden;
            display: grid;
            gap: 8px;
            padding: 12px;
            border-radius: 18px;
            border: 1px solid rgba(148, 163, 184, 0.16);
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.95));
            box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.92);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__panel::before {
            content: '';
            position: absolute;
            inset: 0 0 auto 0;
            height: 1px;
            background: linear-gradient(90deg, rgba(148, 163, 184, 0.44), rgba(148, 163, 184, 0));
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__overview-head,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__section-head,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__overview-heading,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__section-title,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group-title {
            margin: 0;
            font-size: 17px;
            line-height: 1.25;
            letter-spacing: 0.01em;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__overview-caption,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__section-caption {
            margin: 6px 0 0;
            color: #64748b;
            font-size: 13px;
            line-height: 1.45;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-pill,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__chip {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 8px;
            border-radius: 999px;
            border: 1px solid transparent;
            font-size: 11px;
            font-weight: 700;
            white-space: nowrap;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-pill--success {
            background: linear-gradient(180deg, rgba(98, 158, 53, 0.16), rgba(98, 158, 53, 0.1));
            border-color: rgba(98, 158, 53, 0.16);
            color: #33561c;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-pill--warning {
            background: linear-gradient(180deg, rgba(202, 138, 4, 0.16), rgba(202, 138, 4, 0.1));
            border-color: rgba(202, 138, 4, 0.18);
            color: #854d0e;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-pill--error {
            background: linear-gradient(180deg, rgba(220, 38, 38, 0.14), rgba(220, 38, 38, 0.1));
            border-color: rgba(220, 38, 38, 0.16);
            color: #dc2626;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar .dao-license-modal__status-pill {
            padding: 7px 11px;
            border-width: 1px;
            font-size: 12px;
            font-weight: 800;
            max-width: min(100%, 260px);
            justify-content: center;
            text-align: center;
            line-height: 1.35;
            letter-spacing: 0.01em;
            white-space: normal;
            box-shadow: 0 10px 18px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.16);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar .dao-license-modal__subscription-chip {
            padding: 7px 11px;
            border-width: 1px;
            font-size: 13px;
            font-weight: 800;
            max-width: min(100%, 220px);
            justify-content: center;
            text-align: center;
            line-height: 1.35;
            letter-spacing: 0.04em;
            white-space: normal;
            text-transform: uppercase;
            background: linear-gradient(180deg, rgba(96, 165, 250, 0.3), rgba(37, 99, 235, 0.18));
            border-color: rgba(191, 219, 254, 0.38);
            color: #eff6ff;
            box-shadow: 0 10px 18px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.16);
            margin-left: auto;
            margin-right: auto;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar .dao-license-modal__status-pill--success {
            background: linear-gradient(180deg, #7ac943, #5ea72f);
            border-color: rgba(154, 230, 116, 0.42);
            color: #ffffff;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar .dao-license-modal__status-pill--warning {
            background: linear-gradient(180deg, #f0b74a, #cf8a1f);
            border-color: rgba(255, 219, 128, 0.38);
            color: #ffffff;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar .dao-license-modal__status-pill--error {
            background: linear-gradient(180deg, #ef5b5b, #d53a3a);
            border-color: rgba(255, 166, 166, 0.36);
            color: #ffffff;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-note,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__error-state {
            border-radius: 14px;
            padding: 12px 14px;
            line-height: 1.5;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-note {
            position: relative;
            overflow: hidden;
            display: grid;
            gap: 6px;
            padding: 14px 16px 14px 18px;
            border-radius: 16px;
            border: 1px solid rgba(148, 163, 184, 0.18);
            box-shadow: 0 14px 28px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.65);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-note::before {
            content: '';
            position: absolute;
            inset: 0 auto 0 0;
            width: 5px;
            background: currentColor;
            opacity: 0.28;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-note--success {
            background: linear-gradient(135deg, rgba(98, 158, 53, 0.2), rgba(98, 158, 53, 0.11));
            color: #2f4f18;
            border-color: rgba(98, 158, 53, 0.2);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-note--warning {
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(245, 158, 11, 0.12));
            color: #7c3d12;
            border-color: rgba(217, 119, 6, 0.22);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-note--error {
            background: linear-gradient(135deg, rgba(239, 68, 68, 0.24), rgba(239, 68, 68, 0.12));
            color: #7f1d1d;
            border-color: rgba(220, 38, 38, 0.24);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-note-label {
            position: relative;
            margin: 0;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-note-message {
            position: relative;
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.55;
            white-space: pre-wrap;
            word-break: break-word;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__error-state {
            background: linear-gradient(180deg, rgba(220, 38, 38, 0.09), rgba(220, 38, 38, 0.05));
            color: #b91c1c;
            border: 1px solid rgba(220, 38, 38, 0.16);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__badges {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__badge {
            min-width: 0;
            position: relative;
            overflow: hidden;
            display: grid;
            gap: 5px;
            padding: 10px 12px 11px;
            border-radius: 14px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(244, 247, 249, 0.94));
            border: 1px solid rgba(148, 163, 184, 0.16);
            box-shadow: 0 8px 16px rgba(15, 23, 42, 0.04);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__badge::before {
            content: '';
            position: absolute;
            inset: 0 0 auto 0;
            height: 3px;
            background: linear-gradient(90deg, rgba(71, 85, 105, 0.8), rgba(148, 163, 184, 0.45));
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__badge-label {
            color: #64748b;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__badge-value {
            color: #1e293b;
            font-size: 13px;
            font-weight: 800;
            line-height: 1.32;
            word-break: break-word;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group-list {
            display: grid;
            gap: 10px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group {
            --dao-group-accent: #475569;
            --dao-group-soft: rgba(71, 85, 105, 0.12);
            --dao-group-border: rgba(71, 85, 105, 0.18);
            --dao-group-surface: rgba(71, 85, 105, 0.05);
            --dao-group-item-surface: rgba(71, 85, 105, 0.06);
            --dao-group-shadow: rgba(71, 85, 105, 0.08);
            display: grid;
            gap: 8px;
            padding: 10px;
            border-radius: 16px;
            border: 1px solid var(--dao-group-border);
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), var(--dao-group-surface));
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group--pos {
            --dao-group-accent: #4f7f2a;
            --dao-group-soft: rgba(98, 158, 53, 0.12);
            --dao-group-border: rgba(98, 158, 53, 0.18);
            --dao-group-surface: rgba(98, 158, 53, 0.05);
            --dao-group-item-surface: rgba(98, 158, 53, 0.06);
            --dao-group-shadow: rgba(53, 86, 28, 0.08);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group--api {
            --dao-group-accent: #2563eb;
            --dao-group-soft: rgba(37, 99, 235, 0.12);
            --dao-group-border: rgba(37, 99, 235, 0.18);
            --dao-group-surface: rgba(37, 99, 235, 0.05);
            --dao-group-item-surface: rgba(37, 99, 235, 0.06);
            --dao-group-shadow: rgba(37, 99, 235, 0.08);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group--mobile {
            --dao-group-accent: #c97316;
            --dao-group-soft: rgba(201, 115, 22, 0.12);
            --dao-group-border: rgba(201, 115, 22, 0.18);
            --dao-group-surface: rgba(201, 115, 22, 0.05);
            --dao-group-item-surface: rgba(201, 115, 22, 0.06);
            --dao-group-shadow: rgba(180, 83, 9, 0.08);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group--other {
            --dao-group-accent: #475569;
            --dao-group-soft: rgba(71, 85, 105, 0.12);
            --dao-group-border: rgba(71, 85, 105, 0.18);
            --dao-group-surface: rgba(71, 85, 105, 0.05);
            --dao-group-item-surface: rgba(71, 85, 105, 0.06);
            --dao-group-shadow: rgba(71, 85, 105, 0.08);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group-head {
            padding-bottom: 6px;
            border-bottom: 1px solid var(--dao-group-border);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group-title {
            color: var(--dao-group-accent);
            font-size: 15px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-list {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-item {
            position: relative;
            overflow: hidden;
            display: grid;
            gap: 8px;
            align-content: start;
            min-height: 0;
            padding: 10px 10px 11px;
            border-radius: 16px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.99), var(--dao-group-item-surface));
            border: 1px solid var(--dao-group-border);
            box-shadow: 0 10px 20px var(--dao-group-shadow);
            transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-item::before {
            content: '';
            position: absolute;
            inset: 0 0 auto 0;
            height: 3px;
            background: var(--dao-group-accent);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-item:hover {
            transform: translateY(-1px);
            border-color: var(--dao-group-border);
            box-shadow: 0 14px 24px var(--dao-group-shadow);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-main {
            min-width: 0;
            display: grid;
            gap: 3px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-name {
            margin: 0;
            color: #10220a;
            font-size: 14px;
            font-weight: 800;
            line-height: 1.25;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-subtitle {
            margin: 0;
            color: #607068;
            font-size: 11px;
            line-height: 1.3;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-meta {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-start;
            gap: 6px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__chip {
            background: linear-gradient(180deg, rgba(148, 163, 184, 0.14), rgba(148, 163, 184, 0.08));
            border-color: rgba(148, 163, 184, 0.16);
            color: #334155;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group .dao-license-modal__chip {
            background: linear-gradient(180deg, var(--dao-group-soft), var(--dao-group-item-surface));
            border-color: var(--dao-group-border);
            color: var(--dao-group-accent);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group .dao-license-modal__chip--count {
            padding: 6px 10px;
            background: var(--dao-group-accent);
            border-color: var(--dao-group-accent);
            color: #ffffff;
            font-weight: 800;
            box-shadow: 0 8px 16px var(--dao-group-shadow);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group .dao-license-modal__chip--date,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group .dao-license-modal__chip--permanent {
            padding: 6px 10px;
            font-weight: 800;
            letter-spacing: 0.02em;
            border-width: 1px;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group .dao-license-modal__chip--date {
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), var(--dao-group-soft));
            border-color: var(--dao-group-border);
            color: var(--dao-group-accent);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group .dao-license-modal__chip--permanent {
            background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.94));
            border-color: rgba(255, 255, 255, 0.08);
            color: #f8fafc;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar {
            position: relative;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 16px;
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.94));
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 14px 30px rgba(15, 23, 42, 0.18);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar > * {
            position: relative;
            z-index: 1;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar::before {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 42%);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-info {
            flex: 0 1 auto;
            min-width: 0;
            display: grid;
            gap: 3px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-label {
            margin: 0;
            color: rgba(226, 232, 240, 0.72);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.1em;
            text-transform: uppercase;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-value {
            display: inline-flex;
            align-items: center;
            justify-self: start;
            width: fit-content;
            max-width: 100%;
            margin: 0;
            padding: 7px 10px;
            border-radius: 12px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.08));
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
            color: #ffffff;
            font-size: 16px;
            font-weight: 800;
            line-height: 1.35;
            letter-spacing: 0.01em;
            word-break: break-word;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__state {
            justify-items: start;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__spinner {
            width: 36px;
            height: 36px;
            border-radius: 999px;
            border: 3px solid rgba(98, 158, 53, 0.18);
            border-top-color: #629e35;
            box-shadow: 0 0 0 4px rgba(98, 158, 53, 0.06);
            animation: dao-license-modal-spin 0.9s linear infinite;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__empty-state {
            padding: 14px;
            border-radius: 14px;
            background: linear-gradient(180deg, rgba(148, 163, 184, 0.1), rgba(148, 163, 184, 0.06));
            border: 1px solid rgba(148, 163, 184, 0.12);
            color: #475569;
            line-height: 1.5;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__footer {
            flex: 0 0 auto;
            display: flex;
            justify-content: flex-end;
            padding: 0 14px 14px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0), rgba(247, 248, 250, 0.92));
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__button {
            padding: 8px 14px;
            border-radius: 12px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(241, 245, 249, 0.94));
            border-color: rgba(148, 163, 184, 0.18);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 8px 16px rgba(15, 23, 42, 0.06);
            color: #334155;
            font-size: 13px;
            font-weight: 700;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__button:hover {
            background: linear-gradient(180deg, rgba(255, 255, 255, 1), rgba(236, 242, 247, 0.96));
            border-color: rgba(100, 116, 139, 0.22);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.86), 0 12px 20px rgba(15, 23, 42, 0.08);
        }

        #${CARD_LICENSE_MODAL_ID}[data-display-mode='list'] .dao-license-modal__license-list {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        #${CARD_LICENSE_MODAL_ID}[data-display-mode='list'] .dao-license-modal__license-item {
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 12px;
            padding: 12px 14px;
        }

        #${CARD_LICENSE_MODAL_ID}[data-display-mode='list'] .dao-license-modal__license-item::before {
            inset: 0 auto 0 0;
            width: 4px;
            height: auto;
        }

        #${CARD_LICENSE_MODAL_ID}[data-display-mode='list'] .dao-license-modal__license-main {
            gap: 4px;
        }

        #${CARD_LICENSE_MODAL_ID}[data-display-mode='list'] .dao-license-modal__license-meta {
            align-items: center;
            justify-content: flex-end;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-list {
            display: grid;
            gap: 12px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-header {
            display: grid;
            grid-template-columns: minmax(0, 1.9fr) minmax(210px, 1fr) minmax(160px, 0.9fr);
            gap: 12px;
            align-items: center;
            padding: 0 6px 2px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-header-cell,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-cell-label {
            color: #64748b;
            font-size: 11px;
            font-weight: 800;
            line-height: 1.2;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-cell-label {
            display: none;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-row {
            --dao-queue-accent: #d97706;
            --dao-queue-soft: rgba(217, 119, 6, 0.12);
            --dao-queue-border: rgba(217, 119, 6, 0.18);
            --dao-queue-shadow: rgba(148, 163, 184, 0.14);
            position: relative;
            overflow: hidden;
            display: grid;
            grid-template-columns: minmax(0, 1.9fr) minmax(210px, 1fr) minmax(160px, 0.9fr);
            gap: 12px;
            align-items: stretch;
            padding: 12px;
            border-radius: 18px;
            border: 1px solid rgba(148, 163, 184, 0.18);
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.94));
            box-shadow: 0 14px 28px var(--dao-queue-shadow);
            transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-row::before {
            content: '';
            position: absolute;
            inset: 0 auto 0 0;
            width: 4px;
            background: linear-gradient(180deg, var(--dao-queue-accent), color-mix(in srgb, var(--dao-queue-accent) 40%, #ffffff));
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-row:hover {
            transform: translateY(-1px);
            border-color: var(--dao-queue-border);
            box-shadow: 0 18px 34px rgba(148, 163, 184, 0.18);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-row--success {
            --dao-queue-accent: #4f7f2a;
            --dao-queue-soft: rgba(98, 158, 53, 0.12);
            --dao-queue-border: rgba(98, 158, 53, 0.2);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-row--warning {
            --dao-queue-accent: #c97316;
            --dao-queue-soft: rgba(201, 115, 22, 0.12);
            --dao-queue-border: rgba(201, 115, 22, 0.2);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-row--error {
            --dao-queue-accent: #b91c1c;
            --dao-queue-soft: rgba(220, 38, 38, 0.12);
            --dao-queue-border: rgba(220, 38, 38, 0.2);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-cell {
            min-width: 0;
            display: grid;
            gap: 8px;
            align-content: start;
            padding: 12px 14px;
            border-radius: 14px;
            border: 1px solid rgba(148, 163, 184, 0.14);
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.92));
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-cell--server {
            gap: 12px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-server {
            min-width: 0;
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            gap: 12px;
            align-items: start;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-index {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 34px;
            height: 34px;
            padding: 0 10px;
            border-radius: 999px;
            background: linear-gradient(180deg, var(--dao-queue-soft), rgba(255, 255, 255, 0.98));
            border: 1px solid var(--dao-queue-border);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
            color: var(--dao-queue-accent);
            font-size: 12px;
            font-weight: 800;
            line-height: 1;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-server-main {
            min-width: 0;
            display: grid;
            gap: 8px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-notes {
            display: grid;
            gap: 6px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-note {
            margin: 0;
            padding: 8px 10px;
            border-radius: 10px;
            border: 1px solid rgba(226, 232, 240, 0.92);
            background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(241, 245, 249, 0.92));
            color: #475569;
            font-size: 12px;
            line-height: 1.45;
            white-space: normal;
            word-break: break-word;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-meta-card {
            min-height: 100%;
            display: grid;
            gap: 10px;
            align-content: center;
            justify-items: start;
            padding: 2px 0;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-value {
            margin: 0;
            color: #10220a;
            font-size: 15px;
            font-weight: 800;
            line-height: 1.3;
            word-break: break-word;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-value--empty {
            color: #64748b;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] {
            background: rgba(2, 6, 23, 0.84);
            backdrop-filter: blur(12px) saturate(1.08);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__dialog {
            background: #0f172a;
            border-color: rgba(148, 163, 184, 0.18);
            box-shadow: 0 34px 88px rgba(2, 6, 23, 0.56), 0 10px 24px rgba(2, 6, 23, 0.36);
            color: #e2e8f0;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__dialog::before {
            background:
                radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 26%),
                radial-gradient(circle at 85% 12%, rgba(30, 41, 59, 0.72), transparent 22%),
                linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0));
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__viewport {
            background: rgba(15, 23, 42, 0.28);
            scrollbar-color: rgba(148, 163, 184, 0.3) transparent;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__viewport::-webkit-scrollbar-thumb {
            background: rgba(148, 163, 184, 0.24);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__title,
        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__overview-heading,
        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__section-title,
        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__group-title,
        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__license-name {
            color: #f8fafc;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__subtitle,
        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__overview-caption,
        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__section-caption,
        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__license-subtitle,
        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__badge-label {
            color: #94a3b8;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__panel {
            border-color: rgba(148, 163, 184, 0.16);
            background: rgba(15, 23, 42, 0.92);
            box-shadow: 0 16px 32px rgba(2, 6, 23, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__panel::before {
            background: linear-gradient(90deg, rgba(148, 163, 184, 0.34), rgba(148, 163, 184, 0));
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__badge {
            background: rgba(15, 23, 42, 0.88);
            border-color: rgba(148, 163, 184, 0.16);
            box-shadow: 0 10px 18px rgba(2, 6, 23, 0.18);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__badge::before {
            background: linear-gradient(90deg, rgba(148, 163, 184, 0.8), rgba(71, 85, 105, 0.38));
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__badge-value {
            color: #f8fafc;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__chip {
            background: rgba(30, 41, 59, 0.86);
            border-color: rgba(148, 163, 184, 0.18);
            color: #e2e8f0;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__group {
            background: rgba(15, 23, 42, 0.76);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__group--pos {
            --dao-group-accent: #86efac;
            --dao-group-soft: rgba(134, 239, 172, 0.12);
            --dao-group-border: rgba(74, 222, 128, 0.26);
            --dao-group-surface: rgba(15, 23, 42, 0.24);
            --dao-group-item-surface: rgba(15, 23, 42, 0.92);
            --dao-group-shadow: rgba(2, 6, 23, 0.24);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__group--api {
            --dao-group-accent: #93c5fd;
            --dao-group-soft: rgba(147, 197, 253, 0.12);
            --dao-group-border: rgba(96, 165, 250, 0.24);
            --dao-group-surface: rgba(15, 23, 42, 0.24);
            --dao-group-item-surface: rgba(15, 23, 42, 0.92);
            --dao-group-shadow: rgba(2, 6, 23, 0.24);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__group--mobile {
            --dao-group-accent: #fdba74;
            --dao-group-soft: rgba(253, 186, 116, 0.12);
            --dao-group-border: rgba(251, 146, 60, 0.24);
            --dao-group-surface: rgba(15, 23, 42, 0.24);
            --dao-group-item-surface: rgba(15, 23, 42, 0.92);
            --dao-group-shadow: rgba(2, 6, 23, 0.24);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__group--other {
            --dao-group-accent: #cbd5e1;
            --dao-group-soft: rgba(203, 213, 225, 0.1);
            --dao-group-border: rgba(148, 163, 184, 0.22);
            --dao-group-surface: rgba(15, 23, 42, 0.24);
            --dao-group-item-surface: rgba(15, 23, 42, 0.92);
            --dao-group-shadow: rgba(2, 6, 23, 0.24);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__license-item {
            background: rgba(15, 23, 42, 0.92);
            box-shadow: 0 10px 18px rgba(2, 6, 23, 0.22);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__license-item:hover {
            background: rgba(17, 24, 39, 0.96);
            box-shadow: 0 14px 22px rgba(2, 6, 23, 0.26);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__queue-header-cell,
        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__queue-cell-label {
            color: #94a3b8;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__queue-row {
            box-shadow: 0 16px 30px rgba(2, 6, 23, 0.26);
            border-color: rgba(148, 163, 184, 0.16);
            background: linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(15, 23, 42, 0.9));
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__queue-row:hover {
            box-shadow: 0 18px 34px rgba(2, 6, 23, 0.32);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__queue-cell {
            border-color: rgba(148, 163, 184, 0.12);
            background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.82));
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__queue-index {
            background: linear-gradient(180deg, var(--dao-queue-soft), rgba(15, 23, 42, 0.96));
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__queue-note {
            border-color: rgba(148, 163, 184, 0.12);
            background: linear-gradient(180deg, rgba(2, 6, 23, 0.54), rgba(15, 23, 42, 0.7));
            color: #cbd5e1;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__queue-value {
            color: #f8fafc;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__queue-value--empty {
            color: #94a3b8;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__group .dao-license-modal__chip {
            background: rgba(30, 41, 59, 0.9);
            color: var(--dao-group-accent);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__group .dao-license-modal__chip--count {
            background: rgba(2, 6, 23, 0.92);
            border-color: var(--dao-group-border);
            color: var(--dao-group-accent);
            box-shadow: 0 8px 16px rgba(2, 6, 23, 0.24);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__group .dao-license-modal__chip--permanent {
            background: rgba(2, 6, 23, 0.92);
            border-color: rgba(148, 163, 184, 0.16);
            color: #f8fafc;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__group .dao-license-modal__chip--date {
            background: rgba(30, 41, 59, 0.92);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__server-bar {
            border-color: rgba(148, 163, 184, 0.14);
            box-shadow: 0 16px 34px rgba(2, 6, 23, 0.42);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__server-label {
            color: rgba(226, 232, 240, 0.58);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__server-value {
            background: linear-gradient(180deg, rgba(51, 65, 85, 0.62), rgba(15, 23, 42, 0.64));
            border-color: rgba(148, 163, 184, 0.16);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__status-note {
            box-shadow: 0 14px 28px rgba(2, 6, 23, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__status-note--success {
            background: linear-gradient(135deg, rgba(20, 83, 45, 0.92), rgba(22, 101, 52, 0.76));
            color: #dcfce7;
            border-color: rgba(74, 222, 128, 0.24);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__status-note--warning {
            background: linear-gradient(135deg, rgba(120, 53, 15, 0.94), rgba(146, 64, 14, 0.78));
            color: #ffedd5;
            border-color: rgba(251, 146, 60, 0.24);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__status-note--error,
        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__error-state {
            background: linear-gradient(135deg, rgba(127, 29, 29, 0.94), rgba(153, 27, 27, 0.78));
            color: #fecaca;
            border-color: rgba(248, 113, 113, 0.24);
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__empty-state {
            background: linear-gradient(180deg, rgba(51, 65, 85, 0.42), rgba(30, 41, 59, 0.34));
            border-color: rgba(148, 163, 184, 0.16);
            color: #cbd5e1;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__footer {
            background: linear-gradient(180deg, rgba(15, 23, 42, 0), rgba(15, 23, 42, 0.92));
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__button {
            background: linear-gradient(180deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.94));
            border-color: rgba(148, 163, 184, 0.18);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 10px 18px rgba(2, 6, 23, 0.22);
            color: #e2e8f0;
        }

        #${CARD_LICENSE_MODAL_ID}[data-theme='dark'] .dao-license-modal__button:hover {
            background: linear-gradient(180deg, rgba(51, 65, 85, 0.98), rgba(15, 23, 42, 0.96));
            border-color: rgba(148, 163, 184, 0.28);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 12px 20px rgba(2, 6, 23, 0.26);
        }

        @keyframes dao-license-modal-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        @media (max-width: 960px) {
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-header {
                display: none;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-row {
                grid-template-columns: 1fr;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-cell-label {
                display: block;
            }
        }

        @media (max-width: 640px) {
            #${CARD_LICENSE_MODAL_ID} {
                padding: 12px;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__frame {
                flex-direction: column;
                align-items: stretch;
                gap: 8px;
                width: 100%;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__scale-controls {
                order: -1;
                align-self: flex-end;
                min-width: 0;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__dialog {
                width: 100%;
                max-width: 100%;
                height: min(85vh, 1080px);
                height: min(85dvh, 1080px);
                max-height: calc(100vh - 24px);
                max-height: calc(100dvh - 24px);
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__title-wrap,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__viewport,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__footer {
                padding-left: 16px;
                padding-right: 16px;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__badges,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-list {
                grid-template-columns: 1fr;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-item,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__overview-head,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__section-head,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group-head,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__title-row {
                flex-direction: column;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar .dao-license-modal__subscription-chip,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__server-bar .dao-license-modal__status-pill {
                width: 100%;
                max-width: none;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-meta {
                justify-content: flex-start;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-row {
                padding: 10px;
                gap: 10px;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-cell {
                padding: 11px 12px;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-server {
                gap: 10px;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__queue-index {
                min-width: 30px;
                height: 30px;
                padding: 0 8px;
                font-size: 11px;
            }

            #${CARD_LICENSE_MODAL_ID}[data-display-mode='list'] .dao-license-modal__license-item {
                grid-template-columns: 1fr;
            }

            #${CARD_LICENSE_MODAL_ID}[data-display-mode='list'] .dao-license-modal__license-meta {
                justify-content: flex-start;
            }
        }
    `;

    document.head.appendChild(style);
};

const createCardLicenseModalNode = (tagName, className, textContent = '') => {
    const node = document.createElement(tagName);
    if (className) {
        node.className = className;
    }
    if (textContent) {
        node.textContent = textContent;
    }
    return node;
};

const createCardLicenseModalBadge = (label, value) => {
    const badge = createCardLicenseModalNode('div', 'dao-license-modal__badge');
    badge.appendChild(createCardLicenseModalNode('span', 'dao-license-modal__badge-label', label));
    badge.appendChild(createCardLicenseModalNode('span', 'dao-license-modal__badge-value', value));
    return badge;
};

const createCardLicenseModalChip = (text, modifier = '') => {
    const className = ['dao-license-modal__chip', modifier].filter(Boolean).join(' ');
    return createCardLicenseModalNode('span', className, text);
};

const isCardCloudSubscriptionHost = (serverContext) => {
    const normalizedServer = normalizeServerHost(serverContext?.server || serverContext);
    return Boolean(normalizedServer) && normalizedServer.endsWith(CARD_CLOUD_SUBSCRIPTION_HOST_SUFFIX);
};

const normalizeCardCloudLicenseMatchValue = (value) => String(value || '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[\s\-–—_:]+/g, ' ')
    .trim();

const buildCardCloudLicenseMatchValue = (license) => {
    if (!license || typeof license !== 'object') {
        return '';
    }

    const primaryName = license.friendlyName || license.name || '';
    const secondaryName = license.friendlyName && license.name && license.name !== license.friendlyName
        ? license.name
        : '';

    return normalizeCardCloudLicenseMatchValue([primaryName, secondaryName].filter(Boolean).join(' '));
};

const hasCardCloudEnterpriseLicense = (licenses) => {
    if (!Array.isArray(licenses)) {
        return false;
    }

    const normalizedTarget = normalizeCardCloudLicenseMatchValue(CARD_CLOUD_ENTERPRISE_LICENSE_NAME);
    const requiredTokens = ['кц', 'бекофіс', 'delivery', 'callcenter'];

    return licenses.some((license) => {
        const searchableValue = buildCardCloudLicenseMatchValue(license);
        if (!searchableValue) {
            return false;
        }

        return searchableValue === normalizedTarget
            || requiredTokens.every((token) => searchableValue.includes(token));
    });
};

const resolveCardCloudSubscriptionLabel = (serverContext, licenses) => {
    if (!isCardCloudSubscriptionHost(serverContext)) {
        return '';
    }

    return hasCardCloudEnterpriseLicense(licenses)
        ? CARD_CLOUD_SUBSCRIPTION_LABELS.enterprise
        : CARD_CLOUD_SUBSCRIPTION_LABELS.pro;
};

const formatCardLicenseValidityLabel = (value) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
        return '';
    }

    return normalizedValue.toLowerCase().includes('перманент')
        ? 'ПЕРМАНЕНТНО'
        : `До ${normalizedValue}`;
};

const normalizeCardLicenseStatus = (status) => String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const formatCardLicenseBusinessStatus = (status) => {
    const normalizedStatus = normalizeCardLicenseStatus(status);
    if (!normalizedStatus) {
        return 'Статус ліцензій невідомий';
    }

    switch (normalizedStatus) {
        case 'ok':
        case 'success':
        case 'valid':
        case 'active':
            return 'Ліцензії активні';
        case 'missed':
            return 'Ліцензії не продовжені';
        case 'expired':
            return 'Ліцензії прострочені';
        case 'not_valid':
        case 'invalid':
            return 'Ліцензії невалідні';
        case 'denied':
            return 'У доступі до ліцензій відмовлено';
        case 'failed':
            return 'Перевірка ліцензій не виконана';
        case 'error':
            return 'Помилка перевірки ліцензій';
        default:
            return 'Невідомий статус ліцензій';
    }
};

const resolveCardLicenseStatusTone = (status) => {
    const normalizedStatus = normalizeCardLicenseStatus(status);
    if (!normalizedStatus) {
        return 'warning';
    }

    if (['ok', 'success', 'valid', 'active'].includes(normalizedStatus)) {
        return 'success';
    }

    if (normalizedStatus === 'missed') {
        return 'warning';
    }

    if (
        ['expired', 'not_valid', 'invalid', 'denied', 'failed', 'error'].includes(normalizedStatus) ||
        ['expired', 'invalid', 'denied', 'failed', 'error'].some((token) => normalizedStatus.includes(token))
    ) {
        return 'error';
    }

    return 'warning';
};

const buildCardLicenseStatusNote = (status, message) => {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        return null;
    }

    const tone = resolveCardLicenseStatusTone(status);
    const noteNode = createCardLicenseModalNode('div', `dao-license-modal__status-note dao-license-modal__status-note--${tone}`);
    noteNode.appendChild(
        createCardLicenseModalNode(
            'p',
            'dao-license-modal__status-note-label',
            tone === 'success' ? 'Повідомлення сервера' : 'Важливе повідомлення'
        )
    );
    noteNode.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__status-note-message', normalizedMessage));
    return noteNode;
};

const normalizeCardLicenseGroup = (groupId) => {
    const normalizedGroup = String(groupId || '').trim().toLowerCase();
    return CARD_LICENSE_GROUP_ORDER.includes(normalizedGroup) ? normalizedGroup : 'other';
};

const normalizeCardLicenseDisplayMode = (mode) => (
    mode === CARD_LICENSE_DISPLAY_MODES.list
        ? CARD_LICENSE_DISPLAY_MODES.list
        : CARD_LICENSE_DISPLAY_MODES.cards
);

const getCardLicenseDisplayModeFromStorage = async () => new Promise((resolve) => {
    chrome.storage.local.get([CARD_LICENSE_DISPLAY_MODE_STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
            resolve(CARD_LICENSE_DISPLAY_MODES.cards);
            return;
        }

        resolve(normalizeCardLicenseDisplayMode(result?.[CARD_LICENSE_DISPLAY_MODE_STORAGE_KEY]));
    });
});

const normalizeCardLicenseModalScale = (scale) => {
    const numericScale = Number(scale);
    if (!Number.isFinite(numericScale)) {
        return CARD_LICENSE_MODAL_SCALE_DEFAULT;
    }

    return CARD_LICENSE_MODAL_SCALE_STEPS.reduce((closestScale, candidateScale) => (
        Math.abs(candidateScale - numericScale) < Math.abs(closestScale - numericScale)
            ? candidateScale
            : closestScale
    ), CARD_LICENSE_MODAL_SCALE_DEFAULT);
};

const getCardLicenseModalScaleFromStorage = async () => new Promise((resolve) => {
    chrome.storage.local.get([CARD_LICENSE_MODAL_SCALE_STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
            resolve(CARD_LICENSE_MODAL_SCALE_DEFAULT);
            return;
        }

        resolve(normalizeCardLicenseModalScale(result?.[CARD_LICENSE_MODAL_SCALE_STORAGE_KEY]));
    });
});

const setCardLicenseModalScaleInStorage = async (scale) => new Promise((resolve) => {
    const normalizedScale = normalizeCardLicenseModalScale(scale);
    chrome.storage.local.set({ [CARD_LICENSE_MODAL_SCALE_STORAGE_KEY]: normalizedScale }, () => {
        resolve(normalizedScale);
    });
});

const syncCardLicenseModalScaleControls = (modal = document.getElementById(CARD_LICENSE_MODAL_ID), scale = cardLicenseModalScaleValue) => {
    if (!(modal instanceof HTMLElement)) {
        return;
    }

    const normalizedScale = normalizeCardLicenseModalScale(scale);
    const scaleValueNode = modal.querySelector('[data-role="scale-value"]');
    const scaleDownNode = modal.querySelector('[data-role="scale-down"]');
    const scaleUpNode = modal.querySelector('[data-role="scale-up"]');
    const minScale = CARD_LICENSE_MODAL_SCALE_STEPS[0];
    const maxScale = CARD_LICENSE_MODAL_SCALE_STEPS[CARD_LICENSE_MODAL_SCALE_STEPS.length - 1];

    if (scaleValueNode) {
        scaleValueNode.textContent = `${normalizedScale}%`;
    }

    if (scaleDownNode instanceof HTMLButtonElement) {
        scaleDownNode.disabled = normalizedScale <= minScale;
    }

    if (scaleUpNode instanceof HTMLButtonElement) {
        scaleUpNode.disabled = normalizedScale >= maxScale;
    }
};

const applyCardLicenseModalScale = (modal = document.getElementById(CARD_LICENSE_MODAL_ID), scale = cardLicenseModalScaleValue) => {
    if (!(modal instanceof HTMLElement)) {
        return;
    }

    const normalizedScale = normalizeCardLicenseModalScale(scale);
    cardLicenseModalScaleValue = normalizedScale;
    modal.dataset.scale = String(normalizedScale);
    modal.style.setProperty('--dao-license-modal-scale', String(normalizedScale / 100));
    syncCardLicenseModalScaleControls(modal, normalizedScale);
};

const ensureCardLicenseModalScaleLoaded = () => {
    if (!cardLicenseModalScaleLoadPromise) {
        cardLicenseModalScaleLoadPromise = getCardLicenseModalScaleFromStorage().then((scale) => {
            applyCardLicenseModalScale(document.getElementById(CARD_LICENSE_MODAL_ID), scale);
            return scale;
        });
    }

    return cardLicenseModalScaleLoadPromise;
};

const stepCardLicenseModalScale = async (direction, modal = document.getElementById(CARD_LICENSE_MODAL_ID)) => {
    if (!(modal instanceof HTMLElement)) {
        return;
    }

    const normalizedScale = normalizeCardLicenseModalScale(cardLicenseModalScaleValue);
    const currentIndex = CARD_LICENSE_MODAL_SCALE_STEPS.indexOf(normalizedScale);
    const nextIndex = Math.min(
        Math.max(currentIndex + direction, 0),
        CARD_LICENSE_MODAL_SCALE_STEPS.length - 1
    );
    const nextScale = CARD_LICENSE_MODAL_SCALE_STEPS[nextIndex];

    if (nextScale === normalizedScale) {
        syncCardLicenseModalScaleControls(modal, normalizedScale);
        return;
    }

    applyCardLicenseModalScale(modal, nextScale);
    await setCardLicenseModalScaleInStorage(nextScale);
};

const buildCardLicenseOverviewPanel = (serverContext, serverInfo, licenses) => {
    const statusTone = resolveCardLicenseStatusTone(serverInfo.licenseStatus);
    const statusText = formatCardLicenseBusinessStatus(serverInfo.licenseStatus);
    const subscriptionLabel = resolveCardCloudSubscriptionLabel(serverContext, licenses);
    const statusPillNode = createCardLicenseModalNode(
        'span',
        `dao-license-modal__status-pill dao-license-modal__status-pill--${statusTone}`,
        statusText
    );

    const overviewPanel = createCardLicenseModalNode('section', 'dao-license-modal__panel');
    const serverBar = createCardLicenseModalNode('div', 'dao-license-modal__server-bar');
    const serverInfoNode = createCardLicenseModalNode('div', 'dao-license-modal__server-info');
    serverInfoNode.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__server-label', 'Адреса сервера'));
    serverInfoNode.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__server-value', formatCardServerContextLabel(serverContext)));
    serverBar.appendChild(serverInfoNode);
    if (subscriptionLabel) {
        serverBar.appendChild(createCardLicenseModalChip(subscriptionLabel, 'dao-license-modal__subscription-chip'));
    }
    serverBar.appendChild(statusPillNode);
    overviewPanel.appendChild(serverBar);

    const statusNote = buildCardLicenseStatusNote(serverInfo.licenseStatus, serverInfo.statusMessage);
    if (statusNote) {
        overviewPanel.appendChild(statusNote);
    }

    const badgeContainer = createCardLicenseModalNode('div', 'dao-license-modal__badges');
    if (serverInfo.companyName) {
        badgeContainer.appendChild(createCardLicenseModalBadge('Компанія', serverInfo.companyName));
    }
    if (serverInfo.serverType) {
        badgeContainer.appendChild(createCardLicenseModalBadge('Тип', serverInfo.serverType));
    }
    if (serverInfo.serialNumber) {
        badgeContainer.appendChild(createCardLicenseModalBadge('Serial', serverInfo.serialNumber));
    }
    if (serverInfo.crmId) {
        badgeContainer.appendChild(createCardLicenseModalBadge('CRM ID', serverInfo.crmId));
    }
    if (badgeContainer.childElementCount > 0) {
        overviewPanel.appendChild(badgeContainer);
    }

    return overviewPanel;
};

const buildCardLicenseIdentity = (license) => {
    const primaryName = license?.friendlyName || license?.name || `Ліцензія ${license?.id || ''}`.trim();
    const secondaryParts = [];

    if (license?.friendlyName && license?.name && license.name !== license.friendlyName) {
        secondaryParts.push(license.name);
    }

    return {
        primaryName,
        secondaryText: secondaryParts.join(' • ')
    };
};

const buildCardLicenseMetaNode = (license) => {
    const meta = createCardLicenseModalNode('div', 'dao-license-modal__license-meta');
    if (license?.count !== null && license?.count !== undefined) {
        meta.appendChild(createCardLicenseModalChip(`${license.count} шт.`, 'dao-license-modal__chip--count'));
    }
    if (license?.validUntil) {
        const validityLabel = formatCardLicenseValidityLabel(license.validUntil);
        const validityModifier = validityLabel === 'ПЕРМАНЕНТНО'
            ? 'dao-license-modal__chip--permanent'
            : 'dao-license-modal__chip--date';
        meta.appendChild(createCardLicenseModalChip(validityLabel, validityModifier));
    }
    if (!meta.childElementCount) {
        meta.appendChild(createCardLicenseModalChip('Без деталей'));
    }

    return meta;
};

const buildCardLicenseItemNode = (license) => {
    const { primaryName, secondaryText } = buildCardLicenseIdentity(license);
    const item = createCardLicenseModalNode('article', 'dao-license-modal__license-item');
    const main = createCardLicenseModalNode('div', 'dao-license-modal__license-main');

    main.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__license-name', primaryName));
    if (secondaryText) {
        main.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__license-subtitle', secondaryText));
    }

    item.appendChild(main);
    item.appendChild(buildCardLicenseMetaNode(license));
    return item;
};

const buildCardLicenseGroupNode = (groupId, groupLicenses) => {
    const groupNode = createCardLicenseModalNode('section', `dao-license-modal__group dao-license-modal__group--${groupId}`);
    const groupHead = createCardLicenseModalNode('div', 'dao-license-modal__group-head');
    groupHead.appendChild(createCardLicenseModalNode('h4', 'dao-license-modal__group-title', CARD_LICENSE_GROUP_LABELS[groupId] || CARD_LICENSE_GROUP_LABELS.other));
    groupHead.appendChild(createCardLicenseModalChip(`${groupLicenses.length}`));
    groupNode.appendChild(groupHead);

    const licenseList = createCardLicenseModalNode('div', 'dao-license-modal__license-list');
    groupLicenses.forEach((license) => {
        licenseList.appendChild(buildCardLicenseItemNode(license));
    });

    groupNode.appendChild(licenseList);
    return groupNode;
};

const buildCardLicenseGroupList = (licenses) => {
    const groupedLicenses = new Map(CARD_LICENSE_GROUP_ORDER.map((groupId) => [groupId, []]));
    licenses.forEach((license) => {
        groupedLicenses.get(normalizeCardLicenseGroup(license.groupId)).push(license);
    });

    const groupList = createCardLicenseModalNode('div', 'dao-license-modal__group-list');
    CARD_LICENSE_GROUP_ORDER.forEach((groupId) => {
        const groupLicenses = groupedLicenses.get(groupId) || [];
        if (!groupLicenses.length) {
            return;
        }

        groupList.appendChild(buildCardLicenseGroupNode(groupId, groupLicenses));
    });

    return groupList;
};

const applyCardLicenseModalTheme = (modal = document.getElementById(CARD_LICENSE_MODAL_ID)) => {
    if (!(modal instanceof HTMLElement)) {
        return;
    }

    modal.dataset.theme = isPlanfixDarkTheme() ? 'dark' : 'light';
};

const ensureCardLicenseModalThemeObserver = () => {
    if (cardLicenseModalThemeObserver || !document.body) {
        return;
    }

    cardLicenseModalThemeObserver = new MutationObserver((mutations) => {
        const hasThemeClassChange = mutations.some((mutation) => (
            mutation.type === 'attributes' && mutation.attributeName === 'class'
        ));

        if (hasThemeClassChange) {
            applyCardLicenseModalTheme();
        }
    });

    cardLicenseModalThemeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
    });
};

const ensureCardLicenseModalShell = () => {
    ensureCardLicenseModalStyles();
    ensureCardLicenseModalThemeObserver();

    let modal = document.getElementById(CARD_LICENSE_MODAL_ID);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = CARD_LICENSE_MODAL_ID;
        modal.innerHTML = `
            <div class="dao-license-modal__frame">
                <div class="dao-license-modal__dialog" role="dialog" aria-modal="true" aria-label="Ліцензії Syrve">
                    <div class="dao-license-modal__content-shell">
                        <div class="dao-license-modal__content" data-role="content">
                            <div class="dao-license-modal__header">
                                <div class="dao-license-modal__title-row">
                                    <div class="dao-license-modal__title-wrap" data-role="title-wrap" hidden>
                                        <h2 id="dao-license-modal-title" class="dao-license-modal__title" data-role="title"></h2>
                                        <p class="dao-license-modal__subtitle" data-role="subtitle"></p>
                                    </div>
                                </div>
                            </div>
                            <div class="dao-license-modal__viewport" data-role="viewport">
                                <div class="dao-license-modal__body" data-role="body"></div>
                            </div>
                            <div class="dao-license-modal__footer">
                                <button type="button" class="dao-license-modal__button" data-role="close">Закрити</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="dao-license-modal__scale-controls" aria-label="Масштаб вмісту модального вікна">
                    <button type="button" class="dao-license-modal__scale-button" data-role="scale-down" aria-label="Зменшити вміст модального вікна">−</button>
                    <span class="dao-license-modal__scale-value" data-role="scale-value" aria-live="polite">100%</span>
                    <button type="button" class="dao-license-modal__scale-button" data-role="scale-up" aria-label="Збільшити вміст модального вікна">+</button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeCardLicenseCheckModal();
            }
        });

        modal.querySelectorAll('[data-role="close"]').forEach((node) => {
            node.addEventListener('click', () => {
                closeCardLicenseCheckModal();
            });
        });

        modal.querySelector('[data-role="scale-down"]')?.addEventListener('click', (event) => {
            event.stopPropagation();
            void stepCardLicenseModalScale(-1, modal);
        });

        modal.querySelector('[data-role="scale-up"]')?.addEventListener('click', (event) => {
            event.stopPropagation();
            void stepCardLicenseModalScale(1, modal);
        });

        document.body.appendChild(modal);
    }

    applyCardLicenseModalTheme(modal);
    applyCardLicenseModalScale(modal, cardLicenseModalScaleValue);
    void ensureCardLicenseModalScaleLoaded();

    return {
        modal,
        titleWrapNode: modal.querySelector('[data-role="title-wrap"]'),
        titleNode: modal.querySelector('[data-role="title"]'),
        subtitleNode: modal.querySelector('[data-role="subtitle"]'),
        viewportNode: modal.querySelector('[data-role="viewport"]'),
        bodyNode: modal.querySelector('[data-role="body"]'),
        closeNode: modal.querySelector('[data-role="close"]')
    };
};

const renderCardLicenseModal = ({ title, subtitle, content, displayMode = CARD_LICENSE_DISPLAY_MODES.cards }) => {
    const { modal, titleWrapNode, titleNode, subtitleNode, viewportNode, bodyNode, closeNode } = ensureCardLicenseModalShell();
    const hasTitle = Boolean(title);
    const hasSubtitle = Boolean(subtitle);
    const resolvedDisplayMode = normalizeCardLicenseDisplayMode(displayMode);

    modal.dataset.displayMode = resolvedDisplayMode;
    titleNode.textContent = title || '';
    subtitleNode.textContent = subtitle || '';
    subtitleNode.style.display = hasSubtitle ? 'block' : 'none';
    titleWrapNode.hidden = !(hasTitle || hasSubtitle);
    bodyNode.replaceChildren(content);
    if (viewportNode) {
        viewportNode.scrollTop = 0;
    }

    queueMicrotask(() => {
        closeNode?.focus({ preventScroll: true });
    });
};

const buildCardLicenseLoadingContent = () => {
    const panel = createCardLicenseModalNode('section', 'dao-license-modal__panel dao-license-modal__state');
    panel.appendChild(createCardLicenseModalNode('div', 'dao-license-modal__spinner'));
    panel.appendChild(createCardLicenseModalNode('h3', 'dao-license-modal__section-title', 'Перевіряємо ліцензії...'));
    panel.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__section-caption', 'Запит виконується через ваш сервер. Це може зайняти кілька секунд.'));
    return panel;
};

const buildCardLicenseErrorContent = (errorMessage) => {
    const panel = createCardLicenseModalNode('section', 'dao-license-modal__panel');
    panel.appendChild(createCardLicenseModalNode('h3', 'dao-license-modal__section-title', 'Не вдалося отримати стан ліцензій'));

    const errorNode = createCardLicenseModalNode('div', 'dao-license-modal__error-state');
    errorNode.appendChild(createCardLicenseModalNode('strong', '', 'Щось пішло не так.'));
    errorNode.appendChild(createCardLicenseModalNode('p', '', errorMessage || 'Невідома помилка перевірки ліцензій.'));
    panel.appendChild(errorNode);

    return panel;
};

const buildCardLicenseResultContent = (serverContext, licenseResult) => {
    const fragment = document.createDocumentFragment();
    const serverInfo = licenseResult?.server && typeof licenseResult.server === 'object' ? licenseResult.server : {};
    const licenses = Array.isArray(licenseResult?.licenses) ? licenseResult.licenses : [];
    fragment.appendChild(buildCardLicenseOverviewPanel(serverContext, serverInfo, licenses));

    const licensesPanel = createCardLicenseModalNode('section', 'dao-license-modal__panel');

    if (!licenses.length) {
        licensesPanel.appendChild(createCardLicenseModalNode('div', 'dao-license-modal__empty-state', 'Сервер відповів без списку ліцензій.'));
        fragment.appendChild(licensesPanel);
        return fragment;
    }

    licensesPanel.appendChild(buildCardLicenseGroupList(licenses));
    fragment.appendChild(licensesPanel);
    return fragment;
};

const showCardLicenseLoadingModal = (serverContext) => {
    renderCardLicenseModal({
        title: '',
        subtitle: '',
        content: buildCardLicenseLoadingContent()
    });
};

const showCardLicenseErrorModal = (serverContext, errorMessage, displayMode) => {
    renderCardLicenseModal({
        title: '',
        subtitle: '',
        displayMode,
        content: buildCardLicenseErrorContent(errorMessage)
    });
};

const showCardLicenseResultModal = (serverContext, licenseResult, displayMode) => {
    renderCardLicenseModal({
        title: '',
        subtitle: '',
        displayMode,
        content: buildCardLicenseResultContent(serverContext, licenseResult)
    });
};

const requestCardLicenseCheck = (context) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
        action: 'CHECK_SYRVE_LICENSE',
        address: context?.server,
        port: context?.port
    }, (response) => {
        if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
        }

        if (!response?.ok) {
            reject(new Error(response?.error || 'Невідома помилка перевірки ліцензій.'));
            return;
        }

        resolve(response);
    });
});

const requestCardLicenseUpdate = (context, options = {}) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
        action: 'UPDATE_SYRVE_LICENSE',
        address: context?.server,
        port: context?.port,
        batchId: options?.batchId || null,
        serialNumber: options?.serialNumber || null
    }, (response) => {
        if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
        }

        if (!response?.ok) {
            reject(new Error(response?.error || 'Невідома помилка оновлення ліцензій.'));
            return;
        }

        resolve(response);
    });
});

const createBulkLicenseBatchId = () => {
    if (typeof crypto?.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const resolveBulkLicenseQueueItemTone = (item) => {
    if (!item || item.state === 'idle') {
        return 'warning';
    }

    if (item.state === 'processing') {
        return 'warning';
    }

    if (item.state === 'success') {
        return 'success';
    }

    if (item.state === 'warning') {
        return 'warning';
    }

    return 'error';
};

const formatBulkLicenseQueueItemStateLabel = (action, item) => {
    if (!item) {
        return 'Очікує';
    }

    if (item.state === 'processing') {
        return action === BULK_LICENSE_ACTIONS.update ? 'Оновлюємо' : 'Перевіряємо';
    }

    if (item.state === 'success') {
        return action === BULK_LICENSE_ACTIONS.update ? 'Готово' : 'Перевірено';
    }

    if (item.state === 'warning') {
        return 'Увага';
    }

    if (item.state === 'error') {
        return 'Помилка';
    }

    return 'Очікує';
};

const BULK_LICENSE_RESULT_LABELS = Object.freeze({
    SUCCESS: 'Ліцензії активні',
    OK: 'Ліцензії активні',
    ACTIVE: 'Ліцензії активні',
    EXPIRED: 'Ліцензії прострочені',
    NOT_VALID: 'Ліцензії невалідні',
    INVALID: 'Ліцензії невалідні',
    MISSED: 'Ліцензії не продовжено',
    UPDATED_CONFIRMED: 'Оновлення підтверджено',
    UPDATED_PARTIAL: 'Оновлення виконано частково',
    UPDATED_NOT_CONFIRMED: 'Оновлення ще не підтверджено',
    MANUAL_SERIAL_REQUIRED: 'Потрібен ручний UID',
    MANUAL_SERIAL_CANCELLED: 'Введення UID скасовано',
    HTTP_ERROR: 'Сервер тимчасово недоступний',
    TRANSPORT_ERROR: 'Сервер недоступний',
    AUTH_ERROR: 'Помилка авторизації',
    XML_RESPONSE_ERROR: 'Сервер повернув помилку',
    XML_PARSE_ERROR: 'Не вдалося обробити відповідь сервера',
    REQUEST_FORMAT_ERROR: 'Некоректний формат запиту',
    BUSINESS_STATUS_UNKNOWN: 'Потрібна ручна перевірка',
    UNKNOWN_ERROR: 'Невідома помилка',
    CHECK_OK: 'Перевірку виконано',
    LICENSE_STATUS_EXPIRED: 'Ліцензії прострочені',
    LICENSE_STATUS_NOT_VALID: 'Ліцензії невалідні'
});

const BULK_LICENSE_OUTCOME_LABELS = Object.freeze({
    success: 'Успішно',
    'not-updated': 'Без підтвердження',
    'manual-check': 'Потрібна перевірка',
    'server-unavailable': 'Сервер недоступний',
    error: 'Помилка',
    warning: 'Увага'
});

const formatBulkLicenseResultLabel = (item) => {
    const normalizedCode = String(item?.resultCode || '').trim().toUpperCase();
    if (normalizedCode && BULK_LICENSE_RESULT_LABELS[normalizedCode]) {
        return BULK_LICENSE_RESULT_LABELS[normalizedCode];
    }

    const normalizedOutcome = String(item?.outcome || '').trim().toLowerCase();
    if (normalizedOutcome && BULK_LICENSE_OUTCOME_LABELS[normalizedOutcome]) {
        return BULK_LICENSE_OUTCOME_LABELS[normalizedOutcome];
    }

    if (item?.state === 'success') {
        return 'Успішно';
    }

    if (item?.state === 'processing') {
        return 'Обробка триває';
    }

    if (item?.state === 'warning') {
        return 'Потрібна увага';
    }

    if (item?.state === 'error') {
        return 'Помилка';
    }

    return 'Очікує обробки';
};

const formatBulkLicenseProcessedAtLabel = (value) => {
    if (!value) {
        return 'Ще не оброблено';
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
        return 'Ще не оброблено';
    }

    return parsedDate.toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const formatBulkLicenseValidityChip = (value) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
        return '';
    }

    return normalizedValue.toLowerCase().includes('перманент')
        ? 'Перманентно'
        : `До ${normalizedValue}`;
};

const buildBulkLicenseValiditySummary = (item) => {
    const normalizedValiditySummary = String(item?.validitySummary || '').trim();
    if (normalizedValiditySummary) {
        return normalizedValiditySummary;
    }

    return '—';
};

const buildBulkLicenseDiffSummaryLabel = (diffSummary) => {
    if (!diffSummary || typeof diffSummary !== 'object') {
        return '';
    }

    const parts = [];
    if ((diffSummary.newLicenses || 0) > 0) {
        parts.push(`нових: ${diffSummary.newLicenses}`);
    }
    if ((diffSummary.changedValidUntil || 0) > 0) {
        parts.push(`дат: ${diffSummary.changedValidUntil}`);
    }
    if ((diffSummary.changedCount || 0) > 0) {
        parts.push(`кількості: ${diffSummary.changedCount}`);
    }

    return parts.join(' • ');
};

const resolveBulkLicenseValidityFromLicenses = (licenses, keyName) => {
    const validityValues = Array.isArray(licenses)
        ? [...new Set(licenses.map((license) => String(license?.[keyName] || '').trim()).filter(Boolean))]
        : [];

    if (!validityValues.length) {
        return '';
    }

    return formatBulkLicenseValidityChip(validityValues[0]);
};

const resolveBulkLicenseUpdateValiditySummary = (response) => {
    const directAfterSummary = formatBulkLicenseValidityChip(response?.targetValidUntilAfter);
    if (directAfterSummary) {
        return directAfterSummary;
    }

    const updatedTargetLicenses = Array.isArray(response?.updatedTargetLicenses) ? response.updatedTargetLicenses : [];
    const updatedAfterSummary = resolveBulkLicenseValidityFromLicenses(updatedTargetLicenses, 'validUntilAfter');
    if (updatedAfterSummary) {
        return updatedAfterSummary;
    }

    const directBeforeSummary = formatBulkLicenseValidityChip(response?.targetValidUntilBefore);
    if (directBeforeSummary) {
        return directBeforeSummary;
    }

    return resolveBulkLicenseValidityFromLicenses(updatedTargetLicenses, 'validUntilBefore');
};

const stampBulkLicenseItem = (item) => {
    item.updatedAt = new Date().toISOString();
};

const buildBulkLicenseQueueStats = (run) => run.items.reduce((stats, item) => {
    stats.total += 1;
    if (item.state === 'success') {
        stats.success += 1;
    } else if (item.state === 'warning') {
        stats.warning += 1;
    } else if (item.state === 'error') {
        stats.error += 1;
    } else if (item.state === 'processing') {
        stats.processing += 1;
    } else {
        stats.idle += 1;
    }

    return stats;
}, {
    total: 0,
    success: 0,
    warning: 0,
    error: 0,
    processing: 0,
    idle: 0
});

const buildBulkLicenseQueueContent = (run) => {
    const fragment = document.createDocumentFragment();
    const stats = buildBulkLicenseQueueStats(run);
    const summaryPanel = createCardLicenseModalNode('section', 'dao-license-modal__panel');
    summaryPanel.appendChild(
        createCardLicenseModalNode(
            'h3',
            'dao-license-modal__section-title',
            run.action === BULK_LICENSE_ACTIONS.update ? 'Масове оновлення ліцензій' : 'Масова перевірка ліцензій'
        )
    );
    summaryPanel.appendChild(
        createCardLicenseModalNode(
            'p',
            'dao-license-modal__section-caption',
            run.processing
                ? 'Результати з’являються по мірі обробки кожного сервера.'
                : run.aborted
                    ? 'Чергу зупинено до завершення всіх серверів.'
                    : 'Обробку завершено. Підсумок нижче.'
        )
    );

    const badgeContainer = createCardLicenseModalNode('div', 'dao-license-modal__badges');
    badgeContainer.appendChild(createCardLicenseModalBadge('Усього', String(stats.total)));
    badgeContainer.appendChild(createCardLicenseModalBadge('Готово', String(stats.success)));
    badgeContainer.appendChild(createCardLicenseModalBadge('Увага', String(stats.warning)));
    badgeContainer.appendChild(createCardLicenseModalBadge('Помилки', String(stats.error)));
    if (stats.processing > 0) {
        badgeContainer.appendChild(createCardLicenseModalBadge('Зараз', String(stats.processing)));
    }
    summaryPanel.appendChild(badgeContainer);
    fragment.appendChild(summaryPanel);

    if (run.globalError) {
        const note = buildCardLicenseStatusNote('error', run.globalError);
        if (note) {
            fragment.appendChild(note);
        }
    }

    const listPanel = createCardLicenseModalNode('section', 'dao-license-modal__panel');
    listPanel.appendChild(createCardLicenseModalNode('h3', 'dao-license-modal__section-title', 'Сервери'));
    listPanel.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__section-caption', run.sourceLabel));

    if (!run.items.length) {
        listPanel.appendChild(createCardLicenseModalNode('div', 'dao-license-modal__empty-state', 'Немає серверів для обробки.'));
        fragment.appendChild(listPanel);
        return fragment;
    }

    const headerRow = createCardLicenseModalNode('div', 'dao-license-modal__queue-header');
    ['Сервер', 'Результат', 'Термін'].forEach((label) => {
        headerRow.appendChild(createCardLicenseModalNode('span', 'dao-license-modal__queue-header-cell', label));
    });
    listPanel.appendChild(headerRow);

    const listNode = createCardLicenseModalNode('div', 'dao-license-modal__queue-list');

    run.items.forEach((item, index) => {
        const itemTone = resolveBulkLicenseQueueItemTone(item);
        const resultLabel = formatBulkLicenseResultLabel(item);
        const normalizedMessage = String(item?.message || '').trim();
        const normalizedDetails = String(item?.details || '').trim();
        const shouldRenderMessage = Boolean(normalizedMessage) && normalizedMessage !== resultLabel;
        const shouldRenderDetails = Boolean(normalizedDetails)
            && normalizedDetails !== resultLabel
            && normalizedDetails !== normalizedMessage
            && normalizedDetails !== 'Операцію завершено без додаткових деталей.';
        const row = createCardLicenseModalNode('article', `dao-license-modal__queue-row dao-license-modal__queue-row--${itemTone}`);

        const main = createCardLicenseModalNode('div', 'dao-license-modal__queue-cell dao-license-modal__queue-cell--server');
        main.appendChild(createCardLicenseModalNode('span', 'dao-license-modal__queue-cell-label', 'Сервер'));

        const serverContent = createCardLicenseModalNode('div', 'dao-license-modal__queue-server');
        serverContent.appendChild(createCardLicenseModalNode('span', 'dao-license-modal__queue-index', String(index + 1)));

        const serverMain = createCardLicenseModalNode('div', 'dao-license-modal__queue-server-main');
        serverMain.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__license-name', item.label));

        const notes = createCardLicenseModalNode('div', 'dao-license-modal__queue-notes');
        if (shouldRenderMessage) {
            notes.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__queue-note', normalizedMessage));
        }
        if (shouldRenderDetails) {
            notes.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__queue-note', normalizedDetails));
        }
        if (notes.childElementCount) {
            serverMain.appendChild(notes);
        }
        serverContent.appendChild(serverMain);
        main.appendChild(serverContent);

        const resultCell = createCardLicenseModalNode('div', 'dao-license-modal__queue-cell');
        resultCell.appendChild(createCardLicenseModalNode('span', 'dao-license-modal__queue-cell-label', 'Результат'));
        const resultMeta = createCardLicenseModalNode('div', 'dao-license-modal__queue-meta-card');
        resultMeta.appendChild(
            createCardLicenseModalNode(
                'span',
                `dao-license-modal__status-pill dao-license-modal__status-pill--${itemTone}`,
                resultLabel
            )
        );
        resultCell.appendChild(resultMeta);

        const licenseCell = createCardLicenseModalNode('div', 'dao-license-modal__queue-cell');
        licenseCell.appendChild(createCardLicenseModalNode('span', 'dao-license-modal__queue-cell-label', 'Термін'));
        const licenseMeta = createCardLicenseModalNode('div', 'dao-license-modal__queue-meta-card');
        const validitySummary = buildBulkLicenseValiditySummary(item);
        const licenseValueNode = createCardLicenseModalNode('p', 'dao-license-modal__queue-value', validitySummary);
        if (validitySummary === '—') {
            licenseValueNode.classList.add('dao-license-modal__queue-value--empty');
        }
        licenseMeta.appendChild(licenseValueNode);
        licenseCell.appendChild(licenseMeta);

        row.appendChild(main);
        row.appendChild(resultCell);
        row.appendChild(licenseCell);
        listNode.appendChild(row);
    });

    listPanel.appendChild(listNode);
    fragment.appendChild(listPanel);
    return fragment;
};

const renderBulkLicenseQueueModal = (run) => {
    const subtitleParts = [run.sourceLabel, `${run.items.length} серверів`];
    if (run.batchId) {
        subtitleParts.push(`Batch ${run.batchId.slice(0, 8)}`);
    }

    renderCardLicenseModal({
        title: run.action === BULK_LICENSE_ACTIONS.update ? 'Масове оновлення ліцензій' : 'Масова перевірка ліцензій',
        subtitle: subtitleParts.join(' • '),
        content: buildBulkLicenseQueueContent(run),
        displayMode: CARD_LICENSE_DISPLAY_MODES.list
    });
};

const applyBulkLicenseCheckItemResult = (item, response) => {
    const licenseResult = response?.result && typeof response.result === 'object' ? response.result : {};
    const serverInfo = licenseResult.server && typeof licenseResult.server === 'object' ? licenseResult.server : {};
    const licenses = Array.isArray(licenseResult.licenses) ? licenseResult.licenses : [];
    const tone = resolveCardLicenseStatusTone(serverInfo.licenseStatus);

    item.state = tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'error';
    item.resultCode = normalizeCardLicenseStatus(serverInfo.licenseStatus).toUpperCase();
    item.outcome = tone;
    item.updatedTargetCount = licenses.length;
    item.message = formatCardLicenseBusinessStatus(serverInfo.licenseStatus);
    item.details = serverInfo.statusMessage || (licenses.length ? `Знайдено ліцензій: ${licenses.length}` : 'Список ліцензій порожній.');
    item.validitySummary = resolveBulkLicenseValidityFromLicenses(licenses, 'validUntil');
    item.diffSummaryLabel = '';
    stampBulkLicenseItem(item);
};

const resolveBulkLicenseUpdateItemState = (response) => {
    if (response?.resultCode === 'UPDATED_CONFIRMED' || response?.outcome === 'success') {
        return 'success';
    }

    if (response?.outcome === 'warning' || response?.resultCode === 'UPDATED_NOT_CONFIRMED') {
        return 'warning';
    }

    if (response?.resultCode === 'MANUAL_SERIAL_REQUIRED') {
        return 'warning';
    }

    return 'error';
};

const buildBulkLicenseUpdateDetails = (response) => {
    if (response?.statusMessage) {
        return response.statusMessage;
    }

    const diffSummaryLabel = buildBulkLicenseDiffSummaryLabel(response?.diffSummary);
    if (diffSummaryLabel) {
        return diffSummaryLabel;
    }

    if (response?.resultCode === 'UPDATED_NOT_CONFIRMED' && resolveBulkLicenseUpdateValiditySummary(response)) {
        return 'Показано останній підтверджений термін.';
    }

    return '';
};

const applyBulkLicenseUpdateItemResult = (item, response) => {
    const updatedTargetLicenses = Array.isArray(response?.updatedTargetLicenses) ? response.updatedTargetLicenses : [];

    item.state = resolveBulkLicenseUpdateItemState(response);
    item.resultCode = response?.resultCode || '';
    item.outcome = response?.outcome || '';
    item.updatedTargetCount = updatedTargetLicenses.length;
    item.message = formatBulkLicenseResultLabel({
        resultCode: response?.resultCode,
        outcome: response?.outcome,
        state: item.state,
    });
    item.details = buildBulkLicenseUpdateDetails(response);
    item.validitySummary = resolveBulkLicenseUpdateValiditySummary(response);
    item.diffSummaryLabel = buildBulkLicenseDiffSummaryLabel(response?.diffSummary);
    stampBulkLicenseItem(item);
};

const promptBulkLicenseSerialNumber = (item, response) => {
    const baseMessage = response?.statusMessage || 'Сервер вимагає ручний UID/serial для оновлення ліцензії.';

    while (true) {
        const enteredValue = window.prompt(`${baseMessage}\n\n${item.label}\nВведіть UID/serial:`, item.serialNumber || '');
        if (enteredValue === null) {
            return null;
        }

        const normalizedValue = enteredValue.trim();
        if (normalizedValue) {
            return normalizedValue;
        }
    }
};

const normalizeBulkLicenseModeFormat = (value) => {
    return String(value || '').trim().toLowerCase() === BULK_LICENSE_MODE_FORMATS.inline
        ? BULK_LICENSE_MODE_FORMATS.inline
        : BULK_LICENSE_MODE_FORMATS.legacy;
};

const openLegacyBulkLicenseManager = ({ action, targets }) => {
    const servers = Array.isArray(targets)
        ? targets.map((context) => formatCardServerContextLabel(context)).filter(Boolean)
        : [];

    if (!servers.length) {
        alert('Не знайдено серверів для обробки.');
        return;
    }

    window.open(`${LEGACY_LICENSE_MANAGER_BASE}?servers=${encodeURIComponent(servers.join(','))}&action=${encodeURIComponent(action)}`, '_blank');
};

const shouldStopBulkLicenseQueueAfterError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('право на масове оновлення ліцензій')
        || message.includes('персональний доступ цього пристрою відкликано')
        || message.includes('завершіть доступ пристрою');
};

const markBulkLicenseQueueRemainingItems = (run, state, message) => {
    run.items.forEach((item) => {
        if (item.state !== 'idle') {
            return;
        }

        item.state = state;
        item.message = message;
        item.details = 'Чергу завершено раніше, ніж дійшла черга до цього сервера.';
    });
};

const performBulkLicenseQueueItem = async (run, item) => {
    if (run.action === BULK_LICENSE_ACTIONS.check) {
        const response = await requestCardLicenseCheck(item.context);
        applyBulkLicenseCheckItemResult(item, response);
        return;
    }

    while (!run.aborted) {
        const response = await requestCardLicenseUpdate(item.context, {
            batchId: run.batchId,
            serialNumber: item.serialNumber || null
        });

        applyBulkLicenseUpdateItemResult(item, response);
        if (response?.resultCode !== 'MANUAL_SERIAL_REQUIRED') {
            return;
        }

        const manualSerialNumber = promptBulkLicenseSerialNumber(item, response);
        if (!manualSerialNumber) {
            item.state = 'error';
            item.resultCode = 'MANUAL_SERIAL_CANCELLED';
            item.outcome = 'error';
            item.message = 'Ручний UID не введено.';
            item.details = 'Оновлення для цього сервера скасовано користувачем.';
            item.diffSummaryLabel = '';
            stampBulkLicenseItem(item);
            return;
        }

        item.serialNumber = manualSerialNumber;
        item.state = 'processing';
        item.message = 'Повторюємо оновлення з ручним UID...';
        item.details = `UID: ${manualSerialNumber}`;
        item.diffSummaryLabel = '';
        stampBulkLicenseItem(item);
        if (!run.aborted) {
            renderBulkLicenseQueueModal(run);
        }
    }
};

const runBulkLicenseQueue = async (run) => {
    run.processing = true;
    renderBulkLicenseQueueModal(run);

    try {
        for (const item of run.items) {
            if (run.aborted) {
                break;
            }

            item.state = 'processing';
            item.message = run.action === BULK_LICENSE_ACTIONS.update ? 'Запускаємо оновлення...' : 'Запускаємо перевірку...';
            item.details = '';
            item.diffSummaryLabel = '';
            item.validitySummary = '';
            stampBulkLicenseItem(item);
            renderBulkLicenseQueueModal(run);

            try {
                await performBulkLicenseQueueItem(run, item);
            } catch (error) {
                item.state = 'error';
                item.outcome = 'error';
                item.message = error?.message || 'Невідома помилка під час обробки сервера.';
                item.details = '';
                item.diffSummaryLabel = '';
                item.validitySummary = '';
                stampBulkLicenseItem(item);

                if (shouldStopBulkLicenseQueueAfterError(error)) {
                    run.globalError = item.message;
                    run.aborted = true;
                    markBulkLicenseQueueRemainingItems(run, 'error', item.message);
                    break;
                }
            }

            if (!run.aborted) {
                renderBulkLicenseQueueModal(run);
            }
        }
    } finally {
        run.processing = false;
        run.completedAt = new Date().toISOString();

        if (run.aborted) {
            activeBulkLicenseRun = null;
            return;
        }

        if (activeBulkLicenseRun === run) {
            renderBulkLicenseQueueModal(run);
        }
    }
};

const startBulkLicenseQueue = ({ action, sourceLabel, targets, bulkModeFormat = BULK_LICENSE_MODE_FORMATS.legacy }) => {
    const dedupedTargets = Array.isArray(targets)
        ? targets.reduce((result, context) => {
            const label = formatCardServerContextLabel(context);
            if (!label || result.seen.has(label)) {
                return result;
            }

            result.seen.add(label);
            result.items.push(context);
            return result;
        }, { seen: new Set(), items: [] }).items
        : [];

    if (!dedupedTargets.length) {
        alert('Не знайдено серверів для обробки.');
        return;
    }

    if (normalizeBulkLicenseModeFormat(bulkModeFormat) === BULK_LICENSE_MODE_FORMATS.legacy) {
        openLegacyBulkLicenseManager({
            action,
            targets: dedupedTargets
        });
        return;
    }

    if (activeBulkLicenseRun?.processing) {
        renderBulkLicenseQueueModal(activeBulkLicenseRun);
        alert('Масова операція вже виконується. Дочекайтеся завершення поточної черги.');
        return;
    }

    const run = {
        id: createBulkLicenseBatchId(),
        action,
        batchId: action === BULK_LICENSE_ACTIONS.update ? createBulkLicenseBatchId() : null,
        sourceLabel,
        processing: false,
        aborted: false,
        globalError: '',
        items: dedupedTargets.map((context, index) => ({
            id: `${index + 1}-${formatCardServerContextLabel(context)}`,
            context,
            label: formatCardServerContextLabel(context),
            state: 'idle',
            message: '',
            details: '',
            resultCode: '',
            outcome: '',
            serialNumber: '',
            updatedTargetCount: 0,
            updatedAt: '',
            validitySummary: '',
            diffSummaryLabel: ''
        }))
    };

    activeBulkLicenseRun = run;
    renderBulkLicenseQueueModal(run);
    void runBulkLicenseQueue(run);
};

const handleCardLicenseCheck = async (button, serverContext) => {
    const daoServiceStatus = await getCardDaoServiceStatus();
    if (isCardDaoServiceOffline(daoServiceStatus)) {
        setCardErrorMessage(buildCardDaoServiceUnavailableMessage(daoServiceStatus, 'Перевірка ліцензій'));
        return;
    }

    const requestToken = ++cardLicenseCheckRequestToken;
    activeCardLicenseCheckButton = button;
    button.dataset.licenseCheckToken = String(requestToken);
    setCardActionButtonLoading(button, true, 'Перевірка...');
    showCardLicenseLoadingModal(serverContext);
    const displayModePromise = getCardLicenseDisplayModeFromStorage();

    try {
        const [response, displayMode] = await Promise.all([
            requestCardLicenseCheck(serverContext),
            displayModePromise
        ]);
        if (button.dataset.licenseCheckToken !== String(requestToken) || requestToken !== cardLicenseCheckRequestToken) {
            return;
        }

        showCardLicenseResultModal({
            server: response.address,
            port: String(response.port)
        }, response.result, displayMode);
    } catch (error) {
        const displayMode = await displayModePromise;
        if (button.dataset.licenseCheckToken !== String(requestToken) || requestToken !== cardLicenseCheckRequestToken) {
            return;
        }

        showCardLicenseErrorModal(serverContext, error?.message || 'Не вдалося перевірити ліцензії.', displayMode);
    } finally {
        if (button.dataset.licenseCheckToken === String(requestToken)) {
            delete button.dataset.licenseCheckToken;
            setCardActionButtonLoading(button, false);
        }

        if (activeCardLicenseCheckButton === button && !button.dataset.licenseCheckToken) {
            activeCardLicenseCheckButton = null;
        }
    }
};

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById(CARD_LICENSE_MODAL_ID)) {
        closeCardLicenseCheckModal();
    }
});

const clearCardLoginStatusTimeout = () => {
    if (!cardLoginStatusTimeoutId) {
        return;
    }

    clearTimeout(cardLoginStatusTimeoutId);
    cardLoginStatusTimeoutId = 0;
};

const setCardLoginButtonState = (isLoading) => {
    const button = document.getElementById('send-data-button');
    if (!button) return;

    button.disabled = isLoading;
    button.style.cursor = isLoading ? 'wait' : 'pointer';
    button.style.opacity = '1';
};

const syncCardLoginButtonWidth = (button) => {
    if (!button || !document.body) {
        return;
    }

    const computedStyle = window.getComputedStyle(button);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
        button.style.width = '190px';
        button.style.minWidth = '190px';
        return;
    }

    const fontStyle = computedStyle.fontStyle || 'normal';
    const fontVariant = computedStyle.fontVariant || 'normal';
    const fontWeight = computedStyle.fontWeight || '600';
    const fontSize = computedStyle.fontSize || '13px';
    const fontFamily = computedStyle.fontFamily || 'sans-serif';
    context.font = `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} ${fontFamily}`;

    const letterSpacingValue = parseFloat(computedStyle.letterSpacing);
    const letterSpacing = Number.isFinite(letterSpacingValue) ? letterSpacingValue : 0;
    let maxLabelWidth = 0;
    CARD_LOGIN_BUTTON_LABELS.forEach((label) => {
        const textWidth = context.measureText(label).width;
        const spacingWidth = label.length > 1 ? (label.length - 1) * letterSpacing : 0;
        maxLabelWidth = Math.max(maxLabelWidth, Math.ceil(textWidth + spacingWidth));
    });

    const horizontalPadding = parseFloat(computedStyle.paddingLeft) + parseFloat(computedStyle.paddingRight);
    const borderWidth = parseFloat(computedStyle.borderLeftWidth) + parseFloat(computedStyle.borderRightWidth);
    const fallbackWidth = 190;
    const targetWidth = Math.max(fallbackWidth, Math.ceil(maxLabelWidth + horizontalPadding + borderWidth + 2));

    button.style.width = `${targetWidth}px`;
    button.style.minWidth = `${targetWidth}px`;
}

const ensureCardLoginButtonContent = () => {
    const button = document.getElementById('send-data-button');
    if (!button) {
        return null;
    }

    let fillNode = button.querySelector('[data-role="card-login-fill"]');
    let labelNode = button.querySelector('[data-role="card-login-label"]');

    if (!fillNode) {
        fillNode = document.createElement('span');
        fillNode.setAttribute('data-role', 'card-login-fill');
        fillNode.style.cssText = `
            position: absolute;
            inset: 0;
            border-radius: inherit;
            background: rgba(16, 185, 129, 0.92);
            transform: scaleX(0);
            transform-origin: left center;
            transition: transform 1s cubic-bezier(0.23, 1, 0.32, 1), background 0.45s ease, opacity 0.35s ease, box-shadow 0.45s ease;
            pointer-events: none;
            opacity: 0;
            z-index: 0;
            will-change: transform;
            box-shadow: inset -10px 0 18px rgba(255, 255, 255, 0.08);
        `;
        button.appendChild(fillNode);
    }

    if (!labelNode) {
        labelNode = document.createElement('span');
        labelNode.setAttribute('data-role', 'card-login-label');
        labelNode.textContent = button.dataset.baseLabel || button.textContent.trim() || 'Увійти в бекофіс';
        labelNode.style.cssText = `
            position: relative;
            z-index: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            user-select: none;
            cursor: inherit;
        `;

        button.textContent = '';
        button.appendChild(labelNode);
    }

    if (!button.dataset.baseLabel) {
        button.dataset.baseLabel = labelNode.textContent.trim() || 'Увійти в бекофіс';
    }

    return { button, fillNode, labelNode };
};

const setCardLoginProgress = (state) => {
    const content = ensureCardLoginButtonContent();
    if (!content) return;

    const { button, fillNode, labelNode } = content;
    const isDarkTheme = isPlanfixDarkTheme();
    const loginTheme = getCardButtonIntentTheme(CARD_BUTTON_INTENTS.login);

    applyCardLoginButtonTheme(button);

    const stateMap = {
        idle: {
            progress: 0,
            text: button.dataset.baseLabel || 'Увійти в бекофіс',
            fill: isDarkTheme ? 'rgba(16, 185, 129, 0.72)' : 'rgba(16, 185, 129, 0.92)',
            textColor: loginTheme.color,
            opacity: 0,
            shadow: isDarkTheme
                ? 'inset -10px 0 18px rgba(255, 255, 255, 0.05)'
                : 'inset -10px 0 18px rgba(255, 255, 255, 0.08)'
        },
        sending: {
            progress: 32,
            text: 'Відправка...',
            fill: isDarkTheme ? 'rgba(22, 163, 74, 0.54)' : 'rgba(22, 163, 74, 0.88)',
            textColor: loginTheme.color,
            opacity: 1,
            shadow: isDarkTheme
                ? 'inset -14px 0 20px rgba(255, 255, 255, 0.08)'
                : 'inset -16px 0 22px rgba(255, 255, 255, 0.12)'
        },
        waiting: {
            progress: 74,
            text: 'Вхід виконується...',
            fill: isDarkTheme ? 'rgba(22, 163, 74, 0.66)' : 'rgba(22, 163, 74, 0.93)',
            textColor: loginTheme.color,
            opacity: 1,
            shadow: isDarkTheme
                ? 'inset -16px 0 22px rgba(255, 255, 255, 0.09)'
                : 'inset -18px 0 24px rgba(255, 255, 255, 0.14)'
        },
        success: {
            progress: 100,
            text: 'Готово',
            fill: isDarkTheme ? 'rgba(16, 185, 129, 0.78)' : 'rgba(16, 185, 129, 0.96)',
            textColor: loginTheme.color,
            opacity: 1,
            shadow: isDarkTheme
                ? 'inset -16px 0 22px rgba(255, 255, 255, 0.1)'
                : 'inset -18px 0 24px rgba(255, 255, 255, 0.16)'
        },
        timeout: {
            progress: 88,
            text: 'Довге очікування',
            fill: isDarkTheme ? 'rgba(21, 128, 61, 0.72)' : 'rgba(21, 128, 61, 0.94)',
            textColor: loginTheme.color,
            opacity: 1,
            shadow: isDarkTheme
                ? 'inset -16px 0 22px rgba(255, 255, 255, 0.09)'
                : 'inset -18px 0 24px rgba(255, 255, 255, 0.14)'
        }
    };

    const config = stateMap[state] || stateMap.idle;

    button.setAttribute('aria-busy', state === 'sending' || state === 'waiting' ? 'true' : 'false');
    button.dataset.progressState = state;
    fillNode.style.transform = `scaleX(${Math.max(0, Math.min(config.progress, 100)) / 100})`;
    fillNode.style.background = config.fill;
    fillNode.style.opacity = String(config.opacity);
    fillNode.style.boxShadow = config.shadow;
    labelNode.textContent = config.text;
    if (button.dataset.daoDiscoMode !== 'true') {
        button.style.color = config.textColor;
    }
};

const resetCardLoginStatus = () => {
    clearCardLoginStatusTimeout();
    setCardLoginButtonState(false);
    setCardLoginProgress('idle');
};

const invalidateCardLoginRequest = () => {
    cardLoginRequestToken += 1;
    resetCardLoginStatus();
};

const scheduleCardLoginLongWait = (requestToken) => {
    clearCardLoginStatusTimeout();
    cardLoginStatusTimeoutId = window.setTimeout(() => {
        if (requestToken !== cardLoginRequestToken) {
            return;
        }

        setCardLoginProgress('timeout');
    }, CARD_LOGIN_LONG_WAIT_MS);
};

const scheduleCardLoginSuccessReset = (requestToken) => {
    clearCardLoginStatusTimeout();
    cardLoginStatusTimeoutId = window.setTimeout(() => {
        if (requestToken !== cardLoginRequestToken) {
            return;
        }

        resetCardLoginStatus();
    }, CARD_LOGIN_SUCCESS_RESET_MS);
};

const isSendDataSuccessMessage = (message = '') => {
    return String(message || '').trim() === SEND_DATA_SUCCESS_MESSAGE;
};

const readSendDataResponseMessage = async (response) => {
    try {
        const data = await response.json();
        return typeof data?.message === 'string' ? data.message.trim() : '';
    } catch (error) {
        return '';
    }
};

// Основна логіка
(async () => {
    ensureCardButtonThemeObserver();
    console.log("Очікуємо завантаження елемента...");

    try {
        let currentKey = getKeyFromUrl();  // Отримуємо початковий `key`
        console.log("Поточний ключ:", currentKey);

        // Функція для обробки елемента довідника
        const processElement = async () => {
            const field72ValueElement = await waitForElement(
                "body > main > div.body-container > div > div.page-layout-block.handbook-card-container.page-layout-block-gray.b-last-block > div.b-main-block-content > div.baron_wrapper.baron_wrapper_scroll_redirect > div > div.b-main-block.baron_container > div > div > div > div > div > div > div > div:nth-child(5) > div > div > div > div > div > div > div > div.object-edit-field-bottom-panel-rc__wrapper-box > div > div.view > div > span"
            );

            console.log("Елемент знайдено:", field72ValueElement);

            // Перевіряємо, чи кнопка вже створена
            if (!document.querySelector("#send-data-button")) {
                // Створюємо обгортку для тексту і кнопки
                const wrapper = document.createElement('div');
                wrapper.style.display = "flex";
                wrapper.style.alignItems = "center";
                wrapper.style.gap = "10px";

                const serverInfo = document.createElement('span');
                serverInfo.style.display = 'inline-flex';
                serverInfo.style.alignItems = 'center';
                serverInfo.style.gap = '6px';
                serverInfo.style.minWidth = '0';

                // Переміщуємо текстовий елемент у нову обгортку
                field72ValueElement.parentElement.insertBefore(wrapper, field72ValueElement);
                wrapper.appendChild(serverInfo);
                serverInfo.appendChild(field72ValueElement);

                // Створюємо кнопку
                const button = document.createElement('button');
                button.id = "send-data-button";
                button.textContent = "Увійти в бекофіс";
                button.style.cssText = `
                    cursor: pointer;
                    padding: 5px 14px;
                    min-height: 32px;
                    border-radius: 6px;
                    border: none;
                    font-weight: 600;
                    font-size: 13px;
                    background: #f87171;
                    color: #fff;
                    transition: transform 0.18s ease, box-shadow 0.2s ease;
                    white-space: nowrap;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    line-height: 1.2;
                    flex: 0 0 auto;
                    position: relative;
                    overflow: hidden;
                    isolation: isolate;
                    box-sizing: border-box;
                `;
                button.dataset.baseLabel = 'Увійти в бекофіс';
                button.dataset.cardButtonIntent = CARD_BUTTON_INTENTS.login;
                button.dataset.daoDiscoMode = 'false';
                button.addEventListener('mouseenter', () => {
                    if (!button.disabled) {
                        button.style.transform = 'translateY(-1px)';
                    }
                });
                button.addEventListener('mouseleave', () => {
                    if (!button.disabled) {
                        button.style.transform = 'translateY(0)';
                    }
                });

                // Apply disco mode if enabled
                chrome.storage.local.get(['discoMode'], (result) => {
                    button.dataset.daoDiscoMode = result.discoMode ? 'true' : 'false';

                    setCardLoginProgress(button.dataset.progressState || 'idle');

                    syncCardLoginButtonWidth(button);
                });

                // Додаємо кнопку до обгортки
                wrapper.appendChild(button);
                ensureCardLoginButtonContent();
                syncCardLoginButtonWidth(button);
                resetCardLoginStatus();

                // Додаємо обробник події для кнопки
                button.addEventListener('click', async () => {
                    console.log("Кнопка натиснута.");
                    invalidateCardErrorPolling();
                    clearCardErrorMessage();

                    const rawField72Value = field72ValueElement.textContent.trim();
                    const field74ValueElement = document.querySelector(
                        "body > main > div.body-container > div > div.page-layout-block.handbook-card-container.page-layout-block-gray.b-last-block > div.b-main-block-content > div.baron_wrapper.baron_wrapper_scroll_redirect > div > div.b-main-block.baron_container > div > div > div > div > div > div > div > div:nth-child(7) > div > div > div > div > div > div > div > div.object-edit-field-bottom-panel-rc__wrapper-box > div > div.view > div > span"
                    );
                    const field74Value = field74ValueElement ? field74ValueElement.textContent.trim() : '';
                    const serverResolution = resolveCardServerContextFromRawInput(rawField72Value, field74Value);
                    const finalServerContext = serverResolution.context;
                    if (!finalServerContext?.server) {
                        setCardErrorMessage(serverResolution.errorMessage || 'Адресу сервера не знайдено. Перевірте поле адреси.');
                        console.warn("Адреса сервера не знайдена, дію скасовано.", serverResolution.errorMessage);
                        return;
                    }

                    // Отримуємо збережене значення з chrome.storage
                    try {
                        const savedField = await getUserInputFromStorage();
                        console.log("Збережене значення:", savedField);

                        // Формуємо дані для запиту
                        const payload = {
                            address: finalServerContext.server,
                            port: finalServerContext.port || '',
                            client_id: savedField,
                        };
                        const requestToken = ++cardLoginRequestToken;

                        console.log("Дані для надсилання:", payload);
                        clearCardLoginStatusTimeout();
                        setCardLoginButtonState(true);
                        setCardLoginProgress('sending');
                        scheduleCardLoginLongWait(requestToken);

                        // Надсилаємо POST-запит
                        const response = await fetch('https://planfix-to-syrve.com:8000/send_data/', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(payload),
                        });
                        const responseMessage = await readSendDataResponseMessage(response);

                        if (requestToken !== cardLoginRequestToken) {
                            return;
                        }

                        if (response.ok) {
                            console.log(responseMessage || 'Дані успішно надіслано.', response.status);

                            if (responseMessage && !isSendDataSuccessMessage(responseMessage)) {
                                resetCardLoginStatus();
                                setCardErrorMessage(responseMessage);
                                return;
                            }

                            setCardLoginProgress('waiting');
                            await wait(CARD_LOGIN_SUCCESS_MESSAGE_DELAY_MS);

                            if (requestToken !== cardLoginRequestToken) {
                                return;
                            }

                            setCardLoginButtonState(false);
                            setCardLoginProgress('success');
                            scheduleCardLoginSuccessReset(requestToken);
                        } else {
                            console.error("Помилка при надсиланні:", response.status, response.statusText);
                            setCardErrorMessage(
                                responseMessage
                                    || `Не вдалося виконати запит до сервера ${finalServerContext.server}${finalServerContext.port ? `:${finalServerContext.port}` : ''}. Код відповіді: ${response.status}.`
                            );
                            resetCardLoginStatus();
                        }
                    } catch (error) {
                        console.error("Помилка мережі:", error);
                        setCardErrorMessage(`Помилка підключення до сервера ${finalServerContext.server}${finalServerContext.port ? `:${finalServerContext.port}` : ''}. Перевірте адресу, порт та доступність сервера.`);
                        resetCardLoginStatus();
                    }
                });

            }
        };

        // Спостереження за зміною URL (зміна `key`)
        const observer = new MutationObserver(async () => {
            const newKey = getKeyFromUrl();
            if (newKey !== currentKey) {
                console.log("Змінився ключ:", newKey);
                currentKey = newKey;
                await processElement();  // Перезапускаємо логіку для нового елемента
            }
        });

        // Налаштування спостереження за змінами в URL
        observer.observe(document, {
            childList: true,
            subtree: true
        });

        // Початковий запуск
        await processElement();

    } catch (error) {
        console.error(error.message);
    }
})();

// --- Масові дії на сторінці-списку довідника ---
(() => {
    const HEADER_CLIENT = 'Клієнт';
    const HEADER_SERVER = 'Сервер';
    const HEADER_PORT = 'Порт';
    const HEADER_CHAIN = 'Chain';
    const HOVER_PANEL_ID = 'bulk-hover-panel';
    const HOVER_HIDE_DELAY = 1000;
    const COLUMN_IDS = {
        [HEADER_CLIENT]: '80',
        [HEADER_SERVER]: '72',
        [HEADER_PORT]: '74',
        [HEADER_CHAIN]: '260'
    };
    const DEFAULT_COL_CLASSES = {
        [HEADER_CLIENT]: 'td-item-qe-4',
        [HEADER_SERVER]: 'td-item-qe-8',
        [HEADER_PORT]: 'td-item-qe-18',
        [HEADER_CHAIN]: 'td-item-qe-10'
    };
    const HEADER_CANDIDATE_SELECTOR = [
        '.td-head-common-sort',
        '.td-head',
        'thead th',
        'thead td',
        'th[data-columnid]',
        'th[data-column-id]',
        'td[data-columnid]',
        'td[data-column-id]',
        '[role="columnheader"]'
    ].join(', ');
    const COLS = [
        { headerText: HEADER_CHAIN, label: 'Chain' },
        { headerText: HEADER_CLIENT, label: 'Клієнт' }
    ];

    let hideTimer = null;
    let hideAnimationTimer = null;
    let activeHoverCell = null;
    let bulkAccessState = null;
    let bulkAccessStateRouteKey = '';
    let bulkAccessStateRequestPromise = null;

    const buildBulkAccessRouteKey = () => `${window.location.pathname}|${window.location.search}|${window.location.hash}`;

    const hasHandbookBulkTargets = () => Boolean(
        document.querySelector('tr.handbook-data-item')
        || findColumnHeaderByText(HEADER_SERVER)
        || findColumnHeaderByColumnId(COLUMN_IDS[HEADER_SERVER])
    );

    const canUseBulkLicenseActions = () => Boolean(
        bulkAccessState?.hasExtensionKey && bulkAccessState?.hasBulkLicenseAccess
    );

    const requestBulkAccessState = () => new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: 'GET_EXTENSION_ACCESS_STATE'
        }, (response) => {
            if (chrome.runtime.lastError || !response?.ok || !response.state) {
                resolve(bulkAccessState || {
                    hasExtensionKey: false,
                    hasBulkLicenseAccess: false,
                    bulkModeFormat: BULK_LICENSE_MODE_FORMATS.legacy,
                    scopes: []
                });
                return;
            }

            resolve(response.state);
        });
    });

    const syncBulkAccessState = (forceRefresh = false) => {
        if (!hasHandbookBulkTargets()) {
            return Promise.resolve(bulkAccessState);
        }

        const routeKey = buildBulkAccessRouteKey();
        if (!forceRefresh && bulkAccessState && bulkAccessStateRouteKey === routeKey) {
            return Promise.resolve(bulkAccessState);
        }

        if (bulkAccessStateRequestPromise) {
            return bulkAccessStateRequestPromise;
        }

        bulkAccessStateRequestPromise = requestBulkAccessState()
            .then((state) => {
                bulkAccessState = state || {
                    hasExtensionKey: false,
                    hasBulkLicenseAccess: false,
                    bulkModeFormat: BULK_LICENSE_MODE_FORMATS.legacy,
                    scopes: []
                };
                bulkAccessStateRouteKey = routeKey;

                if (!canUseBulkLicenseActions()) {
                    hidePanel(0);
                }

                return bulkAccessState;
            })
            .finally(() => {
                bulkAccessStateRequestPromise = null;
            });

        return bulkAccessStateRequestPromise;
    };

    const normalizeComparableText = (value) => (
        String(value || '')
            .toLowerCase()
            .replace(/[^a-zа-яіїєґ0-9]+/giu, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    );

    const findQeClassSuffix = (element) => {
        if (!element) {
            return null;
        }

        const matchedClass = [...element.classList].find((className) => /(?:^|-)qe-\d+$/.test(className));
        if (!matchedClass) {
            return null;
        }

        const match = matchedClass.match(/qe-(\d+)$/);
        return match ? match[1] : null;
    };

    const getColumnIdFromElement = (element) => {
        if (!element) {
            return '';
        }

        const directValue = element.getAttribute?.('data-columnid') || element.getAttribute?.('data-column-id');
        if (directValue) {
            return directValue.trim();
        }

        const container = element.closest?.('td, th, .td-head');
        const containerValue = container?.getAttribute?.('data-columnid') || container?.getAttribute?.('data-column-id');
        if (containerValue) {
            return containerValue.trim();
        }

        const nestedValue = element.querySelector?.('[data-columnid], [data-column-id]');
        return nestedValue?.getAttribute('data-columnid') || nestedValue?.getAttribute('data-column-id') || '';
    };

    const findColumnHeaderByText = (headerText) => {
        const normalizedHeader = normalizeComparableText(headerText);
        if (!normalizedHeader) {
            return null;
        }

        const candidates = [...document.querySelectorAll(HEADER_CANDIDATE_SELECTOR)].filter((element) => (
            element.closest('.tbl-list, .tbl-list-scroll__container, .td-head')
        ));
        const exactMatch = candidates.find((candidate) => normalizeComparableText(candidate.textContent) === normalizedHeader);
        return exactMatch?.closest('td, th, .td-head') || exactMatch || null;
    };

    const findColumnHeaderByColumnId = (columnId) => {
        if (!columnId) {
            return null;
        }

        const headerTrigger = document.querySelector(`.td-head-common-sort[data-columnid="${columnId}"]`)
            || document.querySelector(`.td-head-common-sort[data-column-id="${columnId}"]`)
            || document.querySelector(`[data-columnid="${columnId}"]`)
            || document.querySelector(`[data-column-id="${columnId}"]`);

        return headerTrigger?.closest('td, th, .td-head') || headerTrigger || null;
    };

    const findColumnClassFromTable = (table, columnIndex) => {
        if (!table || columnIndex < 0) {
            return null;
        }

        const firstDataRow = [...table.querySelectorAll('tbody tr.handbook-data-item')]
            .find((row) => row.children && row.children.length > columnIndex);
        if (!firstDataRow) {
            return null;
        }

        const cell = firstDataRow.children[columnIndex];
        if (!cell) {
            return null;
        }

        return [...cell.classList].find((className) => /^td-item-qe-\d+$/.test(className)) || null;
    };

    const findColumnClassById = (columnId) => {
        if (!columnId) {
            return null;
        }

        const columnElement = document.querySelector(`col[data-column-id="${columnId}"]`)
            || document.querySelector(`col[data-columnid="${columnId}"]`);
        if (columnElement?.parentElement) {
            const columnIndex = [...columnElement.parentElement.children].indexOf(columnElement);
            const tableClass = findColumnClassFromTable(columnElement.closest('table'), columnIndex);
            if (tableClass) {
                return tableClass;
            }
        }

        const headerElement = findColumnHeaderByColumnId(columnId)
            || document.querySelector(`[data-columnid="${columnId}"]`)
            || document.querySelector(`[data-column-id="${columnId}"]`);
        const qeSuffix = findQeClassSuffix(headerElement)
            || findQeClassSuffix(headerElement?.querySelector?.('.td-head-common-sort'));

        return qeSuffix ? `td-item-qe-${qeSuffix}` : null;
    };

    const findColClass = (headerText) => {
        const headerElement = findColumnHeaderByText(headerText);
        const qeSuffix = findQeClassSuffix(headerElement)
            || findQeClassSuffix(headerElement?.querySelector?.('.td-head-common-sort'));
        if (qeSuffix) {
            return `td-item-qe-${qeSuffix}`;
        }

        const headerColumnId = getColumnIdFromElement(headerElement);
        const classFromTextMatch = findColumnClassById(headerColumnId);
        if (classFromTextMatch) {
            return classFromTextMatch;
        }

        const fallbackClass = findColumnClassById(COLUMN_IDS[headerText]);
        if (fallbackClass) {
            return fallbackClass;
        }

        return DEFAULT_COL_CLASSES[headerText] || null;
    };

    const cellText = (row, colClass) => {
        if (!colClass) {
            return '';
        }

        const cell = row.querySelector(`td.${colClass}`);
        if (!cell) {
            return '';
        }

        const link = cell.querySelector('a');
        return (link ? link.textContent : cell.textContent).trim();
    };

    const resolveBulkServerContextFromRawInput = (rawServer, rawPort) => {
        const rawValue = String(rawServer || '').trim();
        if (!rawValue) {
            return null;
        }

        const fallbackServer = rawValue.split('/').map((part) => part.trim()).find(Boolean) || rawValue;
        const extractedServer = extractDaoCloudAddress(rawValue) || fallbackServer;
        return resolveCardServerContext(extractedServer, rawPort);
    };

    const collectServers = (colClass, groupValue) => {
        const rows = document.querySelectorAll('tr.handbook-data-item');
        const seen = new Set();
        const result = [];
        const serverClass = findColClass(HEADER_SERVER);
        const portClass = findColClass(HEADER_PORT);

        rows.forEach((row) => {
            if (cellText(row, colClass) !== groupValue) {
                return;
            }

            const context = resolveBulkServerContextFromRawInput(
                cellText(row, serverClass),
                cellText(row, portClass)
            );
            const label = formatCardServerContextLabel(context);
            if (!label || seen.has(label)) {
                return;
            }

            seen.add(label);
            result.push(context);
        });

        return result;
    };

    const collectAllServersOnPage = () => {
        const rows = document.querySelectorAll('tr.handbook-data-item');
        const seen = new Set();
        const result = [];
        const serverClass = findColClass(HEADER_SERVER);
        const portClass = findColClass(HEADER_PORT);

        rows.forEach((row) => {
            const context = resolveBulkServerContextFromRawInput(
                cellText(row, serverClass),
                cellText(row, portClass)
            );
            const label = formatCardServerContextLabel(context);
            if (!label || seen.has(label)) {
                return;
            }

            seen.add(label);
            result.push(context);
        });

        return result;
    };

    const ensureHoverPanel = () => {
        let panel = document.getElementById(HOVER_PANEL_ID);
        if (panel) {
            return panel;
        }

        panel = document.createElement('div');
        panel.id = HOVER_PANEL_ID;
        panel.style.cssText = `
            position: fixed;
            z-index: 99999;
            background: #ffffff;
            border: 1px solid #d1d5db;
            border-radius: 10px;
            box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
            padding: 10px 14px;
            display: none;
            flex-direction: column;
            gap: 8px;
            min-width: 220px;
            pointer-events: auto;
            opacity: 0;
            transition: opacity 0.15s ease;
            font-family: inherit;
            font-size: 12px;
        `;
        panel.addEventListener('mouseenter', () => {
            clearTimeout(hideTimer);
            hideTimer = null;
        });
        panel.addEventListener('mouseleave', () => hidePanel(150));
        document.body.appendChild(panel);
        return panel;
    };

    const positionBelow = (anchorElement, panel) => {
        const rect = anchorElement.getBoundingClientRect();
        const panelWidth = panel.offsetWidth || 260;
        let top = rect.bottom + 4;
        let left = rect.left;

        if (left + panelWidth > window.innerWidth - 8) {
            left = window.innerWidth - panelWidth - 8;
        }

        left = Math.max(8, left);
        panel.style.top = `${top}px`;
        panel.style.left = `${left}px`;
        panel.style.right = 'auto';
    };

    const showPanel = (anchorElement, renderRow) => {
        const panel = ensureHoverPanel();

        if (activeHoverCell && activeHoverCell !== anchorElement && panel.style.display !== 'none') {
            return;
        }

        clearTimeout(hideTimer);
        hideTimer = null;
        clearTimeout(hideAnimationTimer);
        hideAnimationTimer = null;
        activeHoverCell = anchorElement;

        panel.innerHTML = '';
        const row = renderRow();
        if (!row) {
            activeHoverCell = null;
            return;
        }

        panel.appendChild(row);
        panel.style.display = 'flex';
        requestAnimationFrame(() => {
            positionBelow(anchorElement, panel);
            panel.style.opacity = '1';
        });
    };

    function hidePanel(delay = 200) {
        const panel = document.getElementById(HOVER_PANEL_ID);
        if (!panel) {
            return;
        }

        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideTimer = null;
            panel.style.opacity = '0';
            clearTimeout(hideAnimationTimer);
            hideAnimationTimer = setTimeout(() => {
                panel.style.display = 'none';
                panel.innerHTML = '';
                activeHoverCell = null;
                hideAnimationTimer = null;
            }, 150);
        }, delay);
    }

    const makeBtn = (label, background, onClick) => {
        const button = document.createElement('button');
        button.textContent = label;
        button.style.cssText = `
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 5px;
            border: none;
            font-weight: 600;
            font-size: 11px;
            background: ${background};
            color: #fff;
            transition: opacity 0.15s ease;
            white-space: nowrap;
            flex-shrink: 0;
        `;
        button.addEventListener('mouseenter', () => {
            button.style.opacity = '0.75';
        });
        button.addEventListener('mouseleave', () => {
            button.style.opacity = '1';
        });
        button.addEventListener('click', onClick);
        return button;
    };

    const makeActionRow = (label, value, onRunAction) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        const labelNode = document.createElement('span');
        labelNode.textContent = `${label}:`;
        labelNode.style.cssText = 'color: #6b7280; font-weight: 500; flex-shrink: 0; min-width: 46px; font-size: 11px;';

        const valueNode = document.createElement('span');
        valueNode.textContent = value;
        valueNode.style.cssText = 'font-weight: 600; color: #111827; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

        row.appendChild(labelNode);
        row.appendChild(valueNode);
        row.appendChild(makeBtn('✓ Перевірити', '#059669', () => onRunAction(BULK_LICENSE_ACTIONS.check)));
        row.appendChild(makeBtn('↻ Оновити', '#d97706', () => onRunAction(BULK_LICENSE_ACTIONS.update)));
        return row;
    };

    const runHandbookBulkAction = async ({ action, sourceLabel, targets }) => {
        const nextState = await syncBulkAccessState(true);
        if (!(nextState?.hasExtensionKey && nextState?.hasBulkLicenseAccess)) {
            hidePanel(0);
            return;
        }

        startBulkLicenseQueue({
            action,
            sourceLabel,
            targets,
            bulkModeFormat: nextState.bulkModeFormat
        });
        hidePanel(0);
    };

    const makeGroupRow = (label, value, colClass) => {
        if (!canUseBulkLicenseActions()) {
            return null;
        }

        if (!value) {
            return null;
        }

        return makeActionRow(label, value, (action) => {
            const servers = collectServers(colClass, value);
            if (!servers.length) {
                alert(`Не знайдено серверів для: ${value}`);
                return;
            }

            void runHandbookBulkAction({
                action,
                sourceLabel: `${label}: ${value}`,
                targets: servers
            });
        });
    };

    const makeAllServersRow = () => {
        if (!canUseBulkLicenseActions()) {
            return null;
        }

        return makeActionRow('Сервери', 'Усі на сторінці', (action) => {
        const servers = collectAllServersOnPage();
        if (!servers.length) {
            alert('Не знайдено серверів на поточній сторінці.');
            return;
        }

        void runHandbookBulkAction({
            action,
            sourceLabel: 'Сервери: усі на сторінці',
            targets: servers
        });
        });
    };

    const attachCellHover = () => {
        const resolvedColumns = COLS
            .map(({ headerText, label }) => ({ headerText, label, colClass: findColClass(headerText) }))
            .filter(({ colClass }) => Boolean(colClass));

        document.querySelectorAll('tr.handbook-data-item').forEach((row) => {
            resolvedColumns.forEach(({ label, colClass }) => {
                const cell = row.querySelector(`td.${colClass}`);
                if (!cell || cell.dataset.bulkHoverAttached) {
                    return;
                }

                cell.dataset.bulkHoverAttached = '1';
                cell.style.cursor = 'default';
                cell.addEventListener('mouseenter', () => {
                    const value = cellText(row, colClass);
                    showPanel(cell, () => makeGroupRow(label, value, colClass));
                });
                cell.addEventListener('mouseleave', () => hidePanel(HOVER_HIDE_DELAY));
            });
        });
    };

    const attachServerHeaderHover = () => {
        const hoverTarget = findColumnHeaderByText(HEADER_SERVER) || findColumnHeaderByColumnId(COLUMN_IDS[HEADER_SERVER]);
        if (!hoverTarget || hoverTarget.dataset.bulkServerHoverAttached) {
            return;
        }

        hoverTarget.dataset.bulkServerHoverAttached = '1';
        hoverTarget.style.cursor = 'default';
        hoverTarget.addEventListener('mouseenter', () => {
            showPanel(hoverTarget, () => makeAllServersRow());
        });
        hoverTarget.addEventListener('mouseleave', () => hidePanel(HOVER_HIDE_DELAY));
    };

    const attachHoverTargets = () => {
        if (!hasHandbookBulkTargets()) {
            return;
        }

        const routeKey = buildBulkAccessRouteKey();
        if (!bulkAccessState || bulkAccessStateRouteKey !== routeKey) {
            void syncBulkAccessState(true).then(() => {
                if (canUseBulkLicenseActions()) {
                    attachHoverTargets();
                }
            });
            return;
        }

        if (!canUseBulkLicenseActions()) {
            hidePanel(0);
            return;
        }

        attachCellHover();
        attachServerHeaderHover();
    };

    if (!document.body) {
        return;
    }

    const observer = new MutationObserver(attachHoverTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            bulkAccessState = null;
            bulkAccessStateRouteKey = '';
            void syncBulkAccessState(true).then(() => {
                if (canUseBulkLicenseActions()) {
                    attachHoverTargets();
                }
            });
        }
    });
    attachHoverTargets();
})();

// --- Логіка для сторінки з панеллю полів (f-id="72") ---
(async () => {
    const BUTTONS_ID = CARD_BUTTONS_ID;

    ensureCardButtonThemeObserver();

    const getCardScopeRoot = (element) => (
        element?.closest('.g-popup-win-scroll-content, .page-layout-block.handbook-card-container, .object-edit-win-target, .object-edit-win-location-field')
        || document
    );

    const isTaskPage = () => /^\/task\/\d+(?:\/|$)/.test(window.location.pathname);

    const getCurrentTaskUrl = () => {
        if (!isTaskPage()) {
            return '';
        }

        const url = new URL(window.location.href);
        url.hash = '';
        return url.toString();
    };

    const CARD_WEB_FIELD_ID = '472';
    const CARD_WEB_FIELD_LABEL = 'Web: посилання';

    const normalizeCardFieldLabel = (value) => String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const getCardFieldValue = (fieldTarget) => {
        if (!fieldTarget) {
            return '';
        }

        const valueElement = fieldTarget.querySelector('.ObjectEditFieldBase__view__value__text');
        const valueText = valueElement?.textContent?.trim() || '';
        if (valueText) {
            return valueText;
        }

        const rawValue = fieldTarget.querySelector('.object-edit-field-input')?.getAttribute('data-value') || '';
        if (rawValue.trim()) {
            return rawValue.trim();
        }

        const inputValue = fieldTarget.querySelector('input, textarea')?.value || '';
        return String(inputValue).trim();
    };

    const getCardFieldText = (scopeRoot = document, fieldId) => {
        const normalizedFieldId = String(fieldId || '').trim();
        if (!normalizedFieldId) {
            return '';
        }

        const fieldTarget = scopeRoot.querySelector(`.field-target[f-id="${normalizedFieldId}"]`);
        if (!fieldTarget) {
            return '';
        }

        return getCardFieldValue(fieldTarget);
    };

    const getCardFieldTextByLabel = (scopeRoot = document, label) => {
        const normalizedLabel = normalizeCardFieldLabel(label);
        if (!normalizedLabel) {
            return '';
        }

        const labelNodes = [...scopeRoot.querySelectorAll('.field-target .label__text')];
        const matchedLabelNode = labelNodes.find((labelNode) => {
            const labelText = normalizeCardFieldLabel(labelNode?.textContent || labelNode?.getAttribute('title') || '');
            return labelText === normalizedLabel;
        });

        return getCardFieldValue(matchedLabelNode?.closest('.field-target'));
    };

    const getCardLoyaltyLogin = (scopeRoot = document) => getCardFieldText(scopeRoot, 444);
    const getCardWebUrl = (scopeRoot = document) => getCardFieldTextByLabel(scopeRoot, CARD_WEB_FIELD_LABEL)
        || getCardFieldText(scopeRoot, CARD_WEB_FIELD_ID);

    const buildCardActionButtonAvailability = (scopeRoot = document) => {
        const loyaltyLogin = String(getCardLoyaltyLogin(scopeRoot) || '').trim();
        const rawWebUrl = String(getCardWebUrl(scopeRoot) || '').trim();
        const hasWebValue = rawWebUrl.length > 0 && !/^[\-–—]+$/.test(rawWebUrl);

        const availability = {
            [LOYALTY_BUTTON_ID]: {
                actionDisabled: !loyaltyLogin,
                tooltip: loyaltyLogin ? '' : CARD_BUTTON_DISABLED_MESSAGES.loyaltyMissing
            },
            [WEB_BUTTON_ID]: {
                actionDisabled: false,
                tooltip: ''
            },
            [API_BUTTON_ID]: {
                actionDisabled: false,
                tooltip: ''
            }
        };

        if (!hasWebValue) {
            availability[WEB_BUTTON_ID] = {
                actionDisabled: true,
                tooltip: CARD_BUTTON_DISABLED_MESSAGES.webMissing
            };
            availability[API_BUTTON_ID] = {
                actionDisabled: true,
                tooltip: CARD_BUTTON_DISABLED_MESSAGES.webMissing
            };
            return availability;
        }

        let normalizedWebUrl = '';
        try {
            normalizedWebUrl = normalizeCardWebUrl(rawWebUrl);
        } catch (error) {
            availability[WEB_BUTTON_ID] = {
                actionDisabled: true,
                tooltip: CARD_BUTTON_DISABLED_MESSAGES.webInvalid
            };
            availability[API_BUTTON_ID] = {
                actionDisabled: true,
                tooltip: CARD_BUTTON_DISABLED_MESSAGES.webInvalid
            };
            return availability;
        }

        try {
            buildCardApiUrl(normalizedWebUrl);
        } catch (error) {
            availability[API_BUTTON_ID] = {
                actionDisabled: true,
                tooltip: error?.message?.includes('syrve.app')
                    ? CARD_BUTTON_DISABLED_MESSAGES.apiUnsupported
                    : CARD_BUTTON_DISABLED_MESSAGES.webInvalid
            };
        }

        return availability;
    };

    const setCardActionButtonAvailability = (button, nextState = {}) => {
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const actionDisabled = nextState?.actionDisabled === true;
        const tooltip = String(nextState?.tooltip || '').trim();

        button.setAttribute(CARD_BUTTON_ACTION_DISABLED_ATTR, actionDisabled ? 'true' : 'false');
        button.setAttribute('aria-disabled', actionDisabled ? 'true' : 'false');

        if (tooltip) {
            button.setAttribute(CARD_BUTTON_TOOLTIP_ATTR, tooltip);
            button.title = tooltip;
        } else {
            button.removeAttribute(CARD_BUTTON_TOOLTIP_ATTR);
            button.removeAttribute('title');
        }

        applyCardActionButtonTheme(button);
    };

    const syncCardActionButtonsAvailability = (container, scopeRoot = document) => {
        if (!(container instanceof HTMLElement)) {
            return;
        }

        const availability = buildCardActionButtonAvailability(scopeRoot);

        [LOYALTY_BUTTON_ID, WEB_BUTTON_ID, API_BUTTON_ID].forEach((buttonId) => {
            const button = container.querySelector(`#${buttonId}`);
            if (!(button instanceof HTMLButtonElement)) {
                return;
            }

            setCardActionButtonAvailability(button, availability[buttonId]);
        });
    };

    const normalizeCardWebUrl = (value) => {
        const normalizedValue = String(value || '').trim();
        if (!normalizedValue || /^[\-–—]+$/.test(normalizedValue)) {
            throw new Error('У полі Web: посилання не вказано в карточці');
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(normalizedValue);
        } catch (error) {
            throw new Error('У полі Web: посилання вказано некоректну адресу.');
        }

        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error('Поле Web: посилання має містити http або https адресу.');
        }

        return parsedUrl.toString();
    };

    const buildCardApiUrl = (webUrl) => {
        const normalizedWebUrl = normalizeCardWebUrl(webUrl);
        const parsedWebUrl = new URL(normalizedWebUrl);

        if (!isCardApiAutologinSupportedHost(parsedWebUrl.hostname)) {
            throw new Error('Поле Web: посилання має вести на сервер *.syrve.app для автовходу API.');
        }

        return new URL(CARD_API_PATH, `${parsedWebUrl.origin}/`).toString();
    };

    const buildHelpDeskDraftTitle = (payload) => `(...) - ${payload.restaurantName || '—'}`;

    const buildHelpDeskDraftDescription = (payload) => ([
        'Добрий день колеги!',
        '',
        payload.restaurantName || '—',
        `SerialNumber: ${payload.uid || '—'}`,
        `CRMID: ${payload.crmId || '—'}`,
        `URL: ${payload.serverUrl || '—'}`
    ].join('\n'));

    const collectHelpDeskDraftPayload = (scopeRoot = document) => {
        const taskUrl = getCurrentTaskUrl();
        if (!taskUrl) {
            throw new Error('Створення чернетки HelpDeskEddy доступне лише зі сторінки задачі Planfix.');
        }

        const serverData = getServerData(scopeRoot, false);
        if (!serverData) {
            throw new Error('Адресу сервера не знайдено. Перевірте картку ресторану.');
        }

        const restaurantName = getCardFieldText(scopeRoot, 106);
        const payload = {
            taskUrl,
            externalNumber: taskUrl,
            priority: HELPDESK_DEFAULT_PRIORITY,
            title: '',
            restaurantName,
            clientName: getCardFieldText(scopeRoot, 80),
            server: serverData.server,
            port: serverData.port || '',
            serverUrl: serverData.server,
            version: getCardFieldText(scopeRoot, 96),
            supportPackage: getCardFieldText(scopeRoot, 102),
            chain: getCardFieldText(scopeRoot, 260),
            city: getCardFieldText(scopeRoot, 104),
            uid: getCardFieldText(scopeRoot, 110),
            crmId: getCardFieldText(scopeRoot, 186),
            type: getCardFieldText(scopeRoot, 138)
        };

        if (!payload.crmId) {
            throw new Error('У картці не знайдено CRMID.');
        }

        if (!payload.version) {
            throw new Error('У картці не знайдено версію Syrve.');
        }

        payload.title = buildHelpDeskDraftTitle(payload);
        payload.description = buildHelpDeskDraftDescription(payload);
        return payload;
    };

    const getCardServerResolution = (scopeRoot = document) => {
        const serverField = scopeRoot.querySelector('.field-target[f-id="72"] .ObjectEditFieldBase__view__value__text');
        const rawServer = serverField ? serverField.textContent.trim() : '';
        const portField = scopeRoot.querySelector('.field-target[f-id="74"] .ObjectEditFieldBase__view__value__text');
        const port = portField ? portField.textContent.trim() : '';
        return resolveCardServerContextFromRawInput(rawServer, port);
    };

    const getServerData = (scopeRoot = document, showAlert = true) => {
        const serverResolution = getCardServerResolution(scopeRoot);

        if (!serverResolution.context) {
            if (showAlert) {
                alert(serverResolution.errorMessage || 'Адресу сервера не знайдено. Перевірте поле адреси.');
            }
            return null;
        }

        return serverResolution.context;
    };

    const resolvePreferredCardOpenServerContext = (serverResolution) => {
        const cacheKey = serverResolution?.availabilityPlan?.key || '';
        const snapshot = getFreshCardServerAvailabilitySnapshot(cacheKey);
        const winningCandidate = snapshot?.winningCandidate || null;

        if (winningCandidate?.server) {
            const winningContext = resolveCardServerContext(winningCandidate, winningCandidate.port);
            if (winningContext?.server) {
                return winningContext;
            }
        }

        return serverResolution?.context || null;
    };

    const getPreferredOpenServerData = (scopeRoot = document, showAlert = true) => {
        const serverResolution = getCardServerResolution(scopeRoot);
        const preferredContext = resolvePreferredCardOpenServerContext(serverResolution);

        if (!preferredContext) {
            if (showAlert) {
                alert(serverResolution.errorMessage || 'Адресу сервера не знайдено. Перевірте поле адреси.');
            }
            return null;
        }

        return preferredContext;
    };

    const createLicenseBtn = (label, color, scopeRoot) => {
        const btn = document.createElement('button');
        btn.dataset.cardButtonIntent = CARD_BUTTON_INTENTS.license;
        btn.textContent = label;
        btn.style.cssText = `
            margin-left: 8px;
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 4px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            background: ${color};
            color: #fff;
            transition: opacity 0.2s ease;
            white-space: nowrap;
        `;
        btn.addEventListener('mouseenter', () => {
            if (!btn.disabled) {
                btn.style.opacity = '0.82';
            }
        });
        btn.addEventListener('mouseleave', () => {
            if (!btn.disabled) {
                btn.style.opacity = '1';
            }
        });
        btn.addEventListener('click', async () => {
            const serverData = getServerData(scopeRoot, true);
            if (!serverData) return;

            invalidateCardErrorPolling();
            clearCardErrorMessage();

            await handleCardLicenseCheck(btn, serverData);
        });
        return btn;
    };

    const openSyrvePageWithCredentials = ({ server, path, port }) => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'OPEN_SYRVE_PAGE',
            server,
            port,
            path
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!response?.ok) {
                reject(new Error(response?.error || 'Невідома помилка відкриття сторінки Syrve.'));
                return;
            }

            resolve(response.tabId);
        });
    });

    const openHelpDeskDraft = (payload) => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'OPEN_HELPDESK_DRAFT',
            payload
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!response?.ok || !response.requestId) {
                reject(new Error(response?.error || 'Невідома помилка відкриття чернетки HelpDeskEddy.'));
                return;
            }

            resolve(response);
        });
    });

    const openLoyaltyPageWithCredentials = ({ login }) => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'OPEN_LOYALTY_PAGE',
            login
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!response?.ok) {
                reject(new Error(response?.error || 'Невідома помилка відкриття Loyalty.'));
                return;
            }

            resolve(response.tabId);
        });
    });

    const openCardWebUrlWithCredentials = ({ url }) => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'OPEN_CARD_WEB_URL_WITH_AUTOLOGIN',
            url
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!response?.ok) {
                reject(new Error(response?.error || 'Невідома помилка відкриття веб-адреси.'));
                return;
            }

            resolve(response.tabId);
        });
    });

    const createRestoBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = 'open-resto-button';
        btn.dataset.cardButtonIntent = CARD_BUTTON_INTENTS.resto;
        btn.textContent = 'Веб-морда';
        btn.style.cssText = `
            margin-left: 8px;
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 4px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            background: #2563eb;
            color: #fff;
            transition: opacity 0.2s ease;
            white-space: nowrap;
        `;
        btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.82'; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
        btn.addEventListener('click', async () => {
            const serverData = getPreferredOpenServerData(scopeRoot, true);
            if (!serverData) return;

            invalidateCardErrorPolling();
            clearCardErrorMessage();

            try {
                await openSyrvePageWithCredentials({
                    server: serverData.server,
                    port: serverData.port,
                    path: '/resto/'
                });
            } catch (error) {
                console.error('Не вдалося відкрити вебморду Syrve:', error);
                setCardErrorMessage(`Не вдалося відкрити вебморду: ${error?.message || 'невідома помилка'}`);
                return;
            }

            try {
                await copyTextToClipboard(serverData.server);
            } catch (error) {
                console.warn('Не вдалося скопіювати адресу сервера після відкриття вебморди:', error);
            }
        });
        return btn;
    };

    const createDevicesBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = 'open-connections-button';
        btn.dataset.cardButtonIntent = CARD_BUTTON_INTENTS.devices;
        btn.textContent = 'Зайняті ліцензії';
        btn.style.cssText = `
            margin-left: 8px;
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 4px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            background: #7c3aed;
            color: #fff;
            transition: opacity 0.2s ease;
            white-space: nowrap;
        `;
        btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.82'; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
        btn.addEventListener('click', async () => {
            const serverData = getPreferredOpenServerData(scopeRoot, true);
            if (!serverData) return;

            invalidateCardErrorPolling();
            clearCardErrorMessage();

            try {
                await openSyrvePageWithCredentials({
                    server: serverData.server,
                    port: serverData.port,
                    path: '/resto/service/monitoring/connections.jsp'
                });
            } catch (error) {
                console.error('Не вдалося відкрити сторінку пристроїв Syrve:', error);
                setCardErrorMessage(`Не вдалося відкрити Пристрої: ${error?.message || 'невідома помилка'}`);
            }
        });
        return btn;
    };

    const createLoyaltyBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = LOYALTY_BUTTON_ID;
        btn.dataset.cardButtonIntent = CARD_BUTTON_INTENTS.loyalty;
        btn.textContent = 'Loyalty';
        btn.style.cssText = `
            margin-left: 8px;
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 4px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            background: #db2777;
            color: #fff;
            transition: opacity 0.2s ease;
            white-space: nowrap;
        `;
        btn.addEventListener('mouseenter', () => {
            if (canUseCardActionButtonHover(btn)) {
                btn.style.opacity = '0.82';
            }
        });
        btn.addEventListener('mouseleave', () => {
            syncCardActionButtonInteractivity(btn);
        });
        btn.addEventListener('click', async () => {
            if (isCardActionButtonActionDisabled(btn)) {
                return;
            }

            const currentScopeRoot = getCardScopeRoot(btn) || scopeRoot;
            const loyaltyLogin = getCardLoyaltyLogin(currentScopeRoot);

            invalidateCardErrorPolling();
            clearCardErrorMessage();

            if (!loyaltyLogin) {
                setCardErrorMessage('Не знайдено логін для Loyalty. Якщо дізнаєтесь його, прошу повідомити будь ласка');
                return;
            }

            setCardActionButtonLoading(btn, true, 'Відкриваю...');

            try {
                await openLoyaltyPageWithCredentials({
                    login: loyaltyLogin
                });
            } catch (error) {
                console.error('Не вдалося відкрити Loyalty:', error);
                setCardErrorMessage(`Не вдалося відкрити Loyalty: ${error?.message || 'невідома помилка'}`);
            } finally {
                setCardActionButtonLoading(btn, false);
            }
        });
        return btn;
    };

    const createWebBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = WEB_BUTTON_ID;
        btn.type = 'button';
        btn.dataset.cardButtonIntent = CARD_BUTTON_INTENTS.web;
        btn.textContent = 'Веб';
        btn.style.cssText = `
            margin-left: 8px;
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 4px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            background: #0f766e;
            color: #fff;
            transition: opacity 0.2s ease;
            white-space: nowrap;
        `;

        btn.addEventListener('mouseenter', () => {
            if (canUseCardActionButtonHover(btn)) {
                btn.style.opacity = '0.82';
            }
        });
        btn.addEventListener('mouseleave', () => {
            syncCardActionButtonInteractivity(btn);
        });
        btn.addEventListener('click', async () => {
            if (isCardActionButtonActionDisabled(btn)) {
                return;
            }

            const currentScopeRoot = getCardScopeRoot(btn) || scopeRoot;
            let webUrl;

            try {
                webUrl = normalizeCardWebUrl(getCardWebUrl(currentScopeRoot));
            } catch (error) {
                invalidateCardErrorPolling();
                clearCardErrorMessage();
                setCardErrorMessage(error?.message || 'Не вдалося прочитати поле Web: посилання.');
                return;
            }

            invalidateCardErrorPolling();
            clearCardErrorMessage();
            setCardActionButtonLoading(btn, true, 'Відкриваю...');

            try {
                await openCardWebUrlWithCredentials({
                    url: webUrl
                });
            } catch (error) {
                console.error('Не вдалося відкрити веб-адресу сервера:', error);
                setCardErrorMessage(error?.message || 'Не вдалося відкрити веб-адресу сервера.');
            } finally {
                setCardActionButtonLoading(btn, false);
            }
        });

        return btn;
    };

    const createApiBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = API_BUTTON_ID;
        btn.type = 'button';
        btn.dataset.cardButtonIntent = CARD_BUTTON_INTENTS.api;
        btn.textContent = 'Веб:API';
        btn.style.cssText = `
            margin-left: 8px;
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 4px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            background: #0369a1;
            color: #fff;
            transition: opacity 0.2s ease;
            white-space: nowrap;
        `;

        btn.addEventListener('mouseenter', () => {
            if (canUseCardActionButtonHover(btn)) {
                btn.style.opacity = '0.82';
            }
        });
        btn.addEventListener('mouseleave', () => {
            syncCardActionButtonInteractivity(btn);
        });
        btn.addEventListener('click', async () => {
            if (isCardActionButtonActionDisabled(btn)) {
                return;
            }

            const currentScopeRoot = getCardScopeRoot(btn) || scopeRoot;
            let apiUrl;

            try {
                apiUrl = buildCardApiUrl(getCardWebUrl(currentScopeRoot));
            } catch (error) {
                invalidateCardErrorPolling();
                clearCardErrorMessage();
                setCardErrorMessage(error?.message || 'Не вдалося підготувати API-адресу.');
                return;
            }

            invalidateCardErrorPolling();
            clearCardErrorMessage();
            setCardActionButtonLoading(btn, true, 'Відкриваю...');

            try {
                await openCardWebUrlWithCredentials({
                    url: apiUrl
                });
            } catch (error) {
                console.error('Не вдалося відкрити API-адресу сервера:', error);
                setCardErrorMessage(error?.message || 'Не вдалося відкрити API-адресу сервера.');
            } finally {
                setCardActionButtonLoading(btn, false);
            }
        });

        return btn;
    };

    const createPeriodBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = 'get-period-button';
        btn.dataset.cardButtonIntent = CARD_BUTTON_INTENTS.period;
        btn.textContent = 'Період і версія';
        btn.style.cssText = `
            margin-left: 8px;
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 4px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            background: #0891b2;
            color: #fff;
            transition: opacity 0.2s ease;
            white-space: nowrap;
        `;
        btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.82'; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
        btn.addEventListener('click', () => {
            const serverData = getServerData(scopeRoot, true);
            if (!serverData) return;

            if (activePeriodRequestId) {
                setCardPeriodMessage('Отримання періоду вже виконується...');
                return;
            }

            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const cardVersion = normalizeComparableCardVersion(getCardFieldText(scopeRoot, 96));
            activePeriodRequestId = requestId;
            activePeriodRequestContext = {
                requestId,
                serverKey: buildCardServerContextKey(serverData),
                cardVersion,
                scopeRoot
            };
            lastCardVersionCheckResult = null;
            invalidateCardErrorPolling();
            clearCardErrorMessage();
            clearCardVersionStatus(scopeRoot);
            setCardPeriodMessage('Отримання періоду...');

            chrome.runtime.sendMessage({
                action: 'OPEN_HEALTH_PERIOD_TAB',
                server: serverData.server,
                port: serverData.port,
                requestId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    activePeriodRequestId = null;
                    activePeriodRequestContext = null;
                    setCardPeriodMessage(`Не вдалося отримати період: ${chrome.runtime.lastError.message}`);
                    return;
                }

                if (!response?.ok) {
                    activePeriodRequestId = null;
                    activePeriodRequestContext = null;
                    setCardPeriodMessage(`Не вдалося отримати період: ${response?.error || 'невідома помилка'}`);
                }
            });
        });
        return btn;
    };
    const createHelpDeskDraftBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = HELPDESK_DRAFT_BUTTON_ID;
        btn.dataset.cardButtonIntent = CARD_BUTTON_INTENTS.helpdesk;
        btn.textContent = 'HelpDesk';
        btn.style.cssText = `
            margin-left: 8px;
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 4px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            background: #ea580c;
            color: #fff;
            transition: opacity 0.2s ease;
            white-space: nowrap;
        `;
        btn.addEventListener('mouseenter', () => {
            if (!btn.disabled) {
                btn.style.opacity = '0.82';
            }
        });
        btn.addEventListener('mouseleave', () => {
            if (!btn.disabled) {
                btn.style.opacity = '1';
            }
        });
        btn.addEventListener('click', async () => {
            if (!isTaskPage()) {
                setCardErrorMessage('Створення чернетки HelpDeskEddy доступне лише зі сторінки задачі Planfix.');
                return;
            }

            if (activeHelpDeskDraftButton) {
                setCardErrorMessage('Підготовка чернетки HelpDeskEddy вже виконується.');
                return;
            }

            invalidateCardErrorPolling();
            clearCardErrorMessage();
            activeHelpDeskDraftButton = btn;
            setCardActionButtonLoading(btn, true, 'Готую чернетку...');

            try {
                const payload = collectHelpDeskDraftPayload(scopeRoot);
                const response = await openHelpDeskDraft(payload);
                activeHelpDeskDraftRequestId = response.requestId;
                btn.dataset.helpdeskDraftRequestId = response.requestId;
                setCardActionButtonLoading(btn, true, 'Заповнюю...');
            } catch (error) {
                activeHelpDeskDraftRequestId = null;
                resetActiveHelpDeskDraftButton();
                setCardErrorMessage(`Не вдалося підготувати чернетку HelpDeskEddy: ${error?.message || 'невідома помилка'}`);
            }
        });
        return btn;
    };

    const injectPanelButtons = (serverFieldTarget) => {
        if (!serverFieldTarget) return;

        const scopeRoot = serverFieldTarget.closest('.g-popup-win-scroll-content, .page-layout-block.handbook-card-container, .object-edit-win-target, .object-edit-win-location-field')
            || document;

        const wrapperBox = serverFieldTarget.querySelector('.object-edit-field-bottom-panel-rc__wrapper-box');
        if (!wrapperBox) return;

        const serverValueElement = serverFieldTarget.querySelector('.ObjectEditFieldBase__view__value__text');
        if (serverValueElement) {
            ensureCardServerAvailabilityNode(serverValueElement);
        }

        let container = scopeRoot.querySelector(`#${BUTTONS_ID}`);
        if (!container) {
            container = document.createElement('div');
            container.id = BUTTONS_ID;
            container.appendChild(createLicenseBtn("Перевірити ліцензії", "#059669", scopeRoot));
            container.appendChild(createRestoBtn(scopeRoot));
            container.appendChild(createDevicesBtn(scopeRoot));
            container.appendChild(createPeriodBtn(scopeRoot));
            container.appendChild(createLoyaltyBtn(scopeRoot));
            container.appendChild(createWebBtn(scopeRoot));
            container.appendChild(createApiBtn(scopeRoot));
            if (isTaskPage()) {
                container.appendChild(createHelpDeskDraftBtn(scopeRoot));
            }

            wrapperBox.after(container);
        } else if (container.previousElementSibling !== wrapperBox) {
            wrapperBox.after(container);
        }

        container.style.cssText = `
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 4px;
            padding: 4px 0 2px 0;
            max-width: 100%;
        `;

        const existingLoyaltyButton = container.querySelector(`#${LOYALTY_BUTTON_ID}`);
        if (!existingLoyaltyButton) {
            const periodBtn = container.querySelector('#get-period-button');
            const loyaltyBtn = createLoyaltyBtn(scopeRoot);
            if (periodBtn?.nextSibling) {
                container.insertBefore(loyaltyBtn, periodBtn.nextSibling);
            } else {
                container.appendChild(loyaltyBtn);
            }
        }

        const existingWebButton = container.querySelector(`#${WEB_BUTTON_ID}`);
        const existingApiButton = container.querySelector(`#${API_BUTTON_ID}`);
        if (!existingWebButton) {
            const loyaltyBtn = container.querySelector(`#${LOYALTY_BUTTON_ID}`);
            const webBtn = createWebBtn(scopeRoot);
            if (loyaltyBtn?.nextSibling) {
                container.insertBefore(webBtn, loyaltyBtn.nextSibling);
            } else {
                container.appendChild(webBtn);
            }
        }

        if (!existingApiButton) {
            const webBtn = container.querySelector(`#${WEB_BUTTON_ID}`);
            const apiBtn = createApiBtn(scopeRoot);
            if (webBtn?.nextSibling) {
                container.insertBefore(apiBtn, webBtn.nextSibling);
            } else {
                container.appendChild(apiBtn);
            }
        }

        const existingHelpDeskButton = container.querySelector(`#${HELPDESK_DRAFT_BUTTON_ID}`);
        if (isTaskPage()) {
            if (!existingHelpDeskButton) {
                container.appendChild(createHelpDeskDraftBtn(scopeRoot));
            }
        } else if (existingHelpDeskButton) {
            if (activeHelpDeskDraftButton === existingHelpDeskButton) {
                activeHelpDeskDraftRequestId = null;
                resetActiveHelpDeskDraftButton();
            }
            existingHelpDeskButton.remove();
        }

        container.querySelectorAll('button').forEach((button) => {
            applyCompactCardActionButtonStyle(button);
        });
        syncCardActionButtonsAvailability(container, scopeRoot);

        ensureCardPeriodNode();
        ensureCardErrorNode();

        const serverResolution = getCardServerResolution(scopeRoot);
        const serverData = serverResolution.context;
        if (serverValueElement) {
            scheduleCardServerAvailabilityCheck(serverResolution.availabilityPlan, serverValueElement);
        }

        if (!serverData) {
            clearCardPeriodMessage();
            clearCardErrorMessage();
            clearCardVersionStatus(scopeRoot);
        }
    };

    // Використовуємо MutationObserver для очікування появи елемента
    const panelObserver = new MutationObserver(() => {
        document.querySelectorAll('.field-target[f-id="72"]').forEach((serverFieldTarget) => {
            injectPanelButtons(serverFieldTarget);
        });

        // Прибираємо кнопки при зміні сторінки, щоб уникнути дублювання
        if (!document.querySelector('.field-target[f-id="72"]') && document.getElementById(BUTTONS_ID)) {
            document.querySelectorAll(`#${BUTTONS_ID}`).forEach((node) => node.remove());
            document.querySelectorAll(`#${CARD_PERIOD_ID}`).forEach((node) => node.remove());
            document.querySelectorAll(`#${CARD_ERROR_ID}`).forEach((node) => node.remove());
            document.querySelectorAll(`[${CARD_VERSION_STATUS_ATTR}="true"]`).forEach((node) => node.remove());
            document.querySelectorAll(`[${CARD_SERVER_AVAILABILITY_ATTR}="true"]`).forEach((node) => node.remove());
            closeCardLicenseCheckModal();
            invalidateCardErrorPolling();
            invalidateCardLoginRequest();
            invalidateCardServerAvailabilityCheck();
            activePeriodRequestId = null;
            activePeriodRequestContext = null;
            lastCardVersionCheckResult = null;
            activeHelpDeskDraftRequestId = null;
            resetActiveHelpDeskDraftButton();
        }
    });

    panelObserver.observe(document.body, { childList: true, subtree: true });

    // Одразу пробуємо, якщо елемент вже є
    document.querySelectorAll('.field-target[f-id="72"]').forEach((serverFieldTarget) => {
        injectPanelButtons(serverFieldTarget);
    });
})();
