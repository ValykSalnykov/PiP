(() => {
  const GROOVY_MAINTENANCE_PATH = '/resto/service/maintance/groovy.jsp';
  const RESET_HASH_PARAM = 'daoToolsGroovyReset';
  const SYRVE_ONLINE_HOST_SUFFIX = '.syrve.online';

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const isSyrveOnlineHost = () => {
    const hostname = window.location.hostname.toLowerCase();
    return hostname === 'syrve.online' || hostname.endsWith(SYRVE_ONLINE_HOST_SUFFIX);
  };

  const getResetToken = () => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) {
      return '';
    }

    return normalizeText(new URLSearchParams(hash).get(RESET_HASH_PARAM));
  };

  const sendRuntimeMessage = (message) => new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeMessage = chrome.runtime.lastError?.message;
      if (runtimeMessage) {
        resolve({ ok: false, error: runtimeMessage });
        return;
      }

      resolve(response || {});
    });
  });

  const prepareGroovyLicenseResetSubmission = (scriptText) => {
    const normalizedScript = String(scriptText || '').trim();
    if (!normalizedScript) {
      return { ok: false, error: 'Скрипт скидання ліцензій порожній.' };
    }

    const textareas = Array.from(document.querySelectorAll('textarea'))
      .filter((node) => node instanceof HTMLTextAreaElement);
    const textarea = textareas[0];
    if (!textarea) {
      return { ok: false, error: 'На сторінці Groovy не знайдено поле для скрипта.' };
    }

    textarea.focus();
    textarea.value = normalizedScript;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    const controls = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="image"]'));
    const runButton = controls.find((control) => {
      const label = normalizeText(control.textContent || control.value || control.getAttribute('aria-label')).toLowerCase();
      return label === 'run script' || label.includes('run script') || label.includes('execute') || label.includes('виконати') || label.includes('запустити');
    });

    if (runButton) {
      return {
        ok: true,
        submitted: 'button',
        submit: () => runButton.click()
      };
    }

    const form = textarea.form || document.querySelector('form');
    if (form instanceof HTMLFormElement) {
      return {
        ok: true,
        submitted: 'form',
        submit: () => {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
            return;
          }

          form.submit();
        }
      };
    }

    return { ok: false, error: 'На сторінці Groovy не знайдено кнопку Run script.' };
  };

  const completeResetRequest = (token, payload) => sendRuntimeMessage({
    action: 'COMPLETE_GROOVY_LICENSE_RESET_REQUEST',
    token,
    pageUrl: window.location.href,
    ...payload
  });

  const run = async () => {
    if (
      window.location.pathname !== GROOVY_MAINTENANCE_PATH ||
      (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') ||
      isSyrveOnlineHost()
    ) {
      return;
    }

    const token = getResetToken();
    if (!token) {
      return;
    }

    try {
      const request = await sendRuntimeMessage({
        action: 'GET_GROOVY_LICENSE_RESET_REQUEST',
        token,
        pageUrl: window.location.href
      });
      if (!request?.ok) {
        await completeResetRequest(token, {
          ok: false,
          error: request?.error || 'Запит скидання Groovy не підтверджено.'
        });
        return;
      }

      const preparedSubmission = prepareGroovyLicenseResetSubmission(request.scriptText);
      if (!preparedSubmission.ok) {
        await completeResetRequest(token, {
          ok: false,
          error: preparedSubmission.error || 'Не вдалося підготувати Groovy-форму.'
        });
        return;
      }

      const completion = await completeResetRequest(token, {
        ok: true,
        submitted: preparedSubmission.submitted
      });
      if (!completion?.ok) {
        return;
      }

      window.setTimeout(() => {
        preparedSubmission.submit();
      }, 0);
    } catch (error) {
      await completeResetRequest(token, {
        ok: false,
        error: error?.message || 'Не вдалося виконати Groovy-скрипт.'
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    void run();
  }
})();
