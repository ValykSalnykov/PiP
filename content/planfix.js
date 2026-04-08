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

// Функція для вилучення адреси сервера (.daocloud.fun, .daocloud.it, .syrve.online) з рядка, що може містити кілька адрес через /
const extractDaoCloudAddress = (rawAddress) => {
    const parts = rawAddress.split('/').map(s => s.trim()).filter(Boolean);
    return parts.find(p => /\.daocloud\.fun|\.daocloud\.it|\.syrve\.online/i.test(p)) || null;
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
const CARD_LICENSE_MODAL_ID = 'dao-license-check-modal';
const CARD_LICENSE_MODAL_STYLE_ID = 'dao-license-check-modal-styles';
const CARD_SERVER_AVAILABILITY_ATTR = 'data-dao-server-availability';
const CARD_ERROR_POLL_DELAYS = [0, 1200, 2500, 5000];
const CARD_LOGIN_LONG_WAIT_MS = 7000;
const CARD_SERVER_AVAILABILITY_CHECK_DELAY_MS = 450;
const CARD_LICENSE_GROUP_ORDER = ['mobile', 'api', 'pos', 'other'];
const CARD_LICENSE_GROUP_LABELS = {
    mobile: 'Мобільні',
    api: 'API',
    pos: 'POS',
    other: 'Інше'
};
const SECURE_DEFAULT_PORT_DOMAINS = ['syrve.online', 'daocloud.it', 'daocloud.fun'];

let cardErrorPollToken = 0;
let activePeriodRequestId = null;
let cardLoginStatusTimeoutId = 0;
let cardLoginRequestToken = 0;
let cardServerAvailabilityCheckToken = 0;
let cardServerAvailabilityCheckTimerId = 0;
let cardLicenseCheckRequestToken = 0;
let activeCardLicenseCheckButton = null;

const normalizeServerHost = (value) => {
    const rawValue = (value || '').trim();
    if (!rawValue) return '';

    const candidate = /^[a-z]+:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;

    try {
        return new URL(candidate).hostname.trim().toLowerCase();
    } catch (error) {
        return rawValue
            .replace(/^https?:\/\//i, '')
            .split('/')[0]
            .trim()
            .toLowerCase();
    }
};

const resolveCardServerContext = (server, port) => {
    const normalizedServer = normalizeServerHost(server);
    if (!normalizedServer) {
        return null;
    }

    const explicitPort = (port || '').trim();
    const resolvedPort = explicitPort || (
        SECURE_DEFAULT_PORT_DOMAINS.some((domain) => normalizedServer.endsWith(domain))
            ? '443'
            : ''
    );

    return {
        server: normalizedServer,
        port: resolvedPort
    };
};

const getCardServerAvailabilityUrl = (context) => {
    if (!context?.server) {
        return '';
    }

    const portSegment = context.port ? `:${context.port}` : '';
    return `https://${context.server}${portSegment}/resto`;
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
};

const wait = (delay) => new Promise((resolve) => {
    setTimeout(resolve, delay);
});

const probeCardServerAvailability = async (context, field72ValueElement, requestToken) => {
    const url = getCardServerAvailabilityUrl(context);
    if (!url) {
        setCardServerAvailabilityState('idle', '', field72ValueElement);
        return false;
    }

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
        setCardServerAvailabilityState(
            isReachable ? 'online' : 'offline',
            response.error || `${url} відповідає зі статусом ${response.status}.`,
            field72ValueElement
        );
        return isReachable;
    } catch (error) {
        if (requestToken !== cardServerAvailabilityCheckToken) {
            return false;
        }

        setCardServerAvailabilityState(
            'offline',
            error?.message || `Не вдалося підключитися до ${url}.`,
            field72ValueElement
        );
        return false;
    }
};

const scheduleCardServerAvailabilityCheck = (context, field72ValueElement) => {
    invalidateCardServerAvailabilityCheck();

    if (!field72ValueElement) {
        return;
    }

    if (!context?.server) {
        setCardServerAvailabilityState('idle', '', field72ValueElement);
        return;
    }

    const requestToken = cardServerAvailabilityCheckToken;
    cardServerAvailabilityCheckTimerId = window.setTimeout(async () => {
        cardServerAvailabilityCheckTimerId = 0;

        if (requestToken !== cardServerAvailabilityCheckToken) {
            return;
        }

        await probeCardServerAvailability(context, field72ValueElement, requestToken);
    }, CARD_SERVER_AVAILABILITY_CHECK_DELAY_MS);
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

const setCardErrorMessage = (message) => {
    const errorNode = ensureCardErrorNode();
    if (!errorNode) return;

    const normalizedMessage = (message || '').trim();
    errorNode.textContent = normalizedMessage;
    errorNode.style.display = normalizedMessage ? 'block' : 'none';
};

const clearCardErrorMessage = () => {
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
    document.getElementById(CARD_LICENSE_MODAL_ID)?.remove();
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
            background: rgba(15, 23, 42, 0.64);
            backdrop-filter: blur(3px);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__dialog {
            width: min(860px, 100%);
            max-height: min(84vh, 760px);
            display: grid;
            grid-template-rows: auto 1fr auto;
            background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
            border-radius: 20px;
            border: 1px solid rgba(148, 163, 184, 0.35);
            box-shadow: 0 28px 80px rgba(15, 23, 42, 0.28);
            overflow: hidden;
            color: #0f172a;
            font-family: "Inter", "Segoe UI", Arial, sans-serif;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__header {
            padding: 22px 22px 14px;
            border-bottom: 1px solid rgba(148, 163, 184, 0.18);
            background:
                radial-gradient(circle at top left, rgba(79, 70, 229, 0.12), rgba(255, 255, 255, 0) 48%),
                linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.98));
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__title-row {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__eyebrow {
            margin: 0 0 6px;
            color: #4f46e5;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__title {
            margin: 0;
            font-size: 24px;
            line-height: 1.2;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__subtitle {
            margin: 8px 0 0;
            color: #475569;
            font-size: 14px;
            line-height: 1.4;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__icon-button,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__button {
            border: none;
            cursor: pointer;
            transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__icon-button {
            width: 38px;
            height: 38px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            background: rgba(148, 163, 184, 0.14);
            color: #334155;
            font-size: 20px;
            flex: 0 0 auto;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__icon-button:hover,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__button:hover {
            transform: translateY(-1px);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__body {
            padding: 20px 22px;
            overflow: auto;
            display: grid;
            gap: 16px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__panel {
            display: grid;
            gap: 12px;
            padding: 16px;
            border-radius: 16px;
            border: 1px solid rgba(148, 163, 184, 0.18);
            background: rgba(255, 255, 255, 0.92);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__overview-head,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__section-head,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__overview-heading,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__section-title,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group-title {
            margin: 0;
            font-size: 18px;
            line-height: 1.25;
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
            gap: 6px;
            padding: 6px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-pill--success {
            background: rgba(5, 150, 105, 0.12);
            color: #047857;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-pill--warning {
            background: rgba(217, 119, 6, 0.12);
            color: #b45309;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-pill--error {
            background: rgba(220, 38, 38, 0.12);
            color: #dc2626;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-note,
        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__error-state {
            border-radius: 14px;
            padding: 12px 14px;
            line-height: 1.5;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__status-note {
            background: rgba(79, 70, 229, 0.08);
            color: #4338ca;
            border: 1px solid rgba(79, 70, 229, 0.12);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__error-state {
            background: rgba(220, 38, 38, 0.08);
            color: #b91c1c;
            border: 1px solid rgba(220, 38, 38, 0.16);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__badges {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__badge {
            min-width: 120px;
            display: grid;
            gap: 4px;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(79, 70, 229, 0.08);
            border: 1px solid rgba(79, 70, 229, 0.12);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__badge-label {
            color: #6366f1;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__badge-value {
            color: #1e293b;
            font-size: 14px;
            font-weight: 700;
            line-height: 1.35;
            word-break: break-word;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group-list {
            display: grid;
            gap: 12px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-list {
            display: grid;
            gap: 8px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-item {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 14px;
            border-radius: 14px;
            background: rgba(248, 250, 252, 0.95);
            border: 1px solid rgba(226, 232, 240, 0.95);
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-main {
            min-width: 0;
            display: grid;
            gap: 4px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-name {
            margin: 0;
            color: #0f172a;
            font-size: 15px;
            font-weight: 700;
            line-height: 1.35;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-subtitle {
            margin: 0;
            color: #64748b;
            font-size: 12px;
            line-height: 1.45;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-meta {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 8px;
            flex: 0 0 auto;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__chip {
            background: rgba(148, 163, 184, 0.14);
            color: #334155;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__state {
            justify-items: start;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__spinner {
            width: 36px;
            height: 36px;
            border-radius: 999px;
            border: 3px solid rgba(79, 70, 229, 0.18);
            border-top-color: #4f46e5;
            animation: dao-license-modal-spin 0.9s linear infinite;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__empty-state {
            padding: 14px;
            border-radius: 14px;
            background: rgba(148, 163, 184, 0.1);
            color: #475569;
            line-height: 1.5;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__footer {
            display: flex;
            justify-content: flex-end;
            padding: 0 22px 22px;
        }

        #${CARD_LICENSE_MODAL_ID} .dao-license-modal__button {
            padding: 10px 16px;
            border-radius: 12px;
            background: rgba(79, 70, 229, 0.12);
            color: #4338ca;
            font-size: 14px;
            font-weight: 700;
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
                max-height: 88vh;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__header,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__body,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__footer {
                padding-left: 16px;
                padding-right: 16px;
            }

            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__license-item,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__overview-head,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__section-head,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__group-head,
            #${CARD_LICENSE_MODAL_ID} .dao-license-modal__title-row {
                flex-direction: column;
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

const createCardLicenseModalChip = (text) => createCardLicenseModalNode('span', 'dao-license-modal__chip', text);

const resolveCardLicenseStatusTone = (status) => {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!normalizedStatus) {
        return 'warning';
    }

    if (normalizedStatus === 'ok' || normalizedStatus === 'success') {
        return 'success';
    }

    if (['error', 'failed', 'invalid', 'denied'].some((token) => normalizedStatus.includes(token))) {
        return 'error';
    }

    return 'warning';
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
            <div class="dao-license-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="dao-license-modal-title">
                <div class="dao-license-modal__header">
                    <div class="dao-license-modal__title-row">
                        <div>
                            <p class="dao-license-modal__eyebrow">Syrve license check</p>
                            <h2 id="dao-license-modal-title" class="dao-license-modal__title" data-role="title"></h2>
                            <p class="dao-license-modal__subtitle" data-role="subtitle"></p>
                        </div>
                        <button type="button" class="dao-license-modal__icon-button" data-role="close" aria-label="Закрити">×</button>
                    </div>
                </div>
                <div class="dao-license-modal__body" data-role="body"></div>
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
        titleNode: modal.querySelector('[data-role="title"]'),
        subtitleNode: modal.querySelector('[data-role="subtitle"]'),
        bodyNode: modal.querySelector('[data-role="body"]'),
        closeNode: modal.querySelector('[data-role="close"]')
    };
};

const renderCardLicenseModal = ({ title, subtitle, content }) => {
    const { titleNode, subtitleNode, bodyNode, closeNode } = ensureCardLicenseModalShell();
    titleNode.textContent = title;
    subtitleNode.textContent = subtitle || '';
    subtitleNode.style.display = subtitle ? 'block' : 'none';
    bodyNode.replaceChildren(content);

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

    const overviewPanel = createCardLicenseModalNode('section', 'dao-license-modal__panel');
    const overviewHead = createCardLicenseModalNode('div', 'dao-license-modal__overview-head');
    const overviewTitleWrap = createCardLicenseModalNode('div', 'dao-license-modal__overview-title-wrap');
    overviewTitleWrap.appendChild(createCardLicenseModalNode('h3', 'dao-license-modal__overview-heading', serverInfo.companyName || 'Сервер Syrve'));
    overviewTitleWrap.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__overview-caption', formatCardServerContextLabel(serverContext)));
    overviewHead.appendChild(overviewTitleWrap);

    if (serverInfo.licenseStatus) {
        const statusPill = createCardLicenseModalNode(
            'span',
            `dao-license-modal__status-pill dao-license-modal__status-pill--${resolveCardLicenseStatusTone(serverInfo.licenseStatus)}`,
            `Статус: ${serverInfo.licenseStatus}`
        );
        overviewHead.appendChild(statusPill);
    }

    overviewPanel.appendChild(overviewHead);

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

    if (serverInfo.statusMessage) {
        overviewPanel.appendChild(createCardLicenseModalNode('div', 'dao-license-modal__status-note', serverInfo.statusMessage));
    }

    fragment.appendChild(overviewPanel);

    const licensesPanel = createCardLicenseModalNode('section', 'dao-license-modal__panel');
    const licensesHead = createCardLicenseModalNode('div', 'dao-license-modal__section-head');
    const sectionTitleWrap = createCardLicenseModalNode('div', 'dao-license-modal__section-title-wrap');
    sectionTitleWrap.appendChild(createCardLicenseModalNode('h3', 'dao-license-modal__section-title', 'Ліцензії'));
    sectionTitleWrap.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__section-caption', 'Результат серверної перевірки ліцензій Syrve.'));
    licensesHead.appendChild(sectionTitleWrap);
    licensesHead.appendChild(createCardLicenseModalChip(`${licenses.length} позицій`));
    licensesPanel.appendChild(licensesHead);

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

        const groupNode = createCardLicenseModalNode('section', 'dao-license-modal__group');
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
            if (license.id) {
                secondaryParts.push(`ID ${license.id}`);
            }

            const item = createCardLicenseModalNode('article', 'dao-license-modal__license-item');
            const main = createCardLicenseModalNode('div', 'dao-license-modal__license-main');
            main.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__license-name', primaryName));
            if (secondaryParts.length) {
                main.appendChild(createCardLicenseModalNode('p', 'dao-license-modal__license-subtitle', secondaryParts.join(' • ')));
            }

            const meta = createCardLicenseModalNode('div', 'dao-license-modal__license-meta');
            if (license.count !== null && license.count !== undefined) {
                meta.appendChild(createCardLicenseModalChip(`К-сть ${license.count}`));
            }
            if (license.validUntil) {
                meta.appendChild(createCardLicenseModalChip(`До ${license.validUntil}`));
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
        title: 'Перевірка ліцензій Syrve',
        subtitle: formatCardServerContextLabel(serverContext),
        content: buildCardLicenseLoadingContent()
    });
};

const showCardLicenseErrorModal = (serverContext, errorMessage) => {
    renderCardLicenseModal({
        title: 'Перевірка ліцензій Syrve',
        subtitle: formatCardServerContextLabel(serverContext),
        content: buildCardLicenseErrorContent(errorMessage)
    });
};

const showCardLicenseResultModal = (serverContext, licenseResult) => {
    renderCardLicenseModal({
        title: 'Ліцензії Syrve',
        subtitle: formatCardServerContextLabel(serverContext),
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
    if (!context?.server) {
        clearCardErrorMessage();
        return false;
    }

    try {
        const clientId = await getUserInputFromStorage();
        if (!clientId || clientId === 'default_value') {
            clearCardErrorMessage();
            return false;
        }

        const lastError = await fetchLastErrorForClient(clientId);
        if (!lastError) {
            clearCardErrorMessage();
            return false;
        }

        if (forceShowAnyError || isCardErrorRelevantToServer(lastError, context)) {
            setCardErrorMessage(`Остання помилка для сервера ${context.server}${context.port ? `:${context.port}` : ''}:\n${lastError}`);
            return true;
        }

        clearCardErrorMessage();
        return false;
    } catch (error) {
        console.error('Не вдалося отримати останню помилку для картки:', error);
        clearCardErrorMessage();
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
                    const extractedServer = extractDaoCloudAddress(rawField72Value);
                    const serverContext = resolveCardServerContext(extractedServer, '');
                    if (!serverContext?.server) {
                        console.warn("Адреса сервера не знайдена, дію скасовано.");
                        return;
                    }

                    const field74ValueElement = document.querySelector(
                        "body > main > div.body-container > div > div.page-layout-block.handbook-card-container.page-layout-block-gray.b-last-block > div.b-main-block-content > div.baron_wrapper.baron_wrapper_scroll_redirect > div > div.b-main-block.baron_container > div > div > div > div > div > div > div > div:nth-child(7) > div > div > div > div > div > div > div > div.object-edit-field-bottom-panel-rc__wrapper-box > div > div.view > div > span"
                    );
                    const field74Value = field74ValueElement ? field74ValueElement.textContent.trim() : null;
                    const finalServerContext = resolveCardServerContext(serverContext.server, field74Value);

                    // Отримуємо збережене значення з chrome.storage
                    try {
                        const savedField = await getUserInputFromStorage();
                        console.log("Збережене значення:", savedField);

                        // Формуємо дані для запиту
                        const payload = {
                            address: finalServerContext?.server || serverContext.server,
                            port: finalServerContext?.port || '',
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
                            const hasError = await pollCardServerError(finalServerContext || serverContext);

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
                                fallbackMessage: `Не вдалося виконати запит до сервера ${(finalServerContext || serverContext).server}${(finalServerContext || serverContext).port ? `:${(finalServerContext || serverContext).port}` : ''}. Код відповіді: ${response.status}.`
                            });
                            resetCardLoginStatus();
                        }
                    } catch (error) {
                        console.error("Помилка мережі:", error);
                        setCardErrorMessage(`Помилка підключення до сервера ${(finalServerContext || serverContext).server}${(finalServerContext || serverContext).port ? `:${(finalServerContext || serverContext).port}` : ''}. Перевірте адресу, порт та доступність сервера.`);
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
    const LICENSE_MANAGER_BASE = "https://syrve-license-manager-1038989357415.us-west1.run.app/";
    const BUTTONS_ID = CARD_BUTTONS_ID;

    const getCardScopeRoot = (element) => (
        element?.closest('.g-popup-win-scroll-content, .page-layout-block.handbook-card-container, .object-edit-win-target, .object-edit-win-location-field')
        || document
    );

    const getServerData = (scopeRoot = document, showAlert = true) => {
        const serverField = scopeRoot.querySelector('.field-target[f-id="72"] .ObjectEditFieldBase__view__value__text');
        const rawServer = serverField ? serverField.textContent.trim() : '';
        const extractedServer = extractDaoCloudAddress(rawServer);

        if (!extractedServer) {
            if (showAlert) {
                alert("Адресу сервера не знайдено. Перевірте поле адреси.");
            }
            return null;
        }

        const portField = scopeRoot.querySelector('.field-target[f-id="74"] .ObjectEditFieldBase__view__value__text');
        const port = portField ? portField.textContent.trim() : '';

        return resolveCardServerContext(extractedServer, port);
    };

    const createLicenseBtn = (label, action, color, scopeRoot) => {
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

            if (action === 'check') {
                await handleCardLicenseCheck(btn, serverData);
                return;
            }

            pollCardServerError(serverData).catch((error) => {
                console.error('Не вдалося оновити помилку під кнопками ліцензії:', error);
            });

            const { server, port } = serverData;
            const portParam = port ? `&port=${encodeURIComponent(port)}` : '';
            window.open(`${LICENSE_MANAGER_BASE}?server=${encodeURIComponent(server)}${portParam}&action=${action}`, '_blank');
        });
        return btn;
    };

    const openSyrvePageWithCredentials = ({ server, path }) => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'OPEN_SYRVE_PAGE',
            server,
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

    const createRestoBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = 'open-resto-button';
        btn.textContent = ' Вебморда';
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
                    path: '/resto'
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
        btn.textContent = 'Пристрої';
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
                    path: '/resto/service/monitoring/connections.jsp'
                });
            } catch (error) {
                console.error('Не вдалося відкрити сторінку пристроїв Syrve:', error);
                setCardErrorMessage(`Не вдалося відкрити Пристрої: ${error?.message || 'невідома помилка'}`);
            }
        });
        return btn;
    };

    const createPeriodBtn = (scopeRoot) => {
        const btn = document.createElement('button');
        btn.id = 'get-period-button';
        btn.textContent = 'Період';
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
            container.style.cssText = `
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 6px;
                padding: 6px 0 2px 0;
            `;
            container.appendChild(createLicenseBtn("✓ Перевірити", "check", "#059669", scopeRoot));
            container.appendChild(createLicenseBtn("↻ Оновити", "update", "#d97706", scopeRoot));
            container.appendChild(createRestoBtn(scopeRoot));
            container.appendChild(createDevicesBtn(scopeRoot));
            container.appendChild(createPeriodBtn(scopeRoot));

            wrapperBox.after(container);
        } else if (container.previousElementSibling !== wrapperBox) {
            wrapperBox.after(container);
        }

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
        }
    });

    panelObserver.observe(document.body, { childList: true, subtree: true });

    // Одразу пробуємо, якщо елемент вже є
    document.querySelectorAll('.field-target[f-id="72"]').forEach((serverFieldTarget) => {
        injectPanelButtons(serverFieldTarget);
    });
})();

// --- Логіка для сторінки-списку довідника: sticky hover-панель масових дій ---
(() => {
    const LICENSE_MANAGER_BASE = "https://syrve-license-manager-1038989357415.us-west1.run.app/";

    // Стабільні ідентифікатори колонок Planfix з data-columnid у header DOM.
    const HEADER_CLIENT = 'Клієнт';
    const HEADER_SERVER = 'Сервер';
    const HEADER_PORT   = 'Порт';
    const HEADER_CHAIN  = 'Chain';

    const COLUMN_IDS = {
        [HEADER_CLIENT]: '80',
        [HEADER_SERVER]: '72',
        [HEADER_PORT]: '74',
        [HEADER_CHAIN]: '260'
    };

    const DEFAULT_COL_CLASSES = {
        [HEADER_CLIENT]: 'td-item-qe-4',
        [HEADER_SERVER]: 'td-item-qe-6',
        [HEADER_PORT]: 'td-item-qe-10',
        [HEADER_CHAIN]: 'td-item-qe-8'
    };

    const findQeClassSuffix = (element) => {
        if (!element) return null;
        const matchedClass = [...element.classList].find((cls) => /(?:^|-)qe-\d+$/.test(cls));
        if (!matchedClass) return null;
        const match = matchedClass.match(/qe-(\d+)$/);
        return match ? match[1] : null;
    };

    // Знаходить реальний CSS-клас td для колонки через data-columnid у header DOM.
    const findColClass = (headerText) => {
        const columnId = COLUMN_IDS[headerText];
        if (!columnId) return DEFAULT_COL_CLASSES[headerText] || null;

        const headerTrigger = document.querySelector(`.td-head-common-sort[data-columnid="${columnId}"]`)
            || document.querySelector(`[data-columnid="${columnId}"]`);
        const headerCell = headerTrigger?.closest('td, th, .td-head');
        const qeSuffix = findQeClassSuffix(headerCell) || findQeClassSuffix(headerTrigger);
        if (qeSuffix) return `td-item-qe-${qeSuffix}`;

        return DEFAULT_COL_CLASSES[headerText] || null;
    };

    // Читати текст ячейки через CSS-клас td та <a>-посилання
    const cellText = (row, colClass) => {
        if (!colClass) return '';
        const td = row.querySelector(`td.${colClass}`);
        if (!td) return '';
        const link = td.querySelector('a');
        return (link ? link.textContent : td.textContent).trim();
    };

    const resolveServerEntry = (rawServer, rawPort) => {
        if (!rawServer) return null;

        const extractedServer = extractDaoCloudAddress(rawServer);
        if (!extractedServer) return null;

        const serverContext = resolveCardServerContext(extractedServer, rawPort);
        if (!serverContext) return null;

        return serverContext.port
            ? `${serverContext.server}:${serverContext.port}`
            : serverContext.server;
    };

    // Зібрати унікальні пари server:port для групи
    const collectServers = (colClass, groupValue) => {
        const rows = document.querySelectorAll('tr.handbook-data-item');
        const seen = new Set();
        const result = [];
        const serverClass = findColClass(HEADER_SERVER);
        const portClass   = findColClass(HEADER_PORT);
        rows.forEach(row => {
            if (cellText(row, colClass) !== groupValue) return;
            const entry = resolveServerEntry(
                cellText(row, serverClass),
                cellText(row, portClass)
            );
            if (!entry) return;
            if (!seen.has(entry)) { seen.add(entry); result.push(entry); }
        });
        return result;
    };

    const collectAllServersOnPage = () => {
        const rows = document.querySelectorAll('tr.handbook-data-item');
        const seen = new Set();
        const result = [];
        const serverClass = findColClass(HEADER_SERVER);
        const portClass   = findColClass(HEADER_PORT);

        rows.forEach((row) => {
            const entry = resolveServerEntry(
                cellText(row, serverClass),
                cellText(row, portClass)
            );
            if (!entry || seen.has(entry)) return;
            seen.add(entry);
            result.push(entry);
        });

        return result;
    };

    // --- Floating panel ---
    const panel = document.createElement('div');
    panel.id = 'bulk-hover-panel';
    panel.style.cssText = `
        position: fixed;
        z-index: 99999;
        background: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 10px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.14);
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
    document.body.appendChild(panel);

    const makeBtn = (label, bg, onClick) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = `
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 5px;
            border: none;
            font-weight: 600;
            font-size: 11px;
            background: ${bg};
            color: #fff;
            transition: opacity 0.15s ease;
            white-space: nowrap;
            flex-shrink: 0;
        `;
        btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.75'; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
        btn.addEventListener('click', onClick);
        return btn;
    };

    const makeActionRow = (label, value, onOpen) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        const lbl = document.createElement('span');
        lbl.textContent = `${label}:`;
        lbl.style.cssText = 'color: #6b7280; font-weight: 500; flex-shrink: 0; min-width: 46px; font-size: 11px;';

        const val = document.createElement('span');
        val.textContent = value;
        val.style.cssText = 'font-weight: 600; color: #111827; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

        row.appendChild(lbl);
        row.appendChild(val);
        row.appendChild(makeBtn('✓ Перевірити', '#059669', () => onOpen('check')));
        row.appendChild(makeBtn('↻ Оновити',    '#d97706', () => onOpen('update')));
        return row;
    };

    const makeGroupRow = (label, value, colClass) => {
        if (!value) return null;

        return makeActionRow(label, value, (action) => {
            const servers = collectServers(colClass, value);
            if (!servers.length) { alert(`Не знайдено серверів для: ${value}`); return; }
            window.open(`${LICENSE_MANAGER_BASE}?servers=${encodeURIComponent(servers.join(','))}&action=${action}`, '_blank');
        });
    };

    const makeAllServersRow = () => {
        return makeActionRow('Сервери', 'Усі на сторінці', (action) => {
            const servers = collectAllServersOnPage();
            if (!servers.length) {
                alert('Не знайдено серверів на поточній сторінці.');
                return;
            }

            window.open(`${LICENSE_MANAGER_BASE}?servers=${encodeURIComponent(servers.join(','))}&action=${action}`, '_blank');
        });
    };

    const HOVER_HIDE_DELAY = 1000;
    let hideTimer = null;
    let hideAnimationTimer = null;
    let activeHoverCell = null;

    // Позиціонувати панель під ячейкою, вирівнюючи по лівому краю
    const positionBelow = (td) => {
        const rect = td.getBoundingClientRect();
        const panelW = panel.offsetWidth || 260;

        // вертикально: під ячейкою + 4px
        let top = rect.bottom + 4;

        // горизонтально: від лівого краю ячейки, з урахуванням меж екрану
        let left = rect.left;
        if (left + panelW > window.innerWidth - 8) {
            left = window.innerWidth - panelW - 8;
        }
        left = Math.max(8, left);

        panel.style.top  = `${top}px`;
        panel.style.left = `${left}px`;
        panel.style.right = 'auto';
    };

    const showPanel = (anchorElement, renderRow) => {
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
        // Позиціонуємо після display:flex, щоб offsetWidth був актуальним
        requestAnimationFrame(() => {
            positionBelow(anchorElement);
            panel.style.opacity = '1';
        });
    };

    const hidePanel = (delay = 200) => {
        clearTimeout(hideTimer);
        hideTimer = null;
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
    };

    panel.addEventListener('mouseenter', () => {
        clearTimeout(hideTimer);
        hideTimer = null;
    });
    panel.addEventListener('mouseleave', () => hidePanel(150));

    // Підвішуємо події на конкретні ячейки (Chain / Клієнт)
    const COLS = [
        { headerText: HEADER_CHAIN,  label: 'Chain'   },
        { headerText: HEADER_CLIENT, label: 'Клієнт' },
    ];

    const attachCellHover = () => {
        document.querySelectorAll('tr.handbook-data-item').forEach(row => {
            COLS.forEach(({ headerText, label }) => {
                const colClass = findColClass(headerText);
                if (!colClass) return;
                const td = row.querySelector(`td.${colClass}`);
                if (!td || td.dataset.hoverAttached) return;
                td.dataset.hoverAttached = '1';
                td.style.cursor = 'default';

                td.addEventListener('mouseenter', () => {
                    const value = cellText(row, colClass);
                    showPanel(td, () => makeGroupRow(label, value, colClass));
                });
                td.addEventListener('mouseleave', () => hidePanel(HOVER_HIDE_DELAY));
            });
        });
    };

    const attachServerHeaderHover = () => {
        const headerTrigger = document.querySelector(`.td-head-common-sort[data-columnid="${COLUMN_IDS[HEADER_SERVER]}"]`)
            || document.querySelector(`[data-columnid="${COLUMN_IDS[HEADER_SERVER]}"]`);
        const hoverTarget = headerTrigger?.closest('td, th, .td-head') || headerTrigger;
        if (!hoverTarget || hoverTarget.dataset.serverHoverAttached) return;

        hoverTarget.dataset.serverHoverAttached = '1';
        hoverTarget.style.cursor = 'default';

        hoverTarget.addEventListener('mouseenter', () => {
            showPanel(hoverTarget, () => makeAllServersRow());
        });
        hoverTarget.addEventListener('mouseleave', () => hidePanel(HOVER_HIDE_DELAY));
    };

    const attachHoverTargets = () => {
        attachCellHover();
        attachServerHeaderHover();
    };

    const observer = new MutationObserver(attachHoverTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    attachHoverTargets();
})();
