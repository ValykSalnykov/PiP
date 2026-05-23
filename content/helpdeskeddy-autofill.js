(() => {
  const REQUEST_HASH_KEY = 'dao-tools-request';
  const DRAFT_PATH_PATTERN = /^\/ua\/ticket\/list\/filter\/id\/352\/ticket\/create\/draft\/\d+(?:\/|$)/;
  const FORM_WAIT_TIMEOUT_MS = 10000;
  const SELECT_WAIT_TIMEOUT_MS = 6000;
  const SELECT_SCROLL_SETTLE_MS = 140;
  const SELECT_MAX_SCROLL_ATTEMPTS = 24;
  const EDITOR_STRATEGY_TIMEOUT_MS = 450;
  const EDITOR_VERIFY_TIMEOUT_MS = 1200;
  const PRIORITY_OPTION_ID = '264';
  const processedRequestIds = new Set();
  let activeRequestId = null;

  const sendRuntimeMessage = (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || 'Помилка обробки запиту до розширення.'));
        return;
      }

      resolve(response);
    });
  });

  const getRequestIdFromHash = () => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) {
      return '';
    }

    const params = new URLSearchParams(hash);
    return String(params.get(REQUEST_HASH_KEY) || '').trim();
  };

  const normalizeComparableText = (value) => String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const isExactComparableMatch = (expected, actual) => {
    const normalizedExpected = normalizeComparableText(expected);
    const normalizedActual = normalizeComparableText(actual);
    return Boolean(normalizedExpected) && normalizedExpected === normalizedActual;
  };

  const waitForDelay = (timeoutMs) => new Promise((resolve) => {
    window.setTimeout(resolve, timeoutMs);
  });

  const normalizeMultilineText = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();

  const normalizeVersionText = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^0-9.]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .trim();

  const parseNumericVersion = (value) => normalizeVersionText(value)
    .split('.')
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));

  const compareNumericVersions = (left, right) => {
    const leftParts = parseNumericVersion(left);
    const rightParts = parseNumericVersion(right);
    const maxLength = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < maxLength; index += 1) {
      const leftValue = leftParts[index] ?? -1;
      const rightValue = rightParts[index] ?? -1;
      if (leftValue !== rightValue) {
        return leftValue - rightValue;
      }
    }

    return 0;
  };

  const waitForCondition = (predicate, timeoutMs, description) => new Promise((resolve, reject) => {
    const finalize = (callback, value) => {
      window.clearTimeout(timeoutId);
      observer.disconnect();
      callback(value);
    };

    const tryResolve = () => {
      try {
        const result = predicate();
        if (!result) {
          return;
        }

        finalize(resolve, result);
      } catch (error) {
        finalize(reject, error);
      }
    };

    const observer = new MutationObserver(() => {
      tryResolve();
    });

    const timeoutId = window.setTimeout(() => {
      finalize(reject, new Error(`Не вдалося дочекатися ${description}.`));
    }, timeoutMs);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true
    });

    tryResolve();
  });

  const waitForDraftForm = () => waitForCondition(() => {
    const titleField = document.querySelector('#title');
    const crmField = document.querySelector('#ticket-custom-field-56');
    const serverField = document.querySelector('#ticket-custom-field-70');
    const editor = document.querySelector('.ck-editor__editable[contenteditable="true"]');
    if (!(titleField instanceof HTMLInputElement) || !(crmField instanceof HTMLInputElement) || !(serverField instanceof HTMLInputElement) || !(editor instanceof HTMLElement)) {
      return null;
    }

    return {
      titleField,
      crmField,
      serverField,
      editor
    };
  }, FORM_WAIT_TIMEOUT_MS, 'форми створення заявки HelpDeskEddy');

  const setNativeInputValue = (input, value) => {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  const fillTextField = (selector, value, label) => {
    const input = document.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Не знайдено поле ${label}.`);
    }

    setNativeInputValue(input, String(value || ''));
  };

  const createDescriptionFragment = (value) => {
    const normalizedValue = String(value || '').trim();
    const lines = normalizedValue ? normalizedValue.split('\n') : [''];
    const fragment = document.createDocumentFragment();

    lines.forEach((line) => {
      const paragraph = document.createElement('p');
      if (line) {
        paragraph.textContent = line;
      } else {
        paragraph.appendChild(document.createElement('br'));
      }
      fragment.appendChild(paragraph);
    });

    return fragment;
  };

  const getEditorValue = (editor) => {
    const paragraphs = Array.from(editor.querySelectorAll('p'));
    if (!paragraphs.length) {
      return normalizeMultilineText(editor.textContent || '');
    }

    return normalizeMultilineText(paragraphs.map((paragraph) => paragraph.textContent || '').join('\n'));
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const buildDescriptionHtml = (value) => {
    const normalizedValue = String(value || '').trim();
    const lines = normalizedValue ? normalizedValue.split('\n') : [''];
    return lines.map((line) => (
      line ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'
    )).join('');
  };

  const dispatchEditorEvents = (editor, value, inputType = 'insertParagraph') => {
    try {
      editor.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        data: value,
        inputType
      }));
    } catch (error) {
      editor.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    }

    try {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: value,
        inputType
      }));
    } catch (error) {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    editor.dispatchEvent(new Event('change', { bubbles: true }));
    editor.dispatchEvent(new Event('blur', { bubbles: true }));
    editor.dispatchEvent(new Event('focusout', { bubbles: true }));
  };

  const waitForEditorValue = (editor, value, timeoutMs = FORM_WAIT_TIMEOUT_MS) => waitForCondition(() => {
    return getEditorValue(editor) === normalizeMultilineText(value) ? true : null;
  }, timeoutMs, 'значення опису заявки');

  const tryApplyDescriptionViaHtmlCommand = async (editor, value) => {
    document.execCommand('selectAll', false, null);
    const html = buildDescriptionHtml(value);
    const inserted = document.execCommand('insertHTML', false, html);
    if (!inserted) {
      return false;
    }

    dispatchEditorEvents(editor, value, 'insertFromPaste');
    await waitForDelay(80);

    try {
      await waitForEditorValue(editor, value, EDITOR_STRATEGY_TIMEOUT_MS);
      return true;
    } catch (error) {
      return false;
    }
  };

  const tryApplyDescriptionViaPasteEvent = async (editor, value) => {
    if (typeof DataTransfer === 'undefined' || typeof ClipboardEvent === 'undefined') {
      return false;
    }

    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', value);
      dataTransfer.setData('text/html', buildDescriptionHtml(value));
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      });

      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: dataTransfer
      });

      editor.dispatchEvent(pasteEvent);
      dispatchEditorEvents(editor, value, 'insertFromPaste');
      await waitForDelay(80);
      await waitForEditorValue(editor, value, EDITOR_STRATEGY_TIMEOUT_MS);
      return true;
    } catch (error) {
      return false;
    }
  };

  const applyDescriptionViaDom = (editor, value) => {
    editor.replaceChildren(createDescriptionFragment(value));
    dispatchEditorEvents(editor, value, 'insertParagraph');
  };

  const fillDescription = async (value) => {
    const editor = document.querySelector('.ck-editor__editable[contenteditable="true"]');
    if (!(editor instanceof HTMLElement)) {
      throw new Error('Не знайдено редактор опису заявки.');
    }

    const normalizedValue = String(value || '').trim();
    editor.focus();

    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    if (await tryApplyDescriptionViaHtmlCommand(editor, normalizedValue)) {
      return;
    }

    if (await tryApplyDescriptionViaPasteEvent(editor, normalizedValue)) {
      return;
    }

    applyDescriptionViaDom(editor, normalizedValue);
    await waitForEditorValue(editor, normalizedValue, EDITOR_VERIFY_TIMEOUT_MS);
  };

  const dataUrlToFile = async ({ dataUrl, fileName, mimeType }) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], fileName, {
      type: mimeType || blob.type || 'image/jpeg'
    });
  };

  const getDraftAttachment = async (attachment) => {
    const response = await sendRuntimeMessage({
      action: 'GET_HELPDESK_DRAFT_ATTACHMENT',
      storageKey: attachment.storageKey
    });

    const resolvedAttachment = response.attachment || {};
    if (!resolvedAttachment.dataUrl) {
      throw new Error('Скріншот для заявки не знайдено.');
    }

    return {
      dataUrl: resolvedAttachment.dataUrl,
      fileName: resolvedAttachment.fileName || attachment.fileName || 'stale-license-connections.jpg',
      mimeType: resolvedAttachment.mimeType || attachment.mimeType || 'image/jpeg',
      insertMode: resolvedAttachment.insertMode || attachment.insertMode || '',
      displayWidth: Number(resolvedAttachment.displayWidth || attachment.displayWidth) || 0,
      displayHeight: Number(resolvedAttachment.displayHeight || attachment.displayHeight) || 0,
      width: Number(resolvedAttachment.width || attachment.width) || 0,
      height: Number(resolvedAttachment.height || attachment.height) || 0
    };
  };

  const findAttachmentFileInput = () => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.find((input) => input instanceof HTMLInputElement && !input.disabled) || null;
  };

  const attachFileViaInput = async (file) => {
    const input = findAttachmentFileInput();
    if (!(input instanceof HTMLInputElement)) {
      return false;
    }

    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      return false;
    }

    await waitForDelay(300);
    return input.files && Array.from(input.files).some((attachedFile) => attachedFile.name === file.name);
  };

  const hasEditorImageAttachment = (editor) => Boolean(
    editor.querySelector('img, figure.image, .ck-widget.image, .ck-upload-placeholder')
  );

  const getEditorImages = (editor) => Array.from(editor.querySelectorAll('img'));

  const applyInlineImageDisplaySize = (image, width, height) => {
    if (!(image instanceof HTMLImageElement) || width <= 0 || height <= 0) {
      return;
    }

    image.setAttribute('width', String(width));
    image.setAttribute('height', String(height));
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    image.style.maxWidth = '100%';
    image.style.objectFit = 'fill';

    const figure = image.closest('figure');
    if (figure instanceof HTMLElement) {
      figure.style.width = `${width}px`;
      figure.style.maxWidth = '100%';
    }
  };

  const placeCursorAtEditorEnd = (editor) => {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const pasteFileIntoEditor = async (file, displaySize = {}) => {
    const editor = document.querySelector('.ck-editor__editable[contenteditable="true"]');
    if (!(editor instanceof HTMLElement) || typeof ClipboardEvent === 'undefined' || typeof DataTransfer === 'undefined') {
      return false;
    }

    editor.focus();
    placeCursorAtEditorEnd(editor);
    const previousImageCount = getEditorImages(editor).length;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer
    });

    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: dataTransfer
    });

    editor.dispatchEvent(pasteEvent);
    dispatchEditorEvents(editor, file.name, 'insertFromPaste');

    try {
      const attachmentNode = await waitForCondition(() => {
        const images = getEditorImages(editor);
        if (images.length > previousImageCount) {
          return images[images.length - 1];
        }

        return editor.querySelector('.ck-upload-placeholder') || null;
      }, 5000, 'прикріплення скріншота');

      applyInlineImageDisplaySize(
        attachmentNode,
        Number(displaySize.width) || 0,
        Number(displaySize.height) || 0
      );
      return true;
    } catch (error) {
      return false;
    }
  };

  const attachDraftAttachment = async (attachment) => {
    const attachmentPayload = await getDraftAttachment(attachment);
    const file = await dataUrlToFile(attachmentPayload);
    const shouldPreferInline = attachmentPayload.insertMode === 'inline';
    const displaySize = {
      width: attachmentPayload.displayWidth,
      height: attachmentPayload.displayHeight
    };

    if (shouldPreferInline && await pasteFileIntoEditor(file, displaySize)) {
      return;
    }

    if (await attachFileViaInput(file)) {
      return;
    }

    if (!shouldPreferInline && await pasteFileIntoEditor(file, displaySize)) {
      return;
    }

    throw new Error('Не вдалося прикріпити скріншот до чернетки HelpDeskEddy.');
  };

  const attachDraftAttachments = async (attachments) => {
    const normalizedAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
    for (const attachment of normalizedAttachments) {
      await attachDraftAttachment(attachment);
    }
  };

  const waitForVisibleDropdown = (fieldId, label) => waitForCondition(() => {
    const dropdown = document.querySelector(`.select-infinite-scroll-${fieldId}`);
    if (!(dropdown instanceof HTMLElement)) {
      return null;
    }

    const styles = window.getComputedStyle(dropdown);
    if (styles.display === 'none' || styles.visibility === 'hidden') {
      return null;
    }

    return dropdown;
  }, SELECT_WAIT_TIMEOUT_MS, `списку ${label}`);

  const getDropdownScrollWrap = (dropdown) => {
    const wrap = dropdown.querySelector('.el-select-dropdown__wrap, .el-scrollbar__wrap');
    return wrap instanceof HTMLElement ? wrap : null;
  };

  const getSelectableOptions = (dropdown) => Array.from(dropdown.querySelectorAll('.el-select-dropdown__item')).filter((option) => (
    option instanceof HTMLElement && !option.classList.contains('is-disabled')
  ));

  const findExactOption = (options, value, preferredDataId = '') => {
    const normalizedValue = normalizeComparableText(value);
    if (!normalizedValue) {
      return null;
    }

    if (preferredDataId) {
      const preferredOption = options.find((option) => option.getAttribute('data-id') === preferredDataId);
      if (preferredOption) {
        return preferredOption;
      }
    }

    return options.find((option) => isExactComparableMatch(normalizedValue, option.textContent || '')) || null;
  };

  const findBestVersionOption = (options, value) => {
    const exactMatch = findExactOption(options, value);
    if (exactMatch) {
      return exactMatch;
    }

    const normalizedShortVersion = normalizeVersionText(value);
    if (!normalizedShortVersion || !/^\d+(?:\.\d+){2}$/.test(normalizedShortVersion)) {
      return null;
    }

    const prefixMatches = options.filter((option) => {
      const optionVersion = normalizeVersionText(option.textContent || '');
      return optionVersion.startsWith(normalizedShortVersion);
    });

    if (!prefixMatches.length) {
      return null;
    }

    prefixMatches.sort((left, right) => compareNumericVersions(right.textContent || '', left.textContent || ''));
    return prefixMatches[0] || null;
  };

  const openElementUiSelect = (selectRoot, input) => {
    const trigger = selectRoot.querySelector('.el-input') || selectRoot;
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    trigger.click();
    input.focus();
  };

  const findDropdownOption = async (dropdown, value, { preferredDataId = '', allowScroll = false, optionResolver = null } = {}) => {
    const scrollWrap = getDropdownScrollWrap(dropdown);

    if (allowScroll && scrollWrap) {
      scrollWrap.scrollTop = 0;
      scrollWrap.dispatchEvent(new Event('scroll', { bubbles: true }));
      await waitForDelay(SELECT_SCROLL_SETTLE_MS);
    }

    const seenStates = new Set();
    let attempt = 0;

    while (attempt < SELECT_MAX_SCROLL_ATTEMPTS) {
      const options = getSelectableOptions(dropdown);
      const option = typeof optionResolver === 'function'
        ? optionResolver(options, value, preferredDataId)
        : findExactOption(options, value, preferredDataId);
      if (option) {
        return option;
      }

      if (!allowScroll || !scrollWrap) {
        return null;
      }

      const stateKey = `${scrollWrap.scrollTop}:${options.map((optionItem) => normalizeComparableText(optionItem.textContent || '')).join('|')}`;
      if (seenStates.has(stateKey)) {
        return null;
      }

      seenStates.add(stateKey);
      const maxScrollTop = Math.max(scrollWrap.scrollHeight - scrollWrap.clientHeight, 0);
      if (scrollWrap.scrollTop >= maxScrollTop) {
        return null;
      }

      scrollWrap.scrollTop = Math.min(scrollWrap.scrollTop + Math.max(scrollWrap.clientHeight - 24, 180), maxScrollTop);
      scrollWrap.dispatchEvent(new Event('scroll', { bubbles: true }));
      await waitForDelay(SELECT_SCROLL_SETTLE_MS);
      attempt += 1;
    }

    return null;
  };

  const getSelectedOption = (fieldId, dataId = '') => {
    const dropdown = document.querySelector(`.select-infinite-scroll-${fieldId}`);
    if (!(dropdown instanceof HTMLElement)) {
      return null;
    }

    if (dataId) {
      const option = dropdown.querySelector(`.el-select-dropdown__item.selected[data-id="${dataId}"]`);
      return option instanceof HTMLElement ? option : null;
    }

    const option = dropdown.querySelector('.el-select-dropdown__item.selected');
    return option instanceof HTMLElement ? option : null;
  };

  const dispatchOptionClickSequence = (option) => {
    const labelNode = option.querySelector('span');
    const targets = labelNode instanceof HTMLElement ? [option, labelNode] : [option];

    targets.forEach((target) => {
      target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    });

    if (labelNode instanceof HTMLElement) {
      labelNode.click();
    }

    option.click();
  };

  const commitOptionSelection = async (option, input, value, label, { fieldId = null, preferredDataId = '' } = {}) => {
    const expectedText = normalizeComparableText(option.textContent || value || '');
    const performClick = () => {
      option.scrollIntoView({ block: 'nearest' });
      dispatchOptionClickSequence(option);
    };

    performClick();

    try {
      await waitForCondition(() => {
        if (preferredDataId && fieldId !== null) {
          const selectedOption = getSelectedOption(fieldId, preferredDataId);
          if (selectedOption) {
            return input.value || selectedOption.textContent || 'selected';
          }
        }

        return isExactComparableMatch(expectedText, input.value) ? input.value : null;
      }, SELECT_WAIT_TIMEOUT_MS, `значення поля ${label}`);
    } catch (error) {
      performClick();
      await waitForCondition(() => {
        if (preferredDataId && fieldId !== null) {
          const selectedOption = getSelectedOption(fieldId, preferredDataId);
          if (selectedOption) {
            return input.value || selectedOption.textContent || 'selected';
          }
        }

        return isExactComparableMatch(expectedText, input.value) ? input.value : null;
      }, SELECT_WAIT_TIMEOUT_MS, `значення поля ${label}`);
    }

    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  const fillPriorityField = async (value) => {
    const fieldId = 43;
    const label = 'Пріоритет звернення';
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      throw new Error(`Немає значення для поля ${label}.`);
    }

    const input = document.querySelector(`#ticket-custom-field-${fieldId}`);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Не знайдено поле ${label}.`);
    }

    const alreadySelected = getSelectedOption(fieldId, PRIORITY_OPTION_ID);
    if (alreadySelected || isExactComparableMatch(normalizedValue, input.value)) {
      return;
    }

    const selectRoot = input.closest('.el-select');
    if (!(selectRoot instanceof HTMLElement)) {
      throw new Error(`Не знайдено контрол для поля ${label}.`);
    }

    openElementUiSelect(selectRoot, input);

    let dropdown;
    try {
      dropdown = await waitForVisibleDropdown(fieldId, label);
    } catch (error) {
      openElementUiSelect(selectRoot, input);
      dropdown = await waitForVisibleDropdown(fieldId, label);
    }

    await waitForDelay(60);

    const options = getSelectableOptions(dropdown);
    const option = options.find((item) => item.getAttribute('data-id') === PRIORITY_OPTION_ID)
      || findExactOption(options, normalizedValue);
    if (!(option instanceof HTMLElement)) {
      throw new Error(`У списку ${label} не знайдено значення "${normalizedValue}".`);
    }

    const verifySelected = () => waitForCondition(() => {
      const selectedOption = getSelectedOption(fieldId, PRIORITY_OPTION_ID);
      if (selectedOption) {
        return selectedOption.textContent || input.value || 'selected';
      }

      return isExactComparableMatch(normalizedValue, input.value) ? input.value : null;
    }, SELECT_WAIT_TIMEOUT_MS, `значення поля ${label}`);

    dispatchOptionClickSequence(option);

    try {
      await verifySelected();
    } catch (error) {
      input.focus();
      if (!input.readOnly) {
        setNativeInputValue(input, normalizedValue);
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true
        }));
      }

      dispatchOptionClickSequence(option);
      await verifySelected();
    }

    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  const fillElementUiSelect = async (fieldId, value, label, options = {}) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      throw new Error(`Немає значення для поля ${label}.`);
    }

    const input = document.querySelector(`#ticket-custom-field-${fieldId}`);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Не знайдено поле ${label}.`);
    }

    if (isExactComparableMatch(normalizedValue, input.value)) {
      return;
    }

    const selectRoot = input.closest('.el-select');
    if (!(selectRoot instanceof HTMLElement)) {
      throw new Error(`Не знайдено контрол для поля ${label}.`);
    }

    openElementUiSelect(selectRoot, input);

    let dropdown;
    try {
      dropdown = await waitForVisibleDropdown(fieldId, label);
    } catch (error) {
      openElementUiSelect(selectRoot, input);
      dropdown = await waitForVisibleDropdown(fieldId, label);
    }

    const option = await findDropdownOption(dropdown, normalizedValue, options);
    if (!(option instanceof HTMLElement)) {
      throw new Error(`У списку ${label} не знайдено значення "${normalizedValue}".`);
    }

    await commitOptionSelection(option, input, normalizedValue, label, {
      fieldId,
      preferredDataId: options.preferredDataId || ''
    });
  };

  const removeRequestHash = () => {
    if (!window.location.hash) {
      return;
    }

    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(null, document.title, url.toString());
  };

  const completeRequest = async (requestId, ok, error = '') => {
    await sendRuntimeMessage({
      action: 'COMPLETE_HELPDESK_DRAFT_REQUEST',
      requestId,
      ok,
      error
    });
  };

  const safeCompleteRequest = async (requestId, ok, error = '') => {
    try {
      await completeRequest(requestId, ok, error);
    } catch (completionError) {
      console.warn('[DAO Tools+] Failed to complete HelpDeskEddy draft request', completionError);
    }
  };

  const getPendingDraftRequest = async (requestId) => {
    try {
      return await sendRuntimeMessage({
        action: 'GET_HELPDESK_DRAFT_PAYLOAD',
        requestId
      });
    } catch (error) {
      if (!requestId && /не знайдено|not found/i.test(error?.message || '')) {
        return null;
      }

      throw error;
    }
  };

  const fillDraft = async (payload) => {
    await waitForDraftForm();
    fillTextField('#title', payload.title, 'Тема');
    fillTextField('#ticket-custom-field-51', payload.externalNumber, 'Зовнішній №');
    fillTextField('#ticket-custom-field-56', payload.crmId, 'CRMID');
    fillTextField('#ticket-custom-field-70', payload.serverUrl, 'URL сервера');
    await fillDescription(payload.description);
    await fillPriorityField(payload.priority);
    await fillElementUiSelect(60, payload.version, 'Версія Syrve', {
      allowScroll: true,
      optionResolver: findBestVersionOption
    });
    await attachDraftAttachments(payload.attachments);
  };

  const bootstrap = async () => {
    const requestIdFromHash = getRequestIdFromHash();
    if (requestIdFromHash && (processedRequestIds.has(requestIdFromHash) || activeRequestId === requestIdFromHash)) {
      return;
    }

    const response = await getPendingDraftRequest(requestIdFromHash);
    if (!response?.requestId || !response.payload) {
      return;
    }

    const requestId = response.requestId;
    if (processedRequestIds.has(requestId) || activeRequestId === requestId) {
      return;
    }

    activeRequestId = requestId;

    try {
      if (!DRAFT_PATH_PATTERN.test(window.location.pathname)) {
        throw new Error('Сторінка HelpDeskEddy відкрилася не в режимі чернетки. Перевірте авторизацію або URL.');
      }

      await fillDraft(response.payload || {});
      processedRequestIds.add(requestId);
      await safeCompleteRequest(requestId, true);
      removeRequestHash();
    } catch (error) {
      processedRequestIds.add(requestId);
      await safeCompleteRequest(requestId, false, error?.message || 'Не вдалося заповнити чернетку HelpDeskEddy.');
      removeRequestHash();
      console.error('[DAO Tools+] HelpDeskEddy autofill failed', error);
    } finally {
      activeRequestId = null;
    }
  };

  window.addEventListener('hashchange', () => {
    bootstrap().catch((error) => {
      console.error('[DAO Tools+] HelpDeskEddy bootstrap failed', error);
    });
  });

  bootstrap().catch((error) => {
    console.error('[DAO Tools+] HelpDeskEddy bootstrap failed', error);
  });
})();
