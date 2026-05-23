(() => {
  const REQUEST_ID_PARAM = 'requestId';
  const JPEG_QUALITY = 0.92;
  const captureButton = document.getElementById('capture-button');
  const statusNode = document.getElementById('status');
  let isRunning = false;

  const setStatus = (message, isError = false) => {
    if (statusNode) {
      statusNode.textContent = message || '';
      statusNode.style.color = isError ? '#991b1b' : '#7c2d12';
    }
  };

  const setButtonBusy = (isBusy) => {
    if (captureButton instanceof HTMLButtonElement) {
      captureButton.disabled = isBusy;
      captureButton.textContent = isBusy ? 'Готуємо скріншот...' : 'Обрати екран';
    }
  };

  const getRequestId = () => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return String(params.get(REQUEST_ID_PARAM) || '').trim();
  };

  const sendRuntimeMessage = (payload) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || 'Помилка обробки запиту.'));
        return;
      }

      resolve(response);
    });
  });

  const sendResult = (payload) => sendRuntimeMessage({
    action: 'STALE_LICENSE_SCREENSHOT_CAPTURE_RESULT',
    ...payload
  }).catch(() => {});

  const waitForDelay = (timeoutMs) => new Promise((resolve) => {
    window.setTimeout(resolve, timeoutMs);
  });

  const waitForVideoFrame = (video) => new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Не вдалося отримати кадр екрана.'));
    }, 8000);

    const finish = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      finish();
      return;
    }

    video.addEventListener('loadedmetadata', finish, { once: true });
    video.addEventListener('error', () => {
      window.clearTimeout(timeoutId);
      reject(new Error('Не вдалося прочитати відеопотік екрана.'));
    }, { once: true });
  });

  const captureStreamFrame = async (stream) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    await video.play();
    await waitForVideoFrame(video);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas недоступний для створення скріншота.');
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
      width: canvas.width,
      height: canvas.height,
      mimeType: 'image/jpeg'
    };
  };

  const stopStream = (stream) => {
    stream?.getTracks?.().forEach((track) => {
      track.stop();
    });
  };

  const closeCaptureTab = () => {
    window.setTimeout(() => {
      window.close();
    }, 700);
  };

  const prepareCaptureTarget = (requestId) => sendRuntimeMessage({
    action: 'PREPARE_STALE_LICENSE_SCREENSHOT_CAPTURE',
    requestId
  });

  const chooseDesktopMedia = () => new Promise((resolve, reject) => {
    if (!chrome.desktopCapture?.chooseDesktopMedia) {
      reject(new Error('Chrome desktopCapture недоступний.'));
      return;
    }

    try {
      chrome.desktopCapture.chooseDesktopMedia(['screen'], (streamId) => {
        const runtimeMessage = chrome.runtime.lastError?.message;
        if (runtimeMessage) {
          reject(new Error(runtimeMessage));
          return;
        }

        resolve(String(streamId || '').trim());
      });
    } catch (error) {
      reject(error);
    }
  });

  const createDesktopStream = (streamId) => navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId,
        maxWidth: 10000,
        maxHeight: 10000
      }
    }
  });

  const run = async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    setButtonBusy(true);
    const requestId = getRequestId();
    if (!requestId) {
      setStatus('Не знайдено запит скріншота.', true);
      return;
    }

    let stream = null;
    try {
      setStatus('Оберіть весь екран у вікні Chrome.');
      const streamId = await chooseDesktopMedia();
      if (!streamId) {
        throw new Error('Вибір екрана скасовано.');
      }

      setStatus('Повертаємо таблицю на екран...');
      await prepareCaptureTarget(requestId);
      await waitForDelay(500);
      setStatus('Створюємо скріншот...');
      stream = await createDesktopStream(streamId);
      const frame = await captureStreamFrame(stream);
      await sendResult({
        requestId,
        ok: true,
        dataUrl: frame.dataUrl,
        width: frame.width,
        height: frame.height,
        mimeType: frame.mimeType
      });
      setStatus('Скріншот створено.');
    } catch (error) {
      setStatus(error?.message || 'Не вдалося створити скріншот.', true);
      await sendResult({
        requestId,
        ok: false,
        error: error?.message || 'Не вдалося створити скріншот.'
      });
    } finally {
      stopStream(stream);
      closeCaptureTab();
    }
  };

  if (captureButton instanceof HTMLButtonElement) {
    captureButton.addEventListener('click', () => {
      run().catch((error) => {
        setStatus(error?.message || 'Не вдалося створити скріншот.', true);
        closeCaptureTab();
      });
    });
  } else {
    run().catch(() => {
      closeCaptureTab();
    });
  }
})();
