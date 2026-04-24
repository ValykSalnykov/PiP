(() => {
  const SUBMIT_GUARD_KEY = 'daoToolsSyrveAppAutoLoginAttempted';
  const FORM_WAIT_TIMEOUT_MS = 15000;
  const SUBMIT_RETRY_ATTEMPTS = 20;
  const SUBMIT_RETRY_DELAY_MS = 150;
  const LOGIN_SELECTOR = 'input[data-testid="input-login"], input[formcontrolname="login"], input[name="login"]';
  const PASSWORD_SELECTOR = 'input[data-testid="input-password"], input[formcontrolname="password"], input[name="password"], input[type="password"]';
  const SUBMIT_SELECTOR = 'button[data-testid="button-submit-login"], button[type="submit"]';

  if (!isSyrveAppPage()) {
    return;
  }

  const loginElements = resolveLoginElements();
  if (loginElements && !hasAttemptedAutoLogin()) {
    performAutoLogin(loginElements);
    return;
  }

  waitForLoginElements()
    .then((resolvedLoginElements) => {
      if (!resolvedLoginElements || hasAttemptedAutoLogin()) {
        return;
      }

      performAutoLogin(resolvedLoginElements);
    })
    .catch(() => {});

  function isSyrveAppPage() {
    return window.location.hostname.endsWith('.syrve.app');
  }

  function hasAttemptedAutoLogin() {
    try {
      return window.sessionStorage.getItem(SUBMIT_GUARD_KEY) === '1';
    } catch (error) {
      return document.documentElement.dataset.daoToolsSyrveAppAutoLoginAttempted === '1';
    }
  }

  function markAutoLoginAttempted() {
    try {
      window.sessionStorage.setItem(SUBMIT_GUARD_KEY, '1');
      return;
    } catch (error) {
      document.documentElement.dataset.daoToolsSyrveAppAutoLoginAttempted = '1';
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

  function waitForLoginElements() {
    const resolved = resolveLoginElements();
    if (resolved) {
      return Promise.resolve(resolved);
    }

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const nextLoginElements = resolveLoginElements();
        if (!nextLoginElements) {
          return;
        }

        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(nextLoginElements);
      });

      const timeoutId = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error('Не вдалося знайти форму входу Syrve App.'));
      }, FORM_WAIT_TIMEOUT_MS);

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    });
  }

  function resolveLoginElements() {
    const usernameField = document.querySelector(LOGIN_SELECTOR);
    const passwordField = document.querySelector(PASSWORD_SELECTOR);

    if (!(usernameField instanceof HTMLInputElement) || !(passwordField instanceof HTMLInputElement)) {
      return null;
    }

    const form = usernameField.closest('form') || passwordField.closest('form');
    if (!(form instanceof HTMLFormElement)) {
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

  function performAutoLogin(loginElements) {
    requestSyrveCredentials()
      .then((credential) => {
        markAutoLoginAttempted();
        fillField(loginElements.usernameField, credential.login);
        fillField(loginElements.passwordField, credential.password);
        submitForm(loginElements.form, loginElements.submitButton);
      })
      .catch((error) => {
        console.warn('DAO Tools+: Syrve App autofill skipped.', error);
      });
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

  function isSubmitButtonDisabled(submitButton) {
    if (!(submitButton instanceof HTMLElement)) {
      return false;
    }

    return submitButton.hasAttribute('disabled') || submitButton.getAttribute('aria-disabled') === 'true';
  }

  function submitForm(form, submitButton) {
    const fallbackSubmit = () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit(submitButton || undefined);
        return;
      }

      if (submitButton) {
        submitButton.click();
        return;
      }

      form.submit();
    };

    const tryClickSubmitButton = (remainingAttempts) => {
      if (!submitButton) {
        fallbackSubmit();
        return;
      }

      if (!isSubmitButtonDisabled(submitButton)) {
        submitButton.focus();
        submitButton.click();
        return;
      }

      if (remainingAttempts <= 0) {
        fallbackSubmit();
        return;
      }

      window.setTimeout(() => {
        tryClickSubmitButton(remainingAttempts - 1);
      }, SUBMIT_RETRY_DELAY_MS);
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        tryClickSubmitButton(SUBMIT_RETRY_ATTEMPTS);
      });
    });
  }
})();