(() => {
  const AUTO_LOGIN_STATE_KEY = 'daoToolsSyrveAutoLoginState';
  const HEALTH_GUARD_KEY = 'daoToolsSyrveHealthReported';
  const FORM_SELECTOR = 'form[action*="j_spring_security_check"]';
  const USERNAME_SELECTOR = '#username, input[name="j_username"]';
  const PASSWORD_SELECTOR = '#password, input[name="j_password"]';
  const SUBMIT_SELECTOR = 'input[type="submit"], button[type="submit"]';
  const LOGIN_ERROR_TABLE_SELECTOR = 'table.error';
  const HEALTH_TIMEOUT_MS = 15000;

  if (!isRestoPage()) {
    return;
  }

  const loginElements = resolveLoginElements();
  if (loginElements) {
    void handleLoginPage(loginElements);
  } else {
    clearAutoLoginState();
  }

  if (isHealthPage() && !loginElements && !hasReportedHealthPeriod()) {
    waitForHealthSnapshot()
      .then(({ period, periodStartDate, version, versionRaw }) => {
        markHealthPeriodReported();
        chrome.runtime.sendMessage({
          action: 'SYRVE_HEALTH_PERIOD_RESULT',
          period,
          periodStartDate,
          version,
          versionRaw
        });
      })
      .catch((error) => {
        markHealthPeriodReported();
        chrome.runtime.sendMessage({
          action: 'SYRVE_HEALTH_PERIOD_RESULT',
          error: error?.message || 'Failed to read health period'
        });
      });
  }

  async function handleLoginPage(resolvedLoginElements) {
    try {
      if (isFailedLoginState()) {
        const currentAttempt = await requestSyrveCredentials();
        const autoLoginState = readAutoLoginState();
        if (autoLoginState.failureReportedCredentialId === currentAttempt.credential.id) {
          return;
        }

        markFailureReported(currentAttempt.credential.id);
        const nextAttempt = await reportSyrveLoginFailure(buildFailedLoginMessage());
        fillAndSubmitCredential(resolvedLoginElements, nextAttempt.credential);
        return;
      }

      const currentAttempt = await requestSyrveCredentials();
      const autoLoginState = readAutoLoginState();
      if (autoLoginState.submittedCredentialId === currentAttempt.credential.id) {
        return;
      }

      fillAndSubmitCredential(resolvedLoginElements, currentAttempt.credential);
    } catch (error) {
      if (isHealthPage()) {
        chrome.runtime.sendMessage({
          action: 'SYRVE_HEALTH_PERIOD_RESULT',
          error: error?.message || 'Не вдалося підібрати робочу учётку для Syrve.'
        });
      }

      console.warn('DAO Tools+: Syrve autofill skipped.', error);
    }
  }

  function isRestoPage() {
    return window.location.pathname.startsWith('/resto');
  }

  function isHealthPage() {
    return window.location.pathname === '/resto/service/monitoring/health.jsp';
  }

  function readAutoLoginState() {
    const fallback = {
      submittedCredentialId: '',
      failureReportedCredentialId: ''
    };

    try {
      const rawState = window.sessionStorage.getItem(AUTO_LOGIN_STATE_KEY)
        || document.documentElement.dataset.daoToolsSyrveAutoLoginState
        || '';

      if (!rawState) {
        return fallback;
      }

      const parsedState = JSON.parse(rawState);
      if (!parsedState || typeof parsedState !== 'object') {
        return fallback;
      }

      return {
        submittedCredentialId: typeof parsedState.submittedCredentialId === 'string' ? parsedState.submittedCredentialId.trim() : '',
        failureReportedCredentialId: typeof parsedState.failureReportedCredentialId === 'string' ? parsedState.failureReportedCredentialId.trim() : ''
      };
    } catch (error) {
      return fallback;
    }
  }

  function writeAutoLoginState(nextState) {
    const serializedState = JSON.stringify({
      submittedCredentialId: typeof nextState.submittedCredentialId === 'string' ? nextState.submittedCredentialId.trim() : '',
      failureReportedCredentialId: typeof nextState.failureReportedCredentialId === 'string' ? nextState.failureReportedCredentialId.trim() : ''
    });

    try {
      window.sessionStorage.setItem(AUTO_LOGIN_STATE_KEY, serializedState);
    } catch (error) {}

    document.documentElement.dataset.daoToolsSyrveAutoLoginState = serializedState;
  }

  function clearAutoLoginState() {
    try {
      window.sessionStorage.removeItem(AUTO_LOGIN_STATE_KEY);
    } catch (error) {}

    delete document.documentElement.dataset.daoToolsSyrveAutoLoginState;
  }

  function markCredentialSubmitted(credentialId) {
    writeAutoLoginState({
      submittedCredentialId: credentialId,
      failureReportedCredentialId: ''
    });
  }

  function markFailureReported(credentialId) {
    const autoLoginState = readAutoLoginState();
    writeAutoLoginState({
      submittedCredentialId: autoLoginState.submittedCredentialId || credentialId,
      failureReportedCredentialId: credentialId
    });
  }

  function hasReportedHealthPeriod() {
    try {
      return window.sessionStorage.getItem(HEALTH_GUARD_KEY) === '1';
    } catch (error) {
      return document.documentElement.dataset.daoToolsSyrveHealthReported === '1';
    }
  }

  function markHealthPeriodReported() {
    try {
      window.sessionStorage.setItem(HEALTH_GUARD_KEY, '1');
      return;
    } catch (error) {
      document.documentElement.dataset.daoToolsSyrveHealthReported = '1';
    }
  }

  function requestSyrveCredentials() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'GET_SYRVE_CREDENTIALS' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok || !response.credential) {
          reject(new Error(response?.error || 'Credentials для Syrve недоступні.'));
          return;
        }

        const { id, login, password } = response.credential;
        if (typeof id !== 'string' || typeof login !== 'string' || typeof password !== 'string') {
          reject(new Error('Credentials для Syrve мають некоректний формат.'));
          return;
        }

        resolve({
          credential: {
            id,
            login,
            password
          },
          attempt: response.attempt || null
        });
      });
    });
  }

  function reportSyrveLoginFailure(errorMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'REPORT_SYRVE_LOGIN_RESULT',
        success: false,
        error: errorMessage
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok || !response.credential) {
          reject(new Error(response?.error || 'Усі учётки для Syrve вичерпані.'));
          return;
        }

        const { id, login, password } = response.credential;
        if (typeof id !== 'string' || typeof login !== 'string' || typeof password !== 'string') {
          reject(new Error('Наступна учётка Syrve має некоректний формат.'));
          return;
        }

        resolve({
          credential: {
            id,
            login,
            password
          },
          attempt: response.attempt || null
        });
      });
    });
  }

  function isFailedLoginState() {
    if (!resolveLoginElements()) {
      return false;
    }

    if (new URLSearchParams(window.location.search).get('login_error') === '1') {
      return true;
    }

    const errorTable = document.querySelector(LOGIN_ERROR_TABLE_SELECTOR);
    return Boolean(errorTable?.textContent?.trim());
  }

  function buildFailedLoginMessage() {
    const errorTable = document.querySelector(LOGIN_ERROR_TABLE_SELECTOR);
    const errorText = errorTable?.textContent
      ? errorTable.textContent.replace(/\s+/g, ' ').trim()
      : '';

    if (errorText) {
      return errorText;
    }

    if (new URLSearchParams(window.location.search).get('login_error') === '1') {
      return 'Syrve відхилив логін або пароль на сторінці login.jsp.';
    }

    return 'Syrve повернув сторінку логіна без успішної авторизації.';
  }

  function waitForHealthSnapshot() {
    const resolved = extractHealthSnapshot();
    if (resolved !== null) {
      return Promise.resolve(resolved);
    }

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const nextSnapshot = extractHealthSnapshot();
        if (nextSnapshot === null) {
          return;
        }

        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(nextSnapshot);
      });

      const timeoutId = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error('Не вдалося знайти значення періоду на сторінці health.jsp.'));
      }, HEALTH_TIMEOUT_MS);

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    });
  }

  function resolveLoginElements() {
    const form = document.querySelector(FORM_SELECTOR);
    const usernameField = document.querySelector(USERNAME_SELECTOR);
    const passwordField = document.querySelector(PASSWORD_SELECTOR);

    if (!(form instanceof HTMLFormElement) || !(usernameField instanceof HTMLInputElement) || !(passwordField instanceof HTMLInputElement)) {
      return null;
    }

    const submitButton = form.querySelector(SUBMIT_SELECTOR);
    return {
      form,
      usernameField,
      passwordField,
      submitButton: submitButton instanceof HTMLElement ? submitButton : null
    };
  }

  function fillAndSubmitCredential(loginElements, credential) {
    markCredentialSubmitted(credential.id);
    fillField(loginElements.usernameField, credential.login);
    fillField(loginElements.passwordField, credential.password);
    submitForm(loginElements.form, loginElements.submitButton);
  }

  function extractHealthVersionRaw(value) {
    const match = String(value || '').match(/(\d+\.\d+\.\d+(?:\.\d+)*)/);
    return match ? match[1] : '';
  }

  function normalizeHealthVersion(value) {
    const rawVersion = extractHealthVersionRaw(value);
    if (!rawVersion) {
      return '';
    }

    const parts = rawVersion.split('.').filter(Boolean);
    if (parts.length < 3) {
      return '';
    }

    return [parts[0], parts[1], parts[2].slice(0, 1)]
      .filter(Boolean)
      .join('.');
  }

  function extractHealthPeriodStartDate(value) {
    const match = String(value || '').match(/Current server period:[\s\S]*?\(from\s+(\d{2}\.\d{2}\.\d{4})(?:\s+\d{2}:\d{2})?/i);
    return match ? match[1] : '';
  }

  function extractHealthSnapshot() {
    const rows = [...document.querySelectorAll('table tr')];
    if (rows.length < 2) {
      return null;
    }

    const headerRow = rows.find((row) => row.querySelector('th'));
    if (!headerRow) {
      return null;
    }

    const valueRow = headerRow.nextElementSibling;
    if (!(valueRow instanceof HTMLTableRowElement)) {
      return null;
    }

    const headerCells = [...headerRow.children].filter((cell) => cell instanceof HTMLTableCellElement);
    const valueCells = [...valueRow.children].filter((cell) => cell instanceof HTMLTableCellElement);
    const periodColumnIndex = headerCells.findIndex((cell) => cell.textContent?.trim() === 'P');

    if (periodColumnIndex === -1 || !valueCells[periodColumnIndex]) {
      return null;
    }

    const periodCell = valueCells[periodColumnIndex];
    const rawValue = periodCell.textContent?.trim() || '';
    const matchedValue = rawValue.match(/\d+/);
    if (!matchedValue) {
      return null;
    }

    const periodStartDate = extractHealthPeriodStartDate(
      periodCell.getAttribute('title') || headerCells[periodColumnIndex]?.getAttribute('title') || ''
    );

    const versionCell = document.getElementById('version');
    const versionRaw = extractHealthVersionRaw(versionCell?.textContent || '');
    return {
      period: matchedValue[0],
      periodStartDate,
      version: normalizeHealthVersion(versionRaw),
      versionRaw
    };
  }

  function fillField(field, value) {
    const prototype = Object.getPrototypeOf(field);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor?.set) {
      descriptor.set.call(field, value);
    } else {
      field.value = value;
    }

    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function submitForm(form, submitButton) {
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit(submitButton || undefined);
      return;
    }

    if (submitButton) {
      submitButton.click();
      return;
    }

    form.submit();
  }
})();