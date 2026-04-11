# Контекст для переноса проверки доступности сервера на backend

## Зачем нужен этот документ

Этот документ нужен для backend-реализации новой проверки доступности сервера, которую сейчас делает само расширение напрямую.

Цель переноса на backend:

1. Убрать ложные красные статусы для серверов, которые реально живы, но плохо ложатся в текущую модель host_permissions расширения.
2. Не перечислять в manifest.json большое количество внешних IP-адресов.
3. Сохранить ту же бизнес-логику проверки, но выполнять сетевой probe на своей серверной стороне.
4. Подготовить backend так, чтобы потом изменения в расширении были минимальными.

## Почему эта задача вообще появилась

Сейчас расширение уже умеет правильно выбирать внешний адрес из поля Planfix, но online-проверка всё ещё выполняется самим расширением через background fetch.

Из-за этого возникают проблемы для серверов с IP-адресами, особенно когда:

1. В карточке несколько адресов через слеш.
2. Среди них есть внутренний IP и внешний IP.
3. Среди них есть домен и внешний IP.
4. В manifest невозможно перечислить все возможные внешние IP.

Ключевые примеры, которые и привели к задаче:

1. `194.44.138.179 / 192.168.1.20` должно превращаться в `http://194.44.138.179:9080`, где порт берётся из карточки.
2. `192.168.1.225` должно давать ошибку, потому что это внутренний адрес.
3. `barbq.daocloud.fun / 93.170.25.165` должно выбирать `barbq.daocloud.fun`, а не IP.
4. `93.175.202.191 / 192.168.88.251` должно превращаться в `http://93.175.202.191:8082`, где порт берётся из карточки.

Главная практическая проблема сейчас такая:

1. Вебморда может открываться.
2. Сервер реально может быть живым.
3. Но индикатор online в карточке может быть красным, потому что эта проверка идёт отдельным direct fetch из расширения.

## Коротко о текущей архитектуре

Сейчас в проекте уже есть две серверные схемы через backend:

1. Получение логина и пароля Syrve.
2. Проверка лицензий.

И есть одна отдельная схема, которая пока не вынесена на backend:

1. Проверка доступности сервера для цветной точки рядом с адресом.

То есть сегодня архитектура смешанная:

1. `credentials/lookup` идёт через backend.
2. `license/check` идёт через backend.
3. `probe server availability` идёт напрямую из extension background в целевой Syrve host.

Именно третью часть и нужно вынести на backend.

## Что уже делает расширение на стороне выбора адреса

Расширение уже не берёт адрес примитивно. Оно сначала разбирает поле сервера из карточки Planfix, делит строку по `/`, выделяет кандидатов, классифицирует их и выбирает лучший вариант.

Правила сейчас такие:

1. Любой публичный домен важнее любого публичного IPv4.
2. Любой публичный IPv4 важнее внутреннего IPv4.
3. Если найдены только внутренние IPv4, это ошибка.
4. Для публичного IPv4 используется HTTP.
5. Для `*.daocloud.fun` тоже используется HTTP.
6. Для `*.syrve.online` и `*.daocloud.it` при пустом порте используется fallback `443`.
7. Для публичного IPv4 порт обязателен, если он не встроен в сам адрес.

### Актуальный код выбора адреса в карточке

Файл: `content/planfix.js`

```js
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
```

### Актуальный код нормализации server context и выбора протокола

Файл: `content/planfix.js`

```js
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
```

## Как сейчас запускается проверка online в карточке Planfix

Когда карточка отрисована, расширение вызывает `getServerData`, получает уже нормализованный server-context и, если всё валидно, ставит отложенную online-проверку.

Файл: `content/planfix.js`

```js
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
```

При инициализации карточки:

```js
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
```

## Как сейчас выглядит online-индикатор в UI

Он не связан с логином и паролем. Это просто цветная точка рядом с адресом сервера.

Состояния:

1. `idle` — серый.
2. `checking` — жёлтый.
3. `online` — зелёный.
4. `offline` — красный.

Файл: `content/planfix.js`

```js
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
```

## Как именно content script запускает probe

Файл: `content/planfix.js`

```js
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
```

То есть content script не ходит сам в Syrve. Он только:

1. Строит server-context.
2. Ставит статус `checking`.
3. Шлёт сообщение в background.
4. Красит точку в зелёный или красный по результату.

## Как сейчас это обрабатывает background

### Текущие сетевые константы

Файл: `background.js`

```js
const HEALTH_PERIOD_REQUESTS = new Map();
const SYRVE_TAB_CREDENTIALS = new Map();
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);
const HEALTH_PERIOD_TIMEOUT_MS = 30000;
const SERVER_AVAILABILITY_TIMEOUT_MS = 4000;
const SYRVE_CREDENTIAL_TTL_MS = 120000;
const EXTENSION_ACCESS_REQUEST_URL = 'http://daologistics.duckdns.org:8100/extension/access/request';
const EXTENSION_ACCESS_CLAIM_URL = 'http://daologistics.duckdns.org:8100/extension/access/claim';
const CREDENTIALS_LOOKUP_URL = 'http://daologistics.duckdns.org:8100/credentials/lookup';
const LICENSE_CHECK_URL = 'http://daologistics.duckdns.org:8100/license/check';
```

### Обработчик сообщения из content script

Файл: `background.js`

```js
if (message?.action === 'PROBE_SERVER_AVAILABILITY') {
  if (!message.server) {
    sendResponse({ ok: false, error: 'Missing server' });
    return false;
  }

  probeServerAvailability({
    server: message.server,
    port: message.port
  })
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || 'Failed to probe server availability' }));

  return true;
}
```

### Правило выбора http/https в background

Файл: `background.js`

```js
function isHttpOnlySyrveHost(server) {
  const normalizedServer = String(server ?? '').trim().toLowerCase();
  return isPublicIpv4SyrveHost(normalizedServer) || normalizedServer.endsWith('.daocloud.fun');
}

function getIpv4Octets(value) {
  const normalizedValue = String(value ?? '').trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedValue)) {
    return null;
  }

  const octets = normalizedValue.split('.').map((part) => Number(part));
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? octets : null;
}

function isPrivateOrReservedIpv4Host(value) {
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
}

function isPublicIpv4SyrveHost(value) {
  return Boolean(getIpv4Octets(value)) && !isPrivateOrReservedIpv4Host(value);
}

function buildSyrvePageUrl({ server, port, path }) {
  const normalizedServer = String(server ?? '').trim().toLowerCase();
  const normalizedPort = String(port ?? '').trim();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const protocol = isHttpOnlySyrveHost(normalizedServer) ? 'http' : 'https';
  const portSegment = normalizedPort ? `:${normalizedPort}` : '';
  return `${protocol}://${normalizedServer}${portSegment}${normalizedPath}`;
}
```

### Сам probe в background

Файл: `background.js`

```js
async function probeServerAvailability({ server, port }) {
  const url = buildSyrvePageUrl({ server, port, path: '/resto/' });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SERVER_AVAILABILITY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal
    });

    const reachable = response.ok || response.status === 401 || response.status === 403;
    return {
      reachable,
      status: response.status,
      url
    };
  } catch (error) {
    const isAbortError = error?.name === 'AbortError';
    return {
      reachable: false,
      status: null,
      url,
      error: isAbortError
        ? `Не вдалося дочекатися відповіді від ${url}.`
        : `Не вдалося підключитися до ${url}.`
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
```

## Что важно понять про текущий online-check

Это не авторизация в Syrve.

Текущий probe:

1. Делает обычный GET на `/resto/`.
2. Не использует логин и пароль.
3. Не использует cookies.
4. Явно выставляет `credentials: 'omit'`.
5. Считает сервер живым, если target вернул 2xx, 401 или 403.

То есть красная точка сейчас не означает “не удалось залогиниться”. Она означает “direct probe из расширения не подтвердил доступность”.

## Почему вебморда может открываться, а точка всё равно красная

Потому что это два разных потока.

### Поток открытия вебморды

Открытие вебморды сначала получает credentials с backend, потом открывает вкладку Syrve.

Файл: `background.js`

```js
async function fetchSyrveCredentials() {
  const { userId, extensionKey } = await getProtectedRouteAuthContext();
  const credentialId = normalizeCredentialId(userId);
  let response;

  try {
    response = await fetch(CREDENTIALS_LOOKUP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Key': extensionKey,
        'X-User-Id': userId
      },
      body: JSON.stringify({ id: credentialId })
    });
  } catch (error) {
    throw new Error('Не вдалося звернутися до сервера credentials. Перевірте мережу та доступність сервера.');
  }

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    if (response.status === 403) {
      await clearInvalidExtensionKey('Персональний доступ цього пристрою відкликано або він більше недійсний. Попросіть адміністратора видати новий код підтвердження.');
    }

    throw new Error(buildCredentialsLookupErrorMessage(response.status, payload));
  }

  const credential = payload?.credential;
  if (!credential || typeof credential.login !== 'string' || typeof credential.password !== 'string') {
    throw new Error('Сервер credentials повернув некоректну відповідь.');
  }

  return {
    id: credentialId,
    login: credential.login,
    password: credential.password
  };
}
```

```js
async function openSyrvePage({ server, path, port, active = true }) {
  const credential = await fetchSyrveCredentials();
  const createdTab = await chrome.tabs.create({
    url: buildSyrvePageUrl({ server, port, path }),
    active
  });

  if (createdTab.id === undefined) {
    throw new Error('Syrve tab was created without an id');
  }

  cacheSyrveCredentialsForTab(createdTab.id, credential);
  log.info('Opened Syrve page after credentials preflight', {
    serviceTabId: createdTab.id,
    server,
    port,
    path,
    active
  });

  return createdTab.id;
}
```

Именно поэтому сервер может открываться в браузере, хотя точка online-check красная.

## Какие backend-операции уже существуют и почему это хороший шаблон

В расширении уже есть готовый паттерн “расширение -> backend -> target business logic” для проверки лицензий.

Файл: `background.js`

```js
async function fetchSyrveLicenseCheck({ address, port }) {
  const { userId, extensionKey } = await getProtectedRouteAuthContext();

  const normalizedAddress = normalizeLicenseServerAddress(address);
  const normalizedPort = normalizeLicenseServerPort(port);

  let response;
  try {
    response = await fetch(LICENSE_CHECK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Key': extensionKey,
        'X-User-Id': userId
      },
      body: JSON.stringify({
        address: normalizedAddress,
        port: normalizedPort
      })
    });
  } catch (error) {
    throw new Error('Не вдалося звернутися до сервера перевірки ліцензій. Перевірте мережу та доступність сервера.');
  }

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    if (response.status === 403) {
      await clearInvalidExtensionKey('Персональний доступ цього пристрою відкликано або він більше недійсний. Попросіть адміністратора видати новий код підтвердження.');
    }

    throw new Error(buildLicenseCheckErrorMessage(response.status, payload));
  }

  const result = payload?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('Сервер license check повернув некоректну відповідь.');
  }

  return {
    address: normalizedAddress,
    port: normalizedPort,
    result: {
      server: sanitizeLicenseCheckServer(result.server),
      licenses: sanitizeLicenseCheckLicenses(result.licenses)
    }
  };
}
```

Новая backend-проверка online может быть сделана в точно таком же стиле.

## Почему прямой probe из расширения проблемный на практике

### Ограничения manifest

Сейчас разрешения расширения заданы только для известных доменных шаблонов и нескольких backend-хостов.

Файл: `manifest.json`

```json
"host_permissions": [
  "http://daologistics.duckdns.org:8100/*",
  "https://*.us-central1.hosted.app/*",
  "https://hub.daolog.net/*",
  "https://dao.planfix.ua/*",
  "https://*.syrve.online/*",
  "https://*.daocloud.it/*",
  "http://*.daocloud.fun/*",
  "https://*.daocloud.fun/*",
  "https://planfix-to-syrve.com:8000/*",
  "https://syrve-license-manager-1038989357415.us-west1.run.app/*"
],
```

И content script для Syrve тоже привязан только к известным доменным маскам:

```json
{
  "matches": [
    "https://*.syrve.online/resto*",
    "https://*.daocloud.it/resto*",
    "http://*.daocloud.fun/resto*",
    "https://*.daocloud.fun/resto*"
  ],
  "js": [
    "content/syrve-autofill.js"
  ],
  "run_at": "document_idle"
}
```

Отсюда и смысл перехода на backend:

1. Внешних IP очень много.
2. Их нельзя нормально перечислить в manifest вручную.
3. Из-за этого direct probe из extension плохо масштабируется.
4. Backend снимает это ограничение полностью.

## Что именно желательно повторить на backend

Если вы хотите сделать backend максимально похожим на текущую схему расширения, лучше повторить следующие правила.

### Входные данные

Самый простой вариант:

```json
{
  "address": "93.175.202.191",
  "port": 8082
}
```

Важно:

1. Сейчас расширение уже само выбирает внешний адрес из строки Planfix.
2. То есть backend может принимать уже готовый `address` и `port`.
3. Но если хочется сделать backend более автономным, он может в будущем принимать и raw-address, и повторять ту же логику выбора адреса.

### Целевой URL

Backend должен строить target URL так же, как сейчас делает extension:

1. Публичный IPv4 -> `http://address:port/resto/`
2. `*.daocloud.fun` -> `http://host:port/resto/`
3. `*.syrve.online` и `*.daocloud.it` -> обычно `https://host:port-or-443/resto/`

### Текущая логика определения "сервер жив"

Рекомендуется сохранить текущее правило:

1. `2xx` -> `reachable = true`
2. `401` -> `reachable = true`
3. `403` -> `reachable = true`
4. Всё остальное -> `reachable = false`
5. Timeout / DNS / connect refused / TLS / abort -> `reachable = false`

### Текущие сетевые параметры

Рекомендуется сохранить их же:

1. Метод: `GET`
2. Путь: `/resto/`
3. Таймаут: `4000 ms`
4. Redirects: follow
5. Без авторизации в target probe

## Какой ответ backend лучше вернуть

Чтобы потом менять расширение минимально, лучше всего, если backend будет возвращать почти тот же shape, который сейчас уже понимает content script.

### Успешный ответ backend при reachable = true

```json
{
  "reachable": true,
  "status": 401,
  "url": "http://93.175.202.191:8082/resto/"
}
```

### Успешный ответ backend при reachable = false, но backend сам отработал штатно

```json
{
  "reachable": false,
  "status": 500,
  "url": "http://93.175.202.191:8082/resto/"
}
```

### Успешный ответ backend при сетевой ошибке target

```json
{
  "reachable": false,
  "status": null,
  "url": "http://93.175.202.191:8082/resto/",
  "error": "Не вдалося підключитися до http://93.175.202.191:8082/resto/"
}
```

### Когда backend должен возвращать HTTP-ошибку своему клиенту

HTTP-ошибку backend стоит возвращать только если сломался сам backend-flow, например:

1. Некорректный request от расширения.
2. Нет обязательного поля `address` или `port`.
3. Адрес внутренний и запрещён политикой.
4. Ошибка аутентификации расширения к вашему backend.
5. Внутренняя ошибка backend.

Идея та же, что и сейчас в extension:

1. Проблема target-сервера не должна выглядеть как авария backend.
2. Для UI полезнее получить нормальный JSON с `reachable = false`, чем backend HTTP 500.

## Почему backend-версия будет лучше

После переноса на backend вы получите:

1. Одну стабильную точку входа для проверки доступности.
2. Отсутствие необходимости расширять manifest под множество IP.
3. Более предсказуемый online-индикатор.
4. Возможность логировать все probe-операции на сервере.
5. Возможность потом добавлять ретраи, классификацию ошибок и аудит уже на backend.

## Итоговое резюме

Сейчас схема такая:

1. Расширение само выбирает внешний адрес из поля Planfix.
2. Расширение само строит URL `/resto/`.
3. Расширение само делает direct GET probe из background.
4. Расширение красит точку по результату.

Проблема такая:

1. Для большого количества внешних IP это плохо масштабируется из-за manifest и общей браузерной модели.
2. Поэтому сервер может быть жив, а индикатор иногда будет вести себя хуже, чем backend-реализация.

Желаемая новая схема:

1. Расширение по-прежнему выбирает внешний адрес из карточки.
2. Вместо direct fetch в target расширение стучится в ваш backend endpoint.
3. Backend уже сам делает probe в target `/resto/`.
4. Backend возвращает `reachable`, `status`, `url`, `error`.
5. UI в расширении почти без изменений использует этот ответ для зелёной/красной точки.

Если backend будет построен именно по этой модели, потом интеграция в расширение получится очень прямой и без большого рефакторинга.