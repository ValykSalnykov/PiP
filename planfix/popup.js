const inputField = document.getElementById("inputField");
const saveButton = document.getElementById("saveButton");
const serverField = document.getElementById("serverField");
const portField = document.getElementById("portField");
const sendDataButton = document.getElementById("sendDataButton");
const modeInfo = document.getElementById("modeInfo");
const toggleModeButton = document.getElementById("toggleModeButton");
const showErrorButton = document.getElementById("showErrorButton");
const errorMessage = document.getElementById("errorMessage");
const clientStatus = document.getElementById("clientStatus");
const clientIdBadge = document.getElementById("clientIdBadge");
const editClientBtn = document.getElementById("editClientBtn");
const clientSettingsCard = document.getElementById("clientSettingsCard");
const pipButton = document.getElementById("pipButton");

// PiP button handler
if (pipButton) {
  pipButton.addEventListener("click", async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'POPUP_PIP_TOGGLE' });
      if (response?.success) {
        window.close();
      } else {
        errorMessage.textContent = response?.error || 'Не удалось открыть PiP';
      }
    } catch (error) {
      errorMessage.textContent = 'Ошибка: ' + error.message;
    }
  });
}

const updateClientIdUI = (value) => {
  const normalized = (value || "").trim();
  const hasValue = normalized.length > 0;

  if (hasValue) {
    clientIdBadge.textContent = normalized;
    clientStatus?.classList.remove("is-hidden");
    clientSettingsCard?.classList.add("card--collapsed");
  } else {
    clientIdBadge.textContent = "";
    clientStatus?.classList.add("is-hidden");
    clientSettingsCard?.classList.remove("card--collapsed");
  }
};

// Завантаження Client ID
chrome.storage.local.get(['userInput'], (result) => {
  const stored = result.userInput || "";
  if (stored) {
    inputField.value = stored;
    updateClientIdUI(stored);
    fetchMode(stored);
  } else {
    updateClientIdUI("");
  }
});

editClientBtn?.addEventListener("click", () => {
  clientSettingsCard?.classList.remove("card--collapsed");
  clientStatus?.classList.add("is-hidden");
  inputField.focus();
  inputField.select();
});

// Збереження Client ID
saveButton.addEventListener("click", () => {
  const inputValue = inputField.value.trim();
  if (!inputValue) {
    alert("Please, input Client ID.");
    return;
  }
  chrome.storage.local.set({ userInput: inputValue }, () => {
    updateClientIdUI(inputValue);
    alert("Client ID saved!");
    window.close();
  });
});

// Автовибір порту
serverField.addEventListener("input", () => {
  const value = serverField.value.trim();
  if (value.endsWith("syrve.online") || value.endsWith("daocloud.it")) {
    portField.value = "443";
    portField.disabled = true;
  } else {
    portField.disabled = false;
    portField.value = "";
  }
});

// Одноразове відправлення даних
sendDataButton.addEventListener("click", () => {
  chrome.storage.local.get(['userInput'], async (result) => {
    const clientId = result.userInput;
    if (!clientId) {
      alert("Please save your Client ID first.");
      return;
    }

    const server = serverField.value.trim();
    let port = portField.value.trim();

    if (!server) {
      alert("Please, input server address.");
      return;
    }

    if (server.endsWith("syrve.online") || server.endsWith("daocloud.it")) {
      port = "443";
    } else if (!port) {
      alert("Please, input server port.");
      return;
    }

    const payload = { address: server, port: port, client_id: clientId };

    try {
      const response = await fetch("https://planfix-to-syrve.com:8000/send_data/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Data sent successfully!\n");
      } else {
        console.log("Error sending data. Status: " + response.status);
      }
    } catch (error) {
      console.error("Network error:", error);
      console.log("Network error. Check console.");
    }
  });
});

// Отримати поточний режим
const fetchMode = async (clientId) => {
  try {
    const response = await fetch("https://planfix-to-syrve.com:8000/get_mode_description/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId }),
    });

    if (response.ok) {
      const data = await response.json();
      modeInfo.textContent = `Текущий режим: ${data.description}`;
    } else {
      modeInfo.textContent = "Error fetching mode.";
    }
  } catch (error) {
    console.error("Error fetching mode:", error);
    modeInfo.textContent = "Error fetching mode.";
  }
};

// Перемикання режиму
toggleModeButton.addEventListener("click", async () => {
  chrome.storage.local.get(['userInput'], async (result) => {
    const clientId = result.userInput;
    if (!clientId) {
      alert("Please save your Client ID first.");
      return;
    }

    try {
      const response = await fetch("https://planfix-to-syrve.com:8000/toggle_mode/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });

      if (response.ok) {
        const data = await response.json();
        modeInfo.textContent = `Режим изменен на: ${data.description}`;
        alert(`Режим успешно изменен на: ${data.description}`);
      } else {
        alert("Ошибка при переключении режима.");
      }
    } catch (error) {
      console.error("Error toggling mode:", error);
    }
  });
});

// Показати останню помилку
showErrorButton.addEventListener("click", async () => {
  chrome.storage.local.get(['userInput'], async (result) => {
    const clientId = result.userInput;
    if (!clientId) {
      errorMessage.textContent = "Будь ласка, збережіть Client ID спочатку.";
      return;
    }

    try {
      const response = await fetch("https://planfix-to-syrve.com:8000/get_last_error/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });

      if (response.ok) {
        const data = await response.json();
        errorMessage.textContent = data.last_error ? `Last error:\n${data.last_error}` : "No errors.";
      } else {
        errorMessage.textContent = "Bad request, plugin could not reach server.";
      }
    } catch (error) {
      console.error("Error fetching last error:", error);
      errorMessage.textContent = "Помилка при запиті.";
    }
  });
});
