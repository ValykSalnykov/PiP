(() => {
  const AUTO_LOGIN_STATE_KEY = 'daoToolsSyrveAppAutoLoginState';
  const FORM_WAIT_TIMEOUT_MS = 15000;
  const LOGIN_RESULT_TIMEOUT_MS = 8000;
  const SUBMIT_RETRY_ATTEMPTS = 20;
  const SUBMIT_RETRY_DELAY_MS = 150;
  const LOGIN_SELECTOR = 'input[data-testid="input-login"], input[formcontrolname="login"], input[name="login"]';
  const PASSWORD_SELECTOR = 'input[data-testid="input-password"], input[formcontrolname="password"], input[name="password"], input[type="password"]';
  const SUBMIT_SELECTOR = 'button[data-testid="button-submit-login"], button[type="submit"]';
  const ERROR_MESSAGE_SELECTOR = [
    '[role="alert"]',
    '[aria-live="assertive"]',
    '.mat-mdc-snack-bar-label',
    '.mat-error',
    '.error',
    '[data-testid*="error"]'
  ].join(', ');
  const LOGIN_ERROR_TEXT_PATTERN = /bad credentials|invalid|incorrect|wrong password|failed to log in|невер|помилк|ошиб|відхил/i;

  if (!isSyrveAppPage()) {
    return;
  }

  const loginElements = resolveLoginElements();
  if (loginElements) {
    void performAutoLogin(loginElements);
    return;
  }

  waitForLoginElements()
    .then((resolvedLoginElements) => {
      if (!resolvedLoginElements) {
        return;
      }

      void performAutoLogin(resolvedLoginElements);
    })
    .catch(() => {});

  function isSyrveAppPage() {
    return window.location.hostname === 'syrve.app'
      || window.location.hostname.endsWith('.syrve.app');
  }

  function readAutoLoginState() {
    const fallback = {
      submittedCredentialId: '',
      awaitingOutcome: false
    };

    try {
      const rawState = window.sessionStorage.getItem(AUTO_LOGIN_STATE_KEY)
        || document.documentElement.dataset.daoToolsSyrveAppAutoLoginState
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
        awaitingOutcome: parsedState.awaitingOutcome === true
      };
    } catch (error) {
      return fallback;
    }
  }

  function writeAutoLoginState(nextState) {
    const serializedState = JSON.stringify({
      submittedCredentialId: typeof nextState.submittedCredentialId === 'string' ? nextState.submittedCredentialId.trim() : '',
      awaitingOutcome: nextState.awaitingOutcome === true
    });

    try {
      window.sessionStorage.setItem(AUTO_LOGIN_STATE_KEY, serializedState);
    } catch (error) {}

    document.documentElement.dataset.daoToolsSyrveAppAutoLoginState = serializedState;
  }

  function clearAutoLoginState() {
    try {
      window.sessionStorage.removeItem(AUTO_LOGIN_STATE_KEY);
    } catch (error) {}

    delete document.documentElement.dataset.daoToolsSyrveAppAutoLoginState;
  }

  function markCredentialSubmitted(credentialId) {
    writeAutoLoginState({
      submittedCredentialId: credentialId,
      awaitingOutcome: true
    });
  }

  function requestSyrveCredentials() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'GET_SYRVE_CREDENTIALS',
        requirePrepared: true
      }, (response) => {
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

  function reportSyrveLoginSuccess() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'REPORT_SYRVE_LOGIN_RESULT',
        success: true
      }, () => {
        resolve();
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

  async function performAutoLogin(loginElements) {
    try {
      const currentAttempt = await requestSyrveCredentials();
      const autoLoginState = readAutoLoginState();

      if (autoLoginState.awaitingOutcome && autoLoginState.submittedCredentialId === currentAttempt.credential.id) {
        return;
      }

      markCredentialSubmitted(currentAttempt.credential.id);
      fillField(loginElements.usernameField, currentAttempt.credential.login);
      fillField(loginElements.passwordField, currentAttempt.credential.password);
      submitForm(loginElements.form, loginElements.submitButton);

      const outcome = await waitForLoginOutcome();
      if (outcome.status === 'success') {
        clearAutoLoginState();
        await reportSyrveLoginSuccess();
        return;
      }

      const nextAttempt = await reportSyrveLoginFailure(outcome.message);
      const nextLoginElements = resolveLoginElements() || await waitForLoginElements();
      if (!nextLoginElements) {
        throw new Error('Не вдалося знайти форму входу Syrve App для наступної спроби.');
      }

      clearAutoLoginState();
      await performAutoLogin(nextLoginElements, nextAttempt);
    } catch (error) {
      console.warn('DAO Tools+: Syrve App autofill skipped.', error);
    }
  }

  function waitForLoginOutcome() {
    const resolvedOutcome = resolveLoginOutcome();
    if (resolvedOutcome) {
      return Promise.resolve(resolvedOutcome);
    }

    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const nextOutcome = resolveLoginOutcome();
        if (!nextOutcome) {
          return;
        }

        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(nextOutcome);
      });

      const timeoutId = window.setTimeout(() => {
        observer.disconnect();
        resolve(resolveLoginOutcome(true) || {
          status: 'failure',
          message: 'Форма входу Syrve App залишилася на місці після submit.'
        });
      }, LOGIN_RESULT_TIMEOUT_MS);

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    });
  }

  function resolveLoginOutcome(allowTimeoutFallback = false) {
    const errorMessage = extractLoginErrorMessage();
    if (errorMessage) {
      return {
        status: 'failure',
        message: errorMessage
      };
    }

    if (!resolveLoginElements()) {
      return {
        status: 'success'
      };
    }

    if (!allowTimeoutFallback) {
      return null;
    }

    return {
      status: 'failure',
      message: 'Syrve App не прийняв поточну учётку: форма входу залишилася видимою.'
    };
  }

  function extractLoginErrorMessage() {
    const errorNodes = Array.from(document.querySelectorAll(ERROR_MESSAGE_SELECTOR));
    const matchedNode = errorNodes.find((node) => {
      const text = node?.textContent?.replace(/\s+/g, ' ').trim() || '';
      return text && LOGIN_ERROR_TEXT_PATTERN.test(text);
    });

    if (!matchedNode) {
      return '';
    }

    return matchedNode.textContent.replace(/\s+/g, ' ').trim();
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
