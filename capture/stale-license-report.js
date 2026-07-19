(() => {
  const REPORT_ID_PARAM = 'reportId';
  const REPORT_STORAGE_KEY_PREFIX = 'staleLicenseReport:';

  const messageNode = document.getElementById('message-text');
  const metaNode = document.getElementById('meta');
  const textStatusNode = document.getElementById('text-status');
  const screenshotStatusNode = document.getElementById('screenshot-status');
  const screenshotNode = document.getElementById('screenshot');
  const copyTextButton = document.getElementById('copy-text-button');

  let reportPayload = null;

  const setStatus = (node, message, isError = false) => {
    if (!node) {
      return;
    }

    node.textContent = message || '';
    node.classList.toggle('is-error', isError);
  };

  const setTextStatus = (message, isError = false) => setStatus(textStatusNode, message, isError);
  const setScreenshotStatus = (message, isError = false) => setStatus(screenshotStatusNode, message, isError);

  const setButtonBusy = (button, isBusy, busyLabel, defaultLabel) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    button.disabled = isBusy;
    button.textContent = isBusy ? busyLabel : defaultLabel;
  };

  const getReportId = () => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return String(params.get(REPORT_ID_PARAM) || '').trim();
  };

  const storageGet = (key) => new Promise((resolve) => {
    chrome.storage.session.get(key, (result) => {
      resolve(result || {});
    });
  });

  const getServerLabelFromUrl = (value) => {
    try {
      const url = new URL(String(value || '').trim());
      return `${url.protocol}//${url.host}`;
    } catch (error) {
      return '';
    }
  };

  const copyText = async () => {
    const messageText = String(reportPayload?.messageText || '').trim();
    if (!messageText) {
      throw new Error('Текст повідомлення не знайдено.');
    }

    await navigator.clipboard.writeText(messageText);
  };

  const renderReport = (payload) => {
    reportPayload = payload;
    const messageText = String(payload?.messageText || '').trim();
    const screenshotDataUrl = String(payload?.screenshot?.dataUrl || '').trim();
    const serverLabel = String(payload?.server || '').trim() || getServerLabelFromUrl(payload?.sourceConnectionsUrl);

    if (messageNode) {
      messageNode.textContent = messageText;
    }

    if (screenshotNode instanceof HTMLImageElement) {
      screenshotNode.src = screenshotDataUrl;
    }

    if (metaNode) {
      metaNode.textContent = serverLabel ? `Сервер: ${serverLabel}` : '';
    }

    if (!messageText && copyTextButton instanceof HTMLButtonElement) {
      copyTextButton.disabled = true;
      setTextStatus('Текст повідомлення не знайдено. Спробуйте створити скріншот ще раз.', true);
    }

    if (!screenshotDataUrl) {
      setScreenshotStatus('Скріншот не знайдено. Спробуйте створити скріншот ще раз.', true);
    }
  };

  const loadReport = async () => {
    const reportId = getReportId();
    if (!reportId) {
      throw new Error('Не знайдено id повідомлення.');
    }

    const storageKey = `${REPORT_STORAGE_KEY_PREFIX}${reportId}`;
    const result = await storageGet(storageKey);
    const payload = result?.[storageKey];
    if (!payload || typeof payload !== 'object') {
      throw new Error('Повідомлення не знайдено або час його дії сплив.');
    }

    renderReport(payload);
  };

  copyTextButton?.addEventListener('click', async () => {
    setButtonBusy(copyTextButton, true, 'Копіюємо...', 'Копіювати текст');
    setTextStatus('');

    try {
      await copyText();
      setTextStatus('Текст скопійовано.');
    } catch (error) {
      setTextStatus(error?.message || 'Не вдалося скопіювати текст.', true);
    } finally {
      setButtonBusy(copyTextButton, false, 'Копіюємо...', 'Копіювати текст');
    }
  });

  loadReport().catch((error) => {
    setTextStatus(error?.message || 'Не вдалося відкрити повідомлення.', true);
    setScreenshotStatus(error?.message || 'Не вдалося відкрити скріншот.', true);
    if (copyTextButton instanceof HTMLButtonElement) {
      copyTextButton.disabled = true;
    }
  });
})();
