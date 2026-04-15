const inputField = document.getElementById("inputField");
const saveButton = document.getElementById("saveButton");
const requestAccessButton = document.getElementById("requestAccessButton");
const claimFieldGroup = document.getElementById("claimFieldGroup");
const claimCodeInput = document.getElementById("claimCodeInput");
const claimAccessButton = document.getElementById("claimAccessButton");
const cancelAccessSetupButton = document.getElementById("cancelAccessSetupButton");
const accessSetupCard = document.getElementById("accessSetupCard");
const accessStatusBadge = document.getElementById("accessStatusBadge");
const accessIntro = document.getElementById("accessIntro");
const accessStatusBox = document.getElementById("accessStatusBox");
const accessStatusTitle = document.getElementById("accessStatusTitle");
const accessHelpText = document.getElementById("accessHelpText");
const accessMessage = document.getElementById("accessMessage");
const mainContent = document.getElementById("mainContent");
const serverField = document.getElementById("serverField");
const portField = document.getElementById("portField");
const sendDataButton = document.getElementById("sendDataButton");
const modeInfo = document.getElementById("modeInfo");
const toggleModeButton = document.getElementById("toggleModeButton");
const showErrorButton = document.getElementById("showErrorButton");
const errorMessage = document.getElementById("errorMessage");
const taskHighlightSettings = document.getElementById("taskHighlightSettings");
const taskHighlightToggle = document.getElementById("taskHighlightToggle");
const taskHighlightColorInput = document.getElementById("taskHighlightColor");
const taskOverdueBlinkToggle = document.getElementById("taskOverdueBlinkToggle");
const inlineServerError = document.getElementById("inlineServerError");
const clientStatus = document.getElementById("clientStatus");
const clientIdBadge = document.getElementById("clientIdBadge");
const editClientBtn = document.getElementById("editClientBtn");
const discoBall = document.getElementById("discoBall");

const STORAGE_KEYS = {
  userId: "userInput",
  legacyApiKey: "credentialsApiKey",
  extensionClientId: "extensionClientId",
  extensionRequestId: "extensionAccessRequestId",
  extensionKey: "extensionAccessKey",
  accessNotice: "extensionAccessNotice",
  discoMode: "discoMode",
  serverContext: "lastServerContext",
  taskHighlightEnabled: "pipTimeTrackerTaskHighlightEnabled",
  taskHighlightColor: "pipTimeTrackerTaskHighlightColor",
  taskOverdueBlinkEnabled: "pipTimeTrackerTaskOverdueBlinkEnabled"
};

const KNOWN_443_DOMAINS = ["syrve.online", "daocloud.it"];
const HTTP_ONLY_DOMAINS = ["daocloud.fun"];
const INLINE_ERROR_POLL_DELAYS = [0, 1200, 2500, 5000];
const STATUS_BOX_TONES = ["neutral", "warning", "success", "error"];
const STATUS_PILL_TONES = ["neutral", "warning", "success"];
const DEFAULT_TASK_HIGHLIGHT_SETTINGS = Object.freeze({
  enabled: false,
  color: "#2fd212",
  overdueBlinkEnabled: false
});

let inlineErrorPollToken = 0;
let popupAccessState = null;
let isAccessSetupForced = false;

const storageGet = (keys) => new Promise((resolve) => {
  chrome.storage.local.get(keys, (result) => {
    resolve(result || {});
  });
});

const storageSet = (data) => new Promise((resolve) => {
  chrome.storage.local.set(data, () => {
    resolve();
  });
});

const normalizeHexColor = (value, fallback = DEFAULT_TASK_HIGHLIGHT_SETTINGS.color) => {
  const normalizedValue = String(value || "").trim();
  const shortHexMatch = normalizedValue.match(/^#([\da-fA-F]{3})$/);
  if (shortHexMatch) {
    return `#${shortHexMatch[1].split("").map((char) => `${char}${char}`).join("")}`.toLowerCase();
  }

  if (/^#([\da-fA-F]{6})$/.test(normalizedValue)) {
    return normalizedValue.toLowerCase();
  }

  return fallback;
};

const getTaskHighlightSettings = (storageState = {}) => ({
  enabled: storageState[STORAGE_KEYS.taskHighlightEnabled] === true,
  color: normalizeHexColor(storageState[STORAGE_KEYS.taskHighlightColor]),
  overdueBlinkEnabled: storageState[STORAGE_KEYS.taskOverdueBlinkEnabled] === true
});

const applyTaskHighlightSettingsState = (settings) => {
  const nextSettings = {
    enabled: settings?.enabled === true,
    color: normalizeHexColor(settings?.color),
    overdueBlinkEnabled: settings?.overdueBlinkEnabled === true
  };

  if (taskHighlightToggle) {
    taskHighlightToggle.checked = nextSettings.enabled;
  }

  if (taskHighlightColorInput) {
    taskHighlightColorInput.value = nextSettings.color;
    taskHighlightColorInput.disabled = !nextSettings.enabled;
  }

  if (taskOverdueBlinkToggle) {
    taskOverdueBlinkToggle.checked = nextSettings.overdueBlinkEnabled;
  }

  taskHighlightSettings?.classList.toggle(
    "highlight-settings--disabled",
    !nextSettings.enabled && !nextSettings.overdueBlinkEnabled
  );
};

const persistTaskHighlightSettings = async (settings) => {
  const nextSettings = {
    enabled: settings?.enabled === true,
    color: normalizeHexColor(settings?.color),
    overdueBlinkEnabled: settings?.overdueBlinkEnabled === true
  };

  applyTaskHighlightSettingsState(nextSettings);
  await storageSet({
    [STORAGE_KEYS.taskHighlightEnabled]: nextSettings.enabled,
    [STORAGE_KEYS.taskHighlightColor]: nextSettings.color,
    [STORAGE_KEYS.taskOverdueBlinkEnabled]: nextSettings.overdueBlinkEnabled
  });
};

const sendRuntimeMessage = (message) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      reject(new Error(chrome.runtime.lastError.message));
      return;
    }

    if (!response?.ok) {
      reject(new Error(response?.error || "Помилка обробки запиту розширення."));
      return;
    }

    resolve(response);
  });
});

const isNumericUserId = (value) => /^\d+$/.test((value || "").trim());

const setButtonBusy = (button, isBusy, busyLabel) => {
  if (!button) return;

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }

  button.disabled = isBusy;
  button.textContent = isBusy ? busyLabel : button.dataset.defaultLabel;
};

const applyStatusTone = (element, baseClass, tone, tones) => {
  if (!element) return;

  tones.forEach((value) => {
    element.classList.remove(`${baseClass}--${value}`);
  });

  element.classList.add(`${baseClass}--${tone}`);
};

const setAccessMessage = (message, tone = "neutral") => {
  if (!accessMessage) return;

  const normalizedMessage = (message || "").trim();
  accessMessage.textContent = normalizedMessage;
  accessMessage.classList.toggle("is-hidden", !normalizedMessage);
  applyStatusTone(accessMessage, "status-box", tone, STATUS_BOX_TONES);
};

const clearAccessMessage = () => {
  setAccessMessage("");
};

const getAccessViewModel = (state, isForced) => {
  const status = state?.status || "needs-user";

  if (status === "granted") {
    return {
      badge: "Доступ активний",
      badgeTone: "success",
      boxTone: "success",
      title: isForced
        ? "Персональний ключ активний для цього пристрою"
        : "Персональний ключ отримано",
      intro: isForced
        ? "Можна оновити User ID. Якщо ви зміните його, доступ до пристрою потрібно буде запросити заново."
        : "Пристрій уже має персональний доступ до захищених маршрутів.",
      help: "Поверніться до інструментів або змініть User ID, якщо доступ треба перевипустити для іншого користувача.",
      showStatusBox: true,
      showRequestControls: false
    };
  }

  if (status === "awaiting-claim") {
    return {
      badge: "Очікує коду",
      badgeTone: "warning",
      boxTone: "warning",
      title: "",
      intro: "Пристрій уже зареєстровано. Після схвалення, введіть одноразовий код підтвердження який вам нададуть.",
      help: "",
      showStatusBox: false,
      showRequestControls: true
    };
  }

  if (status === "ready-to-request") {
    return {
      badge: "Готово до запиту",
      badgeTone: "neutral",
      boxTone: "neutral",
      title: "",
      intro: "Тепер можна надіслати запит на схвалення цього пристрою.",
      help: "",
      showStatusBox: false,
      showRequestControls: true
    };
  }

  return {
    badge: "Потрібне налаштування",
    badgeTone: "warning",
    boxTone: "warning",
    title: "Спочатку збережіть User ID",
    intro: "Щоб працювати з розширенням, пристрій має пройти ручне схвалення.",
    help: "",
    showStatusBox: true,
    showRequestControls: true
  };
};

const splitServerAddressCandidates = (rawAddress) => {
  const normalizedAddress = String(rawAddress || "").trim();
  if (!normalizedAddress) {
    return [];
  }

  const parts = normalizedAddress.split(/\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [normalizedAddress];
};

const parseServerEndpoint = (value) => {
  const rawValue = String(value || "").trim();
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
      .replace(/^[a-z]+:\/\//i, "")
      .split(/[/?#]/)[0]
      .trim();

    if (!sanitizedValue) {
      return null;
    }

    const bracketMatch = sanitizedValue.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (bracketMatch) {
      return {
        server: bracketMatch[1].trim().toLowerCase(),
        port: (bracketMatch[2] || "").trim()
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
      port: ""
    };
  }
};

const normalizeServer = (value) => {
  return parseServerEndpoint(value)?.server || "";
};

const getIpv4Octets = (value) => {
  const normalizedValue = String(value || "").trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedValue)) {
    return null;
  }

  const octets = normalizedValue.split(".").map((part) => Number(part));
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? octets : null;
};

const isPrivateOrReservedIpv4 = (value) => {
  const octets = getIpv4Octets(value);
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

const isPublicIpv4 = (value) => Boolean(getIpv4Octets(value)) && !isPrivateOrReservedIpv4(value);

const isPublicDomain = (value) => {
  const normalizedServer = normalizeServer(value);
  if (!normalizedServer || getIpv4Octets(normalizedServer)) {
    return false;
  }

  if (!normalizedServer.includes(".") || normalizedServer === "localhost") {
    return false;
  }

  if ([".local", ".lan", ".home", ".internal", ".localhost"].some((suffix) => normalizedServer.endsWith(suffix))) {
    return false;
  }

  return normalizedServer.split(".").every((label) => (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
    && !/^\d+$/.test(label)
  ));
};

const classifyServerHost = (value) => {
  const normalizedServer = normalizeServer(value);
  if (!normalizedServer) {
    return "unknown";
  }

  if (isPublicDomain(normalizedServer)) {
    return "public-domain";
  }

  if (isPublicIpv4(normalizedServer)) {
    return "public-ipv4";
  }

  if (isPrivateOrReservedIpv4(normalizedServer)) {
    return "private-ipv4";
  }

  return "unknown";
};

const selectPreferredServerAddress = (rawAddress) => {
  const candidates = splitServerAddressCandidates(rawAddress)
    .map((part) => {
      const endpoint = parseServerEndpoint(part);
      if (!endpoint?.server) {
        return null;
      }

      const hostType = classifyServerHost(endpoint.server);
      if (hostType === "unknown") {
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

  const publicDomainCandidate = candidates.find((candidate) => candidate.hostType === "public-domain");
  if (publicDomainCandidate) {
    return publicDomainCandidate;
  }

  const publicIpv4Candidate = candidates.find((candidate) => candidate.hostType === "public-ipv4");
  if (publicIpv4Candidate) {
    return publicIpv4Candidate;
  }

  if (candidates.some((candidate) => candidate.hostType === "private-ipv4")) {
    return { errorCode: "private-only" };
  }

  return { errorCode: "not-found" };
};

const buildServerSelectionErrorMessage = (selectionResult) => {
  if (selectionResult?.errorCode === "private-only") {
    return "У полі адреси знайдено лише внутрішню адресу сервера. Вкажіть зовнішню адресу або публічний домен.";
  }

  return "Вкажіть коректну зовнішню адресу сервера або публічний домен.";
};

const shouldUseDefaultSecurePort = (server) => {
  const normalizedServer = normalizeServer(server);
  return KNOWN_443_DOMAINS.some((domain) => normalizedServer.endsWith(domain));
};

const requiresExplicitPort = (server) => {
  const normalizedServer = normalizeServer(server);
  return isPublicIpv4(normalizedServer)
    || HTTP_ONLY_DOMAINS.some((domain) => normalizedServer.endsWith(domain));
};

const buildPortRequiredErrorMessage = (server) => (
  isPublicIpv4(server)
    ? "Для зовнішньої IP-адреси потрібно вказати порт сервера."
    : "Для серверів daocloud.fun потрібно вказати порт сервера."
);

const resolvePort = (server, port) => {
  const parsedInput = server && typeof server === "object"
    ? server
    : parseServerEndpoint(server);
  const normalizedServer = normalizeServer(parsedInput?.server || server);
  const explicitPort = (port || "").trim();
  if (explicitPort) {
    return explicitPort;
  }

  const embeddedPort = String(parsedInput?.port || "").trim();
  if (embeddedPort) {
    return embeddedPort;
  }

  if (shouldUseDefaultSecurePort(normalizedServer)) {
    return "443";
  }

  return "";
};

const getCurrentServerContextResult = () => {
  const selection = selectPreferredServerAddress(serverField.value);
  if (!selection?.server) {
    return {
      context: null,
      errorMessage: buildServerSelectionErrorMessage(selection)
    };
  }

  const server = normalizeServer(selection.server);
  if (!server) {
    return {
      context: null,
      errorMessage: buildServerSelectionErrorMessage(selection)
    };
  }

  const port = resolvePort(selection, portField.value);
  if (requiresExplicitPort(server) && !port) {
    return {
      context: null,
      errorMessage: buildPortRequiredErrorMessage(server)
    };
  }

  return {
    context: {
      server,
      port
    },
    errorMessage: ""
  };
};

const getCurrentServerContext = () => {
  return getCurrentServerContextResult().context;
};

const serverContextToStorage = (context) => {
  if (!context?.server) {
    return null;
  }

  return {
    server: context.server,
    port: context.port || ""
  };
};

const setInlineServerError = (message) => {
  if (!inlineServerError) return;

  const normalizedMessage = (message || "").trim();
  inlineServerError.textContent = normalizedMessage;
  inlineServerError.classList.toggle("is-visible", normalizedMessage.length > 0);
};

const clearInlineServerError = () => {
  setInlineServerError("");
};

const invalidateInlineErrorPolling = () => {
  inlineErrorPollToken += 1;
};

const wait = (delay) => new Promise((resolve) => {
  setTimeout(resolve, delay);
});

const applyServerFieldState = () => {
  const selection = selectPreferredServerAddress(serverField.value);
  const value = selection?.server || "";
  const currentPort = (portField.value || "").trim();

  if (value && shouldUseDefaultSecurePort(value) && !currentPort) {
    portField.value = "443";
  }
};

const restoreServerContext = (context) => {
  if (!context?.server) {
    applyServerFieldState();
    return;
  }

  serverField.value = context.server;
  portField.value = context.port || "";
  applyServerFieldState();
};

const persistCurrentServerContext = async () => {
  const context = serverContextToStorage(getCurrentServerContext());
  await storageSet({ [STORAGE_KEYS.serverContext]: context });
};

const fetchLastError = async (clientId) => {
  const response = await fetch("https://planfix-to-syrve.com:8000/get_last_error/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });

  if (!response.ok) {
    throw new Error(`Bad request, plugin could not reach server. Status: ${response.status}`);
  }

  const data = await response.json();
  return (data.last_error || "").trim();
};

const isErrorRelevantToServer = (errorText, context) => {
  if (!errorText || !context?.server) {
    return false;
  }

  const normalizedError = errorText.toLowerCase();
  const normalizedServer = context.server.toLowerCase();
  const candidates = [normalizedServer];

  if (context.port) {
    candidates.push(`${normalizedServer}:${context.port}`);
    candidates.push(`port ${context.port}`);
    candidates.push(`порт ${context.port}`);
  }

  return candidates.some((candidate) => normalizedError.includes(candidate));
};

const refreshInlineServerError = async (options = {}) => {
  const { forceShowAnyError = false } = options;
  const userId = (await storageGet([STORAGE_KEYS.userId]))[STORAGE_KEYS.userId];
  const context = getCurrentServerContext();

  if (!userId || !context?.server) {
    clearInlineServerError();
    return false;
  }

  try {
    const lastError = await fetchLastError(userId);

    if (!lastError) {
      clearInlineServerError();
      return false;
    }

    if (forceShowAnyError || isErrorRelevantToServer(lastError, context)) {
      setInlineServerError(`Остання помилка для сервера ${context.server}${context.port ? `:${context.port}` : ""}:\n${lastError}`);
      return true;
    }

    clearInlineServerError();
    return false;
  } catch (error) {
    console.error("Error fetching inline server error:", error);
    clearInlineServerError();
    return false;
  }
};

const pollInlineServerError = async (options = {}) => {
  const { forceShowAnyError = false, fallbackMessage = "" } = options;
  const pollToken = ++inlineErrorPollToken;

  for (const delay of INLINE_ERROR_POLL_DELAYS) {
    if (delay > 0) {
      await wait(delay);
    }

    if (pollToken !== inlineErrorPollToken) {
      return false;
    }

    const rendered = await refreshInlineServerError({ forceShowAnyError });
    if (rendered) {
      return true;
    }
  }

  if (pollToken === inlineErrorPollToken && fallbackMessage) {
    setInlineServerError(fallbackMessage);
    return true;
  }

  return false;
};

const updateClientIdUI = (value) => {
  const normalized = (value || "").trim();
  const hasValue = normalized.length > 0;

  if (hasValue) {
    clientIdBadge.textContent = normalized;
    clientStatus?.classList.remove("is-hidden");
    editClientBtn?.classList.remove("is-hidden");
  } else {
    clientIdBadge.textContent = "";
    clientStatus?.classList.add("is-hidden");
    editClientBtn?.classList.add("is-hidden");
  }
};

const renderAccessState = () => {
  const state = popupAccessState || {
    status: "needs-user",
    userId: "",
    requestId: "",
    notice: "",
    hasExtensionKey: false
  };
  const viewModel = getAccessViewModel(state, isAccessSetupForced);
  const hasGrantedAccess = state.status === "granted";
  const shouldShowSetup = !hasGrantedAccess || isAccessSetupForced;
  const shouldShowStatusBox = Boolean(viewModel.showStatusBox);
  const helpText = shouldShowStatusBox ? (viewModel.help || "") : "";

  updateClientIdUI(state.userId || "");
  inputField.value = state.userId || "";

  accessSetupCard?.classList.toggle("is-hidden", !shouldShowSetup);
  mainContent?.classList.toggle("is-hidden", shouldShowSetup);

  if (accessStatusBadge) {
    accessStatusBadge.textContent = viewModel.badge;
    applyStatusTone(accessStatusBadge, "status-pill", viewModel.badgeTone, STATUS_PILL_TONES);
  }

  accessStatusBox?.classList.toggle("is-hidden", !shouldShowStatusBox);
  applyStatusTone(accessStatusBox, "status-box", viewModel.boxTone, STATUS_BOX_TONES);

  if (accessIntro) {
    accessIntro.textContent = viewModel.intro;
  }

  if (accessStatusTitle) {
    accessStatusTitle.textContent = viewModel.title;
  }

  if (accessHelpText) {
    accessHelpText.textContent = helpText;
    accessHelpText.classList.toggle("is-hidden", !helpText);
  }

  const shouldShowRequestControls = viewModel.showRequestControls;
  requestAccessButton?.classList.toggle("is-hidden", !shouldShowRequestControls);
  requestAccessButton.disabled = !state.userId;
  if (requestAccessButton?.dataset.defaultLabel) {
    requestAccessButton.dataset.defaultLabel = state.requestId ? "Оновити запит доступу" : "Запросити доступ до пристрою";
  }
  requestAccessButton.textContent = state.requestId ? "Оновити запит доступу" : "Запросити доступ до пристрою";

  const shouldShowClaimControls = shouldShowRequestControls && Boolean(state.requestId);
  claimFieldGroup?.classList.toggle("is-hidden", !shouldShowClaimControls);
  claimAccessButton?.classList.toggle("is-hidden", !shouldShowClaimControls);
  if (claimAccessButton) {
    claimAccessButton.disabled = !shouldShowClaimControls;
  }

  if (!state.requestId && claimCodeInput) {
    claimCodeInput.value = "";
  }

  cancelAccessSetupButton?.classList.toggle("is-hidden", !(hasGrantedAccess && isAccessSetupForced));
};

const fetchExtensionAccessState = async () => {
  const response = await sendRuntimeMessage({ action: "GET_EXTENSION_ACCESS_STATE" });
  popupAccessState = response.state;
  return popupAccessState;
};

const persistUserId = async () => {
  const userId = inputField.value.trim();

  if (!userId) {
    throw new Error("Вкажіть User ID.");
  }

  if (!isNumericUserId(userId)) {
    throw new Error("User ID має містити лише цифри.");
  }

  const response = await sendRuntimeMessage({
    action: "SAVE_EXTENSION_USER_ID",
    userId
  });
  popupAccessState = response.state;
  return popupAccessState;
};

// Завантаження popup state
(async () => {
  const result = await storageGet([
    STORAGE_KEYS.discoMode,
    STORAGE_KEYS.serverContext,
    STORAGE_KEYS.taskHighlightEnabled,
    STORAGE_KEYS.taskHighlightColor,
    STORAGE_KEYS.taskOverdueBlinkEnabled
  ]);
  const discoMode = result[STORAGE_KEYS.discoMode] || false;
  const serverContext = result[STORAGE_KEYS.serverContext] || null;
  const highlightSettings = getTaskHighlightSettings(result);

  try {
    const accessState = await fetchExtensionAccessState();
    if (accessState.userId) {
      fetchMode(accessState.userId);
    } else {
      modeInfo.textContent = "Збережіть User ID, щоб отримати режим.";
    }
  } catch (error) {
    popupAccessState = {
      status: "needs-user",
      userId: "",
      requestId: "",
      notice: ""
    };
    setAccessMessage(error?.message || "Не вдалося отримати стан доступу розширення.", "error");
  }

  renderAccessState();

  restoreServerContext(serverContext);
  applyTaskHighlightSettingsState(highlightSettings);

  if (discoMode) {
    discoBall?.classList.add('active');
  }

  await refreshInlineServerError();
})();

taskHighlightToggle?.addEventListener("change", async () => {
  await persistTaskHighlightSettings({
    enabled: taskHighlightToggle.checked,
    color: taskHighlightColorInput?.value,
    overdueBlinkEnabled: taskOverdueBlinkToggle?.checked
  });
});

taskHighlightColorInput?.addEventListener("change", async () => {
  await persistTaskHighlightSettings({
    enabled: taskHighlightToggle?.checked,
    color: taskHighlightColorInput.value,
    overdueBlinkEnabled: taskOverdueBlinkToggle?.checked
  });
});

taskOverdueBlinkToggle?.addEventListener("change", async () => {
  await persistTaskHighlightSettings({
    enabled: taskHighlightToggle?.checked,
    color: taskHighlightColorInput?.value,
    overdueBlinkEnabled: taskOverdueBlinkToggle.checked
  });
});

editClientBtn?.addEventListener("click", () => {
  isAccessSetupForced = true;
  clearAccessMessage();
  renderAccessState();
  inputField.focus();
  inputField.select();
});

cancelAccessSetupButton?.addEventListener("click", async () => {
  isAccessSetupForced = false;
  clearAccessMessage();
  await fetchExtensionAccessState();
  renderAccessState();
});

saveButton?.addEventListener("click", async () => {
  setButtonBusy(saveButton, true, "Зберігаю...");
  clearAccessMessage();

  try {
    const nextState = await persistUserId();
    if (nextState.userId) {
      fetchMode(nextState.userId);
    }

    if (nextState.status === "granted") {
      isAccessSetupForced = false;
    }

    renderAccessState();

    if (nextState.status === "granted") {
      setAccessMessage("User ID оновлено.", "success");
    } else if ((nextState.notice || "").includes("User ID змінено")) {
      setAccessMessage("User ID оновлено. Запросіть доступ знову.", "warning");
    } else {
      clearAccessMessage();
    }
  } catch (error) {
    setAccessMessage(error?.message || "Не вдалося зберегти User ID.", "error");
    inputField.focus();
    inputField.select();
  } finally {
    setButtonBusy(saveButton, false, "Зберігаю...");
  }
});

requestAccessButton?.addEventListener("click", async () => {
  setButtonBusy(requestAccessButton, true, "Надсилаю запит...");
  clearAccessMessage();

  try {
    const savedState = await persistUserId();
    popupAccessState = savedState;
    const response = await sendRuntimeMessage({ action: "REQUEST_EXTENSION_ACCESS" });
    popupAccessState = response.state;
    renderAccessState();
    clearAccessMessage();
  } catch (error) {
    setAccessMessage(error?.message || "Не вдалося запросити доступ для пристрою.", "error");
  } finally {
    setButtonBusy(requestAccessButton, false, "Надсилаю запит...");
  }
});

claimAccessButton?.addEventListener("click", async () => {
  const claimCode = claimCodeInput?.value.trim() || "";
  if (!claimCode) {
    setAccessMessage("Введіть код підтвердження від адміністратора.", "error");
    claimCodeInput?.focus();
    return;
  }

  setButtonBusy(claimAccessButton, true, "Активую...");
  clearAccessMessage();

  try {
    const response = await sendRuntimeMessage({
      action: "CLAIM_EXTENSION_ACCESS",
      requestId: popupAccessState?.requestId,
      claimCode
    });
    popupAccessState = response.state;
    isAccessSetupForced = false;
    claimCodeInput.value = "";
    renderAccessState();
    alert("Персональний доступ для цього пристрою активовано.");
  } catch (error) {
    setAccessMessage(error?.message || "Не вдалося активувати персональний доступ.", "error");
  } finally {
    setButtonBusy(claimAccessButton, false, "Активую...");
  }
});

// Автовибір порту
serverField.addEventListener("input", () => {
  invalidateInlineErrorPolling();
  applyServerFieldState();

  clearInlineServerError();
  persistCurrentServerContext();
});

portField.addEventListener("input", () => {
  invalidateInlineErrorPolling();
  clearInlineServerError();
  persistCurrentServerContext();
});

// Одноразове відправлення даних
sendDataButton.addEventListener("click", () => {
  chrome.storage.local.get([STORAGE_KEYS.userId], async (result) => {
    const userId = result[STORAGE_KEYS.userId];
    if (!userId) {
      alert("Спочатку збережіть User ID.");
      return;
    }

    const serverResolution = getCurrentServerContextResult();
    const context = serverResolution.context;
    const server = context?.server || "";
    let port = context?.port || "";

    if (!server) {
      alert(serverResolution.errorMessage || "Please, input server address.");
      return;
    }

    if (!port) {
      alert("Please, input server port.");
      return;
    }

    const payload = { address: server, port: port, client_id: userId };

    try {
      const response = await fetch("https://planfix-to-syrve.com:8000/send_data/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        await response.json();
        console.log("Data sent successfully!\n");
        await persistCurrentServerContext();
        await pollInlineServerError();
      } else {
        console.log("Error sending data. Status: " + response.status);
        await persistCurrentServerContext();
        await pollInlineServerError({
          forceShowAnyError: false,
          fallbackMessage: `Не вдалося виконати запит до сервера ${server}${port ? `:${port}` : ""}. Код відповіді: ${response.status}.`
        });
      }
    } catch (error) {
      console.error("Network error:", error);
      console.log("Network error. Check console.");
      invalidateInlineErrorPolling();
      await persistCurrentServerContext();
      setInlineServerError(`Помилка підключення до сервера ${server}${port ? `:${port}` : ""}. Перевірте адресу, порт та доступність сервера.`);
    }
  });
});

// Отримати поточний режим
const fetchMode = async (clientId) => {
  try {
    const response = await fetch("https://planfix-to-syrve.com:8000/get_mode_description/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId }),
    });

    if (response.ok) {
      const data = await response.json();
      modeInfo.textContent = `Текущий режим: ${data.description}`;
    } else {
      modeInfo.textContent = "Error fetching mode.";
    }
  } catch (error) {
    console.error("Error fetching mode:", error);
    modeInfo.textContent = "Error fetching mode.";
  }
};

// Перемикання режиму
toggleModeButton.addEventListener("click", async () => {
  chrome.storage.local.get([STORAGE_KEYS.userId], async (result) => {
    const clientId = result[STORAGE_KEYS.userId];
    if (!clientId) {
      alert("Спочатку збережіть User ID.");
      return;
    }

    try {
      const response = await fetch("https://planfix-to-syrve.com:8000/toggle_mode/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });

      if (response.ok) {
        const data = await response.json();
        modeInfo.textContent = `Режим изменен на: ${data.description}`;
        alert(`Режим успешно изменен на: ${data.description}`);
      } else {
        alert("Ошибка при переключении режима.");
      }
    } catch (error) {
      console.error("Error toggling mode:", error);
    }
  });
});

// Показати останню помилку
showErrorButton.addEventListener("click", async () => {
  chrome.storage.local.get([STORAGE_KEYS.userId], async (result) => {
    const clientId = result[STORAGE_KEYS.userId];
    if (!clientId) {
      errorMessage.textContent = "Будь ласка, збережіть User ID спочатку.";
      return;
    }

    try {
      const lastError = await fetchLastError(clientId);
      errorMessage.textContent = lastError ? `Last error:\n${lastError}` : "No errors.";
      await refreshInlineServerError();
    } catch (error) {
      console.error("Error fetching last error:", error);
      errorMessage.textContent = "Помилка при запиті.";
    }
  });
});

// Disco ball toggle
discoBall?.addEventListener("click", () => {
  chrome.storage.local.get(['discoMode'], (result) => {
    const currentMode = result.discoMode || false;
    const newMode = !currentMode;
    
    chrome.storage.local.set({ discoMode: newMode }, () => {
      if (newMode) {
        discoBall.classList.add('active');
      } else {
        discoBall.classList.remove('active');
      }
      
      // Notify content script about disco mode change
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          try {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'toggleDiscoMode',
              discoMode: newMode
            });
          } catch (error) {
            // Ignore errors if content script is not loaded
            console.debug('Could not send disco mode message:', error);
          }
        }
      });
    });
  });
});
