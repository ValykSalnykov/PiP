(() => {
  const AUTO_LOGIN_STATE_KEY = 'daoToolsLoyaltyAutoLoginState';
  const FORM_SELECTOR = 'form';
  const LOGIN_SELECTOR = '#login, input[name="Login"]';
  const PASSWORD_SELECTOR = '#password, input[name="Password"]';
  const SUBMIT_SELECTOR = '#enter, button[type="submit"]';
  const OTP_CONTAINER_SELECTOR = '#otp-container';
  const LOGOUT_SELECTOR = 'a[href*="/Login/Logout"]';
  const PROFILE_LOGIN_SELECTOR = '.menuUserName a[href*="/Login/Profile"], .menuUserName';
  const FORM_WAIT_TIMEOUT_MS = 15000;

  if (!isLoyaltyPage()) {
    return;
  }

  requestLoyaltyCredentials()
    .then((credential) => {
      const targetLogin = normalizeComparableLogin(credential.login);
      resetAutoLoginStateIfNeeded(targetLogin);

      return waitForLoyaltyState()
        .then((pageState) => {
          if (!pageState || pageState.type === 'otp') {
            return;
          }

          if (pageState.type === 'authenticated') {
            handleAuthenticatedState(pageState, targetLogin);
            return;
          }

          if (readAutoLoginState().submitAttempted) {
            return;
          }

          markSubmitAttempted();
          fillField(pageState.loginField, credential.login);
          fillField(pageState.passwordField, credential.password);
          submitForm(pageState.form, pageState.submitButton);
        });
    })
    .catch((error) => {
      console.warn('DAO Tools+: Loyalty autofill skipped.', error);
    });

  function isLoyaltyPage() {
    return window.location.hostname === 'loyalty.syrve.live';
  }

  function requestLoyaltyCredentials() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'GET_LOYALTY_CREDENTIALS' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok || !response.credential) {
          reject(new Error(response?.error || 'Credentials для Loyalty недоступні.'));
          return;
        }

        const { login, password } = response.credential;
        if (typeof login !== 'string' || typeof password !== 'string') {
          reject(new Error('Credentials для Loyalty мають некоректний формат.'));
          return;
        }

        resolve({ login, password });
      });
    });
  }

  function waitForLoyaltyState() {
    const resolved = resolveLoyaltyState();
    if (resolved) {
      return Promise.resolve(resolved);
    }

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const nextState = resolveLoyaltyState();
        if (!nextState) {
          return;
        }

        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(nextState);
      });

      const timeoutId = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error('Стан сторінки Loyalty не вдалося визначити.'));
      }, FORM_WAIT_TIMEOUT_MS);

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    });
  }

  function resolveLoyaltyState() {
    const logoutLink = getLogoutLink();
    if (logoutLink) {
      return {
        type: 'authenticated',
        logoutLink,
        currentLogin: getAuthenticatedLogin()
      };
    }

    if (isOtpChallengeVisible()) {
      return { type: 'otp' };
    }

    const loginElements = resolveLoginElements();
    if (loginElements) {
      return {
        type: 'login-form',
        ...loginElements
      };
    }

    return null;
  }

  function handleAuthenticatedState(pageState, targetLogin) {
    const currentLogin = normalizeComparableLogin(pageState.currentLogin);
    if (currentLogin && currentLogin === targetLogin) {
      return;
    }

    const autoLoginState = readAutoLoginState();
    if (autoLoginState.logoutAttempted) {
      console.warn('DAO Tools+: Loyalty logout already attempted for this session.');
      return;
    }

    markLogoutAttempted();
    navigateToLogout(pageState.logoutLink);
  }

  function getLogoutLink() {
    const logoutLink = document.querySelector(LOGOUT_SELECTOR);
    return logoutLink instanceof HTMLAnchorElement ? logoutLink : null;
  }

  function getAuthenticatedLogin() {
    const loginNode = document.querySelector(PROFILE_LOGIN_SELECTOR);
    return loginNode?.textContent?.trim() || '';
  }

  function navigateToLogout(logoutLink) {
    const logoutHref = logoutLink?.href?.trim();
    if (logoutHref) {
      window.location.assign(logoutHref);
      return;
    }

    logoutLink?.click();
  }

  function normalizeComparableLogin(value) {
    return String(value || '').trim().toLowerCase();
  }

  function readAutoLoginState() {
    const fallback = {
      targetLogin: '',
      logoutAttempted: false,
      submitAttempted: false
    };

    try {
      const rawState = window.sessionStorage.getItem(AUTO_LOGIN_STATE_KEY)
        || document.documentElement.dataset.daoToolsLoyaltyAutoLoginState
        || '';
      if (!rawState) {
        return fallback;
      }

      const parsedState = JSON.parse(rawState);
      if (!parsedState || typeof parsedState !== 'object') {
        return fallback;
      }

      return {
        targetLogin: normalizeComparableLogin(parsedState.targetLogin),
        logoutAttempted: parsedState.logoutAttempted === true,
        submitAttempted: parsedState.submitAttempted === true
      };
    } catch (error) {
      return fallback;
    }
  }

  function writeAutoLoginState(nextState) {
    const serializedState = JSON.stringify({
      targetLogin: normalizeComparableLogin(nextState.targetLogin),
      logoutAttempted: nextState.logoutAttempted === true,
      submitAttempted: nextState.submitAttempted === true
    });

    try {
      window.sessionStorage.setItem(AUTO_LOGIN_STATE_KEY, serializedState);
    } catch (error) {}

    document.documentElement.dataset.daoToolsLoyaltyAutoLoginState = serializedState;
  }

  function resetAutoLoginStateIfNeeded(targetLogin) {
    const autoLoginState = readAutoLoginState();
    if (autoLoginState.targetLogin === targetLogin) {
      return;
    }

    writeAutoLoginState({
      targetLogin,
      logoutAttempted: false,
      submitAttempted: false
    });
  }

  function markLogoutAttempted() {
    const autoLoginState = readAutoLoginState();
    writeAutoLoginState({
      ...autoLoginState,
      logoutAttempted: true,
      submitAttempted: false
    });
  }

  function markSubmitAttempted() {
    const autoLoginState = readAutoLoginState();
    writeAutoLoginState({
      ...autoLoginState,
      submitAttempted: true
    });
  }

  function resolveLoginElements() {
    const form = document.querySelector(FORM_SELECTOR);
    const loginField = document.querySelector(LOGIN_SELECTOR);
    const passwordField = document.querySelector(PASSWORD_SELECTOR);

    if (!(form instanceof HTMLFormElement) || !(loginField instanceof HTMLInputElement) || !(passwordField instanceof HTMLInputElement)) {
      return null;
    }

    const submitButton = form.querySelector(SUBMIT_SELECTOR);
    return {
      form,
      loginField,
      passwordField,
      submitButton: submitButton instanceof HTMLElement ? submitButton : null
    };
  }

  function isOtpChallengeVisible() {
    const otpContainer = document.querySelector(OTP_CONTAINER_SELECTOR);
    if (!(otpContainer instanceof HTMLElement)) {
      return false;
    }

    const styles = window.getComputedStyle(otpContainer);
    return styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0';
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