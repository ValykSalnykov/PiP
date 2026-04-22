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
        delete button.dataset.originalStyles;
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

const selectPreferredCardServerAddress = (rawAddress) => {
    const candidates = splitCardServerAddressCandidates(rawAddress)
        .map((part) => {
            const endpoint = parseCardServerEndpoint(part);
            if (!endpoint?.server) {
                return null;
            }

            const hostType = classifyCardServerHost(endpoint.server);
            if (hostType === 'unknown') {
                return null;
            }

            return {
                raw: part,
                server: endpoint.server,
                port: endpoint.port,
                hostType
            };
        })
        .filter(Boolean);

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

            if (message.discoMode) {
                applyDiscoStyle(button);
            } else {
                removeDiscoStyle(button);
            }
        });
        return;
    }

    if (message.action === 'HEALTH_PERIOD_RESULT') {
        if (!message.requestId || message.requestId !== activePeriodRequestId) {
            return;
        }

        activePeriodRequestId = null;

        if (message.error) {
            setCardPeriodMessage(`Не вдалося отримати період: ${message.error}`);
            return;
        }

        if (message.period === undefined || message.period === null || message.period === '') {
            setCardPeriodMessage('Не вдалося отримати період: значення відсутнє.');
            return;
        }

        setCardPeriodMessage(`Період: ${message.period} днів`);
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
const CARD_LOGIN_STATUS_ID = 'send-data-button-status';
const LOYALTY_BUTTON_ID = 'open-loyalty-button';
const WEB_BUTTON_ID = 'open-server-web-url-button';
const HELPDESK_DRAFT_BUTTON_ID = 'open-helpdesk-draft-button';
const CARD_LICENSE_MODAL_ID = 'dao-license-check-modal';
const CARD_LICENSE_MODAL_STYLE_ID = 'dao-license-check-modal-styles';
const CARD_SERVER_AVAILABILITY_ATTR = 'data-dao-server-availability';
const CARD_ERROR_POLL_DELAYS = [0, 1200, 2500, 5000];
const CARD_LOGIN_LONG_WAIT_MS = 7000;
const CARD_SERVER_AVAILABILITY_CHECK_DEBOUNCE_MS = 450;
const CARD_SERVER_AVAILABILITY_RECHECK_INTERVAL_MS = 60 * 1000;
const CARD_LICENSE_GROUP_ORDER = ['pos', 'api', 'mobile', 'other'];
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

let cardErrorPollToken = 0;
let activePeriodRequestId = null;
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
    const selection = selectPreferredCardServerAddress(rawServer);
    if (!selection?.server) {
        return {
            context: null,
            errorMessage: buildCardServerSelectionErrorMessage(selection)
        };
    }

    const context = resolveCardServerContext(selection, port);
    if (!context?.server) {
        return {
            context: null,
            errorMessage: 'Адресу сервера не знайдено. Перевірте поле адреси.'
        };
    }

    if (requiresCardExplicitPort(context.server) && !context.port) {
        return {
            context: null,
            errorMessage: buildCardPortRequiredErrorMessage(context.server)
        };
    }

    return {
        context,
        selection
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

const getCardServerAvailabilityCacheKey = (context) => getCardServerAvailabilityUrl(context);

const applyRecentCardServerAvailabilitySnapshot = (cacheKey, field72ValueElement) => {
    if (!cacheKey || !cardServerAvailabilitySnapshot || cardServerAvailabilitySnapshot.key !== cacheKey) {
        return false;
    }

    if (Date.now() - cardServerAvailabilitySnapshot.checkedAt >= CARD_SERVER_AVAILABILITY_RECHECK_INTERVAL_MS) {
        return false;
    }

    setCardServerAvailabilityState(
        cardServerAvailabilitySnapshot.state,
        cardServerAvailabilitySnapshot.message,
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
            transition: background 0.18s ease, transform 0.18s ease;
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
        }
    };

    const config = stateMap[state] || stateMap.idle;
    statusNode.style.background = config.background;
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

const probeCardServerAvailability = async (context, field72ValueElement, requestToken) => {
    const url = getCardServerAvailabilityUrl(context);
    const cacheKey = getCardServerAvailabilityCacheKey(context);
    if (!url) {
        setCardServerAvailabilityState('idle', '', field72ValueElement);
        return false;
    }

    cardServerAvailabilityInFlightKey = cacheKey;
    setCardServerAvailabilityState('checking', `Перевірка ${url}`, field72ValueElement);

    try {
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'PROBE_SERVER_AVAILABILITY',
                server: context.server,
                port: context.port
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
            throw new Error(response?.error || `Не вдалося перевірити ${url}.`);
        }

        const isReachable = response.reachable === true;
        const nextState = isReachable ? 'online' : 'offline';
        const nextMessage = response.error || `${url} відповідає зі статусом ${response.status}.`;
        cardServerAvailabilitySnapshot = {
            key: cacheKey,
            checkedAt: Date.now(),
            state: nextState,
            message: nextMessage
        };
        setCardServerAvailabilityState(
            nextState,
            nextMessage,
            resolveCardServerAvailabilityTarget(field72ValueElement)
        );
        return isReachable;
    } catch (error) {
        if (requestToken !== cardServerAvailabilityCheckToken) {
            return false;
        }

        const nextMessage = error?.message || `Не вдалося підключитися до ${url}.`;
        cardServerAvailabilitySnapshot = {
            key: cacheKey,
            checkedAt: Date.now(),
            state: 'offline',
            message: nextMessage
        };
        setCardServerAvailabilityState(
            'offline',
            nextMessage,
            resolveCardServerAvailabilityTarget(field72ValueElement)
        );
        return false;
    } finally {
        if (cardServerAvailabilityInFlightKey === cacheKey) {
            cardServerAvailabilityInFlightKey = '';
        }
    }
};

const scheduleCardServerAvailabilityCheck = (context, field72ValueElement) => {
    if (!field72ValueElement) {
        return;
    }

    if (!context?.server) {
        invalidateCardServerAvailabilityCheck();
        setCardServerAvailabilityState('idle', '', field72ValueElement);
        return;
    }

    const cacheKey = getCardServerAvailabilityCacheKey(context);
    if (!cacheKey) {
        invalidateCardServerAvailabilityCheck();
        setCardServerAvailabilityState('idle', '', field72ValueElement);
        return;
    }

    if (applyRecentCardServerAvailabilitySnapshot(cacheKey, field72ValueElement)) {
        return;
    }

    if (cardServerAvailabilityInFlightKey === cacheKey) {
        setCardServerAvailabilityState('checking', `Перевірка ${cacheKey}`, field72ValueElement);
        return;
    }

    if (cardServerAvailabilityScheduledKey === cacheKey && cardServerAvailabilityCheckTimerId) {
        setCardServerAvailabilityState('checking', `Перевірка ${cacheKey}`, field72ValueElement);
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

        await probeCardServerAvailability(context, field72ValueElement, requestToken);
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
        line-height: 1.4;
        white-space: pre-wrap;
        font-weight: 600;
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

const setCardPeriodMessage = (message) => {
    const periodNode = ensureCardPeriodNode();
    if (!periodNode) return;

    const normalizedMessage = (message || '').trim();
    periodNode.textContent = normalizedMessage;
    periodNode.style.display = normalizedMessage ? 'block' : 'none';
};

const clearCardPeriodMessage = () => {
    setCardPeriodMessage('');
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

const setCardActionButtonLoading = (button, isLoading, loadingLabel = '') => {
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.textContent || '';
    }

    button.disabled = isLoading;
    button.style.cursor = isLoading ? 'wait' : 'pointer';
    button.style.opacity = isLoading ? '0.82' : '1';
    button.textContent = isLoading && loadingLabel ? loadingLabel : button.dataset.defaultLabel;
};

const applyCompactCardActionButtonStyle = (button) => {
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    button.style.marginLeft = '0';
    button.style.padding = '3px 8px';
    button.style.fontSize = '12px';
    button.style.flex = '0 0 auto';
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

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__dialog {
            width: min(980px, 100%);
            max-width: 100%;
            height: min(94vh, 1080px);
            height: min(94dvh, 1080px);
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

        @keyframes dao-license-modal-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        @media (max-width: 640px) {
            #${CARD_LICENSE_MODAL_ID} {
                padding: 12px;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__dialog {
                width: 100%;
                height: min(94vh, 1080px);
                height: min(94dvh, 1080px);
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

const ensureCardLicenseModalShell = () => {
    ensureCardLicenseModalStyles();

    let modal = document.getElementById(CARD_LICENSE_MODAL_ID);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = CARD_LICENSE_MODAL_ID;
        modal.innerHTML = `
            <div class="dao-license-modal__dialog" role="dialog" aria-modal="true" aria-label="Ліцензії Syrve">
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

        document.body.appendChild(modal);
    }

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

const renderCardLicenseModal = ({ title, subtitle, content }) => {
    const { titleWrapNode, titleNode, subtitleNode, viewportNode, bodyNode, closeNode } = ensureCardLicenseModalShell();
    const hasTitle = Boolean(title);
    const hasSubtitle = Boolean(subtitle);

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

    fragment.appendChild(overviewPanel);

    const licensesPanel = createCardLicenseModalNode('section', 'dao-license-modal__panel');

    if (!licenses.length) {
        licensesPanel.appendChild(createCardLicenseModalNode('div', 'dao-license-modal__empty-state', 'Сервер відповів без списку ліцензій.'));
        fragment.appendChild(licensesPanel);
        return fragment;
    }

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

        const groupNode = createCardLicenseModalNode('section', `dao-license-modal__group dao-license-modal__group--${groupId}`);
        const groupHead = createCardLicenseModalNode('div', 'dao-license-modal__group-head');
        groupHead.appendChild(createCardLicenseModalNode('h4', 'dao-license-modal__group-title', CARD_LICENSE_GROUP_LABELS[groupId] || CARD_LICENSE_GROUP_LABELS.other));
        groupHead.appendChild(createCardLicenseModalChip(`${groupLicenses.length}`));
        groupNode.appendChild(groupHead);

        const licenseList = createCardLicenseModalNode('div', 'dao-license-modal__license-list');
        groupLicenses.forEach((license) => {
            const primaryName = license.friendlyName || license.name || `Ліцензія ${license.id || ''}`.trim();
            const secondaryParts = [];

            if (license.friendlyName && license.name && license.name !== license.friendlyName) {
                secondaryParts.push(license.name);
            }

            const item = createCardLicenseModalNode('article', 'dao-license-modal__license-item');
            const main = createCardLicenseModalNode('div', 'dao-license-modal__license-main');
            main.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__license-name', primaryName));
            if (secondaryParts.length) {
                main.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__license-subtitle', secondaryParts.join(' • ')));
            }

            const meta = createCardLicenseModalNode('div', 'dao-license-modal__license-meta');
            if (license.count !== null && license.count !== undefined) {
                meta.appendChild(createCardLicenseModalChip(`${license.count} шт.`, 'dao-license-modal__chip--count'));
            }
            if (license.validUntil) {
                const validityLabel = formatCardLicenseValidityLabel(license.validUntil);
                const validityModifier = validityLabel === 'ПЕРМАНЕНТНО'
                    ? 'dao-license-modal__chip--permanent'
                    : 'dao-license-modal__chip--date';
                meta.appendChild(createCardLicenseModalChip(validityLabel, validityModifier));
            }
            if (!meta.childElementCount) {
                meta.appendChild(createCardLicenseModalChip('Без деталей'));
            }

            item.appendChild(main);
            item.appendChild(meta);
            licenseList.appendChild(item);
        });

        groupNode.appendChild(licenseList);
        groupList.appendChild(groupNode);
    });

    licensesPanel.appendChild(groupList);
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

const showCardLicenseErrorModal = (serverContext, errorMessage) => {
    renderCardLicenseModal({
        title: '',
        subtitle: '',
        content: buildCardLicenseErrorContent(errorMessage)
    });
};

const showCardLicenseResultModal = (serverContext, licenseResult) => {
    renderCardLicenseModal({
        title: '',
        subtitle: '',
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

const handleCardLicenseCheck = async (button, serverContext) => {
    const requestToken = ++cardLicenseCheckRequestToken;
    activeCardLicenseCheckButton = button;
    button.dataset.licenseCheckToken = String(requestToken);
    setCardActionButtonLoading(button, true, 'Перевірка...');
    showCardLicenseLoadingModal(serverContext);

    try {
        const response = await requestCardLicenseCheck(serverContext);
        if (button.dataset.licenseCheckToken !== String(requestToken) || requestToken !== cardLicenseCheckRequestToken) {
            return;
        }

        showCardLicenseResultModal({
            server: response.address,
            port: String(response.port)
        }, response.result);
    } catch (error) {
        if (button.dataset.licenseCheckToken !== String(requestToken) || requestToken !== cardLicenseCheckRequestToken) {
            return;
        }

        showCardLicenseErrorModal(serverContext, error?.message || 'Не вдалося перевірити ліцензії.');
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

const getCardLoginStatusNode = () => document.getElementById(CARD_LOGIN_STATUS_ID);

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
    button.style.opacity = isLoading ? '0.82' : '1';
};

const syncCardLoginStatusHeight = () => {
    const statusNode = getCardLoginStatusNode();
    const button = document.getElementById('send-data-button');
    if (!statusNode || !button) return;

    const buttonHeight = Math.round(button.getBoundingClientRect().height);
    if (!buttonHeight) return;

    statusNode.style.height = `${buttonHeight}px`;
    statusNode.style.minHeight = `${buttonHeight}px`;
};

const ensureCardLoginStatusNode = () => {
    let statusNode = getCardLoginStatusNode();
    const button = document.getElementById('send-data-button');

    if (!button) {
        statusNode?.remove();
        return null;
    }

    if (!statusNode) {
        statusNode = document.createElement('span');
        statusNode.id = CARD_LOGIN_STATUS_ID;
        statusNode.setAttribute('role', 'status');
        statusNode.setAttribute('aria-live', 'polite');
        statusNode.setAttribute('aria-atomic', 'true');
        statusNode.style.cssText = `
            display: none;
            align-items: center;
            gap: 6px;
            margin-left: 8px;
            padding: 0 8px;
            border-radius: 999px;
            border: 1px solid rgba(37, 99, 235, 0.16);
            background: rgba(79, 70, 229, 0.08);
            color: #4338ca;
            font-size: 12px;
            font-weight: 600;
            line-height: 1;
            white-space: nowrap;
            box-sizing: border-box;
        `;
        button.insertAdjacentElement('afterend', statusNode);
    } else if (statusNode.previousElementSibling !== button) {
        button.insertAdjacentElement('afterend', statusNode);
    }

    syncCardLoginStatusHeight();

    return statusNode;
};

const setCardLoginStatus = (state) => {
    const statusNode = ensureCardLoginStatusNode();
    if (!statusNode) return;

    const stateMap = {
        sending: {
            icon: '⟳',
            text: 'Відправка...',
            background: 'rgba(79, 70, 229, 0.08)',
            border: 'rgba(79, 70, 229, 0.18)',
            color: '#4338ca'
        },
        waiting: {
            icon: '⟳',
            text: 'Вхід виконується...',
            background: 'rgba(37, 99, 235, 0.08)',
            border: 'rgba(37, 99, 235, 0.18)',
            color: '#1d4ed8'
        },
        success: {
            icon: '✓',
            text: 'Готово',
            background: 'rgba(5, 150, 105, 0.12)',
            border: 'rgba(5, 150, 105, 0.2)',
            color: '#047857'
        },
        timeout: {
            icon: '⏱',
            text: 'Довге очікування',
            background: 'rgba(217, 119, 6, 0.12)',
            border: 'rgba(217, 119, 6, 0.22)',
            color: '#b45309'
        }
    };

    const config = stateMap[state];
    if (!config) {
        statusNode.textContent = '';
        statusNode.style.display = 'none';
        return;
    }

    statusNode.textContent = `${config.icon} ${config.text}`;
    statusNode.style.display = 'inline-flex';
    statusNode.style.background = config.background;
    statusNode.style.borderColor = config.border;
    statusNode.style.color = config.color;
};

const resetCardLoginStatus = () => {
    clearCardLoginStatusTimeout();
    setCardLoginButtonState(false);
    setCardLoginStatus('idle');
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

        setCardLoginStatus('timeout');
    }, CARD_LOGIN_LONG_WAIT_MS);
};

const fetchLastErrorForClient = async (clientId) => {
    const response = await fetch('https://planfix-to-syrve.com:8000/get_last_error/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ client_id: clientId }),
    });

    if (!response.ok) {
        throw new Error(`Bad request, plugin could not reach server. Status: ${response.status}`);
    }

    const data = await response.json();
    return (data.last_error || '').trim();
};

const isCardErrorRelevantToServer = (errorText, context) => {
    if (!errorText || !context?.server) {
        return false;
    }

    const normalizedError = errorText.toLowerCase();
    const candidates = [context.server.toLowerCase()];

    if (context.port) {
        candidates.push(`${context.server.toLowerCase()}:${context.port}`);
        candidates.push(`port ${context.port}`);
        candidates.push(`порт ${context.port}`);
    }

    return candidates.some((candidate) => normalizedError.includes(candidate));
};

const refreshCardServerError = async (context, options = {}) => {
    const { forceShowAnyError = false } = options;
    if (hasPersistentManualCardError()) {
        return false;
    }

    if (!context?.server) {
        clearCardErrorMessage({ preserveManual: true });
        return false;
    }

    try {
        const clientId = await getUserInputFromStorage();
        if (!clientId || clientId === 'default_value') {
            clearCardErrorMessage({ preserveManual: true });
            return false;
        }

        const lastError = await fetchLastErrorForClient(clientId);
        if (!lastError) {
            clearCardErrorMessage({ preserveManual: true });
            return false;
        }

        if (forceShowAnyError || isCardErrorRelevantToServer(lastError, context)) {
            setCardErrorMessage(`Остання помилка для сервера ${context.server}${context.port ? `:${context.port}` : ''}:\n${lastError}`, {
                source: CARD_ERROR_SOURCE_SERVER_POLL
            });
            return true;
        }

        clearCardErrorMessage({ preserveManual: true });
        return false;
    } catch (error) {
        console.error('Не вдалося отримати останню помилку для картки:', error);
        clearCardErrorMessage({ preserveManual: true });
        return false;
    }
};

const pollCardServerError = async (context, options = {}) => {
    const { forceShowAnyError = false, fallbackMessage = '' } = options;
    const pollToken = ++cardErrorPollToken;

    for (const delay of CARD_ERROR_POLL_DELAYS) {
        if (delay > 0) {
            await wait(delay);
        }

        if (pollToken !== cardErrorPollToken) {
            return false;
        }

        const rendered = await refreshCardServerError(context, { forceShowAnyError });
        if (rendered) {
            return true;
        }
    }

    if (pollToken === cardErrorPollToken && fallbackMessage) {
        setCardErrorMessage(fallbackMessage);
        return true;
    }

    return false;
};

// Основна логіка
(async () => {
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
                    transition: opacity 0.2s ease;
                    white-space: nowrap;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    line-height: 1.2;
                    flex: 0 0 auto;
                `;
                button.addEventListener('mouseenter', () => { button.style.opacity = '0.82'; });
                button.addEventListener('mouseleave', () => {
                    if (!button.disabled) {
                        button.style.opacity = '1';
                    }
                });

                // Apply disco mode if enabled
                chrome.storage.local.get(['discoMode'], (result) => {
                    if (result.discoMode) {
                        applyDiscoStyle(button);
                    }
                });

                // Додаємо кнопку до обгортки
                wrapper.appendChild(button);
                ensureCardLoginStatusNode();

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
                        setCardLoginStatus('sending');
                        scheduleCardLoginLongWait(requestToken);

                        // Надсилаємо POST-запит
                        const response = await fetch('https://planfix-to-syrve.com:8000/send_data/', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(payload),
                        });

                        if (requestToken !== cardLoginRequestToken) {
                            return;
                        }

                        if (response.ok) {
                            console.log(await response.json(), response.status);
                            console.log("Дані успішно надіслано.");
                            setCardLoginStatus('waiting');
                            const hasError = await pollCardServerError(finalServerContext);

                            if (requestToken !== cardLoginRequestToken) {
                                return;
                            }

                            clearCardLoginStatusTimeout();
                            setCardLoginButtonState(false);

                            if (hasError) {
                                setCardLoginStatus('idle');
                                return;
                            }

                            setCardLoginStatus('success');
                        } else {
                            console.error("Помилка при надсиланні:", response.status, response.statusText);
                            await pollCardServerError(finalServerContext || serverContext, {
                                fallbackMessage: `Не вдалося виконати запит до сервера ${finalServerContext.server}${finalServerContext.port ? `:${finalServerContext.port}` : ''}. Код відповіді: ${response.status}.`
                            });
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

// --- Логіка для сторінки з панеллю полів (f-id="72") ---
(async () => {
    const BUTTONS_ID = CARD_BUTTONS_ID;

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

    const getCardFieldText = (scopeRoot = document, fieldId) => {
        const normalizedFieldId = String(fieldId || '').trim();
        if (!normalizedFieldId) {
            return '';
        }

        const fieldTarget = scopeRoot.querySelector(`.field-target[f-id="${normalizedFieldId}"]`);
        if (!fieldTarget) {
            return '';
        }

        const valueElement = fieldTarget.querySelector('.ObjectEditFieldBase__view__value__text');
        const valueText = valueElement?.textContent?.trim() || '';
        if (valueText) {
            return valueText;
        }

        const rawValue = fieldTarget.querySelector('.object-edit-field-input')?.getAttribute('data-value') || '';
        return rawValue.trim();
    };

    const getCardLoyaltyLogin = (scopeRoot = document) => getCardFieldText(scopeRoot, 444);

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

    const getServerData = (scopeRoot = document, showAlert = true) => {
        const serverField = scopeRoot.querySelector('.field-target[f-id="72"] .ObjectEditFieldBase__view__value__text');
        const rawServer = serverField ? serverField.textContent.trim() : '';
        const portField = scopeRoot.querySelector('.field-target[f-id="74"] .ObjectEditFieldBase__view__value__text');
        const port = portField ? portField.textContent.trim() : '';
        const serverResolution = resolveCardServerContextFromRawInput(rawServer, port);

        if (!serverResolution.context) {
            if (showAlert) {
                alert(serverResolution.errorMessage || 'Адресу сервера не знайдено. Перевірте поле адреси.');
            }
            return null;
        }

        return serverResolution.context;
    };

    const createLicenseBtn = (label, color, scopeRoot) => {
        const btn = document.createElement('button');
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
        btn.addEventListener('mouseenter', () => { btn.style.opacity = "0.82"; });
        btn.addEventListener('mouseleave', () => {
            if (!btn.disabled) {
                btn.style.opacity = "1";
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

    const openServerWebUrl = ({ server, port }) => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'OPEN_SERVER_WEB_URL',
            server,
            port
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
            const serverData = getServerData(scopeRoot, true);
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
            const serverData = getServerData(scopeRoot, true);
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
            const currentScopeRoot = getCardScopeRoot(btn) || scopeRoot;
            const serverData = getServerData(currentScopeRoot, true);
            if (!serverData) return;

            invalidateCardErrorPolling();
            clearCardErrorMessage();
            setCardActionButtonLoading(btn, true, 'Відкриваю...');

            try {
                await openServerWebUrl({
                    server: serverData.server,
                    port: serverData.port
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

    const createPeriodBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = 'get-period-button';
        btn.textContent = 'Відкритий період';
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
            activePeriodRequestId = requestId;
            invalidateCardErrorPolling();
            clearCardErrorMessage();
            setCardPeriodMessage('Отримання періоду...');

            chrome.runtime.sendMessage({
                action: 'OPEN_HEALTH_PERIOD_TAB',
                server: serverData.server,
                port: serverData.port,
                requestId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    activePeriodRequestId = null;
                    setCardPeriodMessage(`Не вдалося отримати період: ${chrome.runtime.lastError.message}`);
                    return;
                }

                if (!response?.ok) {
                    activePeriodRequestId = null;
                    setCardPeriodMessage(`Не вдалося отримати період: ${response?.error || 'невідома помилка'}`);
                }
            });
        });
        return btn;
    };
    const createHelpDeskDraftBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = HELPDESK_DRAFT_BUTTON_ID;
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

        const scopeRoot = getCardScopeRoot(serverFieldTarget);

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
        const periodButton = container.querySelector('#get-period-button');
        if (!existingLoyaltyButton) {
            const loyaltyButton = createLoyaltyBtn(scopeRoot);
            if (periodButton) {
                periodButton.after(loyaltyButton);
            } else {
                container.appendChild(loyaltyButton);
            }
        } else if (periodButton && periodButton.nextElementSibling !== existingLoyaltyButton) {
            periodButton.after(existingLoyaltyButton);
        }

        const existingWebButton = container.querySelector(`#${WEB_BUTTON_ID}`);
        const loyaltyButton = container.querySelector(`#${LOYALTY_BUTTON_ID}`);
        if (!existingWebButton) {
            const webButton = createWebBtn(scopeRoot);
            if (loyaltyButton) {
                loyaltyButton.after(webButton);
            } else {
                container.appendChild(webButton);
            }
        } else if (loyaltyButton && loyaltyButton.nextElementSibling !== existingWebButton) {
            loyaltyButton.after(existingWebButton);
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

        ensureCardPeriodNode();
        ensureCardErrorNode();

        const serverData = getServerData(scopeRoot, false);
        if (serverData) {
            if (serverValueElement) {
                scheduleCardServerAvailabilityCheck(serverData, serverValueElement);
            }
            pollCardServerError(serverData).catch((error) => {
                console.error('Не вдалося оновити помилку при ініціалізації картки:', error);
            });
        } else {
            clearCardPeriodMessage();
            clearCardErrorMessage();
            if (serverValueElement) {
                setCardServerAvailabilityState('idle', '', serverValueElement);
            }
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
            document.querySelectorAll(`#${CARD_LOGIN_STATUS_ID}`).forEach((node) => node.remove());
            document.querySelectorAll(`[${CARD_SERVER_AVAILABILITY_ATTR}="true"]`).forEach((node) => node.remove());
            closeCardLicenseCheckModal();
            invalidateCardErrorPolling();
            invalidateCardLoginRequest();
            invalidateCardServerAvailabilityCheck();
            activePeriodRequestId = null;
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
