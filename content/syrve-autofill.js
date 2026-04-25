(() => {
  const SUBMIT_GUARD_KEY = 'daoToolsSyrveAutoLoginAttempted';
  const HEALTH_GUARD_KEY = 'daoToolsSyrveHealthReported';
  const FORM_SELECTOR = 'form[action*="j_spring_security_check"]';
  const USERNAME_SELECTOR = '#username, input[name="j_username"]';
  const PASSWORD_SELECTOR = '#password, input[name="j_password"]';
  const SUBMIT_SELECTOR = 'input[type="submit"], button[type="submit"]';
  const HEALTH_TIMEOUT_MS = 15000;

  if (!isRestoPage()) {
    return;
  }

  const loginElements = resolveLoginElements();
  if (loginElements && !hasAttemptedAutoLogin()) {
    requestSyrveCredentials()
      .then((credential) => {
        markAutoLoginAttempted();
        fillField(loginElements.usernameField, credential.login);
        fillField(loginElements.passwordField, credential.password);
        submitForm(loginElements.form, loginElements.submitButton);
      })
      .catch((error) => {
        chrome.runtime.sendMessage({
          action: 'SYRVE_HEALTH_PERIOD_RESULT',
          error: error?.message || 'Не вдалося отримати логін і пароль для Syrve.'
        });
      });
  }

  if (isHealthPage() && !loginElements && !hasReportedHealthPeriod()) {
    waitForHealthSnapshot()
      .then(({ period, version, versionRaw }) => {
        markHealthPeriodReported();
        chrome.runtime.sendMessage({
          action: 'SYRVE_HEALTH_PERIOD_RESULT',
          period,
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

  function isRestoPage() {
    return window.location.pathname.startsWith('/resto');
  }

  function isHealthPage() {
    return window.location.pathname === '/resto/service/monitoring/health.jsp';
  }

  function hasAttemptedAutoLogin() {
    try {
      return window.sessionStorage.getItem(SUBMIT_GUARD_KEY) === '1';
    } catch (error) {
      return document.documentElement.dataset.daoToolsSyrveAutoLoginAttempted === '1';
    }
  }

  function markAutoLoginAttempted() {
    try {
      window.sessionStorage.setItem(SUBMIT_GUARD_KEY, '1');
      return;
    } catch (error) {
      document.documentElement.dataset.daoToolsSyrveAutoLoginAttempted = '1';
    }
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

        const { login, password } = response.credential;
        if (typeof login !== 'string' || typeof password !== 'string') {
          reject(new Error('Credentials для Syrve мають некоректний формат.'));
          return;
        }

        resolve({ login, password });
      });
    });
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

    const rawValue = valueCells[periodColumnIndex].textContent?.trim() || '';
    const matchedValue = rawValue.match(/\d+/);
    if (!matchedValue) {
      return null;
    }

    const versionCell = document.getElementById('version');
    const versionRaw = extractHealthVersionRaw(versionCell?.textContent || '');
    return {
      period: matchedValue[0],
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