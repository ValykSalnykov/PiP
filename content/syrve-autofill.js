(() => {
  const LOGIN = 'valentyn_syrve';
  const PASSWORD = 'VvVv4815162342';
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
    markAutoLoginAttempted();
    fillField(loginElements.usernameField, LOGIN);
    fillField(loginElements.passwordField, PASSWORD);
    submitForm(loginElements.form, loginElements.submitButton);
  }

  if (isHealthPage() && !loginElements && !hasReportedHealthPeriod()) {
    waitForHealthPeriod()
      .then((period) => {
        markHealthPeriodReported();
        chrome.runtime.sendMessage({
          action: 'SYRVE_HEALTH_PERIOD_RESULT',
          period
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

  function waitForHealthPeriod() {
    const resolved = extractHealthPeriod();
    if (resolved !== null) {
      return Promise.resolve(resolved);
    }

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const nextPeriod = extractHealthPeriod();
        if (nextPeriod === null) {
          return;
        }

        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(nextPeriod);
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

  function extractHealthPeriod() {
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
    return matchedValue ? matchedValue[0] : null;
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