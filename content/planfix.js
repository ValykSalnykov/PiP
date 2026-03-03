const waitForElement = (selector, timeout = 5000) => {
    return new Promise((resolve, reject) => {
        const interval = 100;
        let elapsed = 0;
        const checkExist = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(checkExist);
                resolve(element);
            }
            elapsed += interval;
            if (elapsed >= timeout) {
                clearInterval(checkExist);
                reject(new Error("Елемент не знайдено"));
            }
        }, interval);
    });
};

// Disco mode color constants
const DISCO_COLORS = {
    gradient: "linear-gradient(45deg, #ff0080, #ff8c00, #40e0d0, #ff0080)",
    textColor: "#000",
    borderColor: "#fff",
    boxShadow: "0 0 20px rgba(255, 0, 128, 0.6), 0 0 30px rgba(64, 224, 208, 0.4)",
    textShadow: "0 0 10px rgba(255, 255, 255, 0.8)"
};

// Function to apply disco style to button
const applyDiscoStyle = (button) => {
    // Store original styles for restoration
    if (!button.dataset.originalStyles) {
        button.dataset.originalStyles = JSON.stringify({
            background: button.style.background,
            backgroundSize: button.style.backgroundSize,
            animation: button.style.animation,
            color: button.style.color,
            fontWeight: button.style.fontWeight,
            border: button.style.border,
            boxShadow: button.style.boxShadow,
            textShadow: button.style.textShadow
        });
    }
    
    button.style.background = DISCO_COLORS.gradient;
    button.style.backgroundSize = "300% 300%";
    button.style.animation = "disco-gradient 3s ease infinite, disco-pulse 1s ease-in-out infinite";
    button.style.color = DISCO_COLORS.textColor;
    button.style.fontWeight = "bold";
    button.style.border = `2px solid ${DISCO_COLORS.borderColor}`;
    button.style.boxShadow = DISCO_COLORS.boxShadow;
    button.style.textShadow = DISCO_COLORS.textShadow;
    
    // Add keyframes if not already added
    if (!document.getElementById('disco-styles')) {
        const style = document.createElement('style');
        style.id = 'disco-styles';
        style.textContent = `
            @keyframes disco-gradient {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
            }
            @keyframes disco-pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.05); }
            }
        `;
        document.head.appendChild(style);
    }
};

// Function to remove disco style from button
const removeDiscoStyle = (button) => {
    // Restore original styles if they were saved
    if (button.dataset.originalStyles) {
        const originalStyles = JSON.parse(button.dataset.originalStyles);
        button.style.background = originalStyles.background;
        button.style.backgroundSize = originalStyles.backgroundSize;
        button.style.animation = originalStyles.animation;
        button.style.color = originalStyles.color;
        button.style.fontWeight = originalStyles.fontWeight;
        button.style.border = originalStyles.border;
        button.style.boxShadow = originalStyles.boxShadow;
        button.style.textShadow = originalStyles.textShadow;
        delete button.dataset.originalStyles;
    }
};

// Функція для вилучення адреси .daocloud.fun з рядка, що може містити кілька адрес через /
const extractDaoCloudAddress = (rawAddress) => {
    const parts = rawAddress.split('/').map(s => s.trim()).filter(Boolean);
    return parts.find(p => /\.daocloud\.fun/i.test(p)) || null;
};

// Listen for disco mode toggle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggleDiscoMode') {
        const button = document.getElementById('send-data-button');
        if (button) {
            if (message.discoMode) {
                applyDiscoStyle(button);
            } else {
                removeDiscoStyle(button);
            }
        }
    }
});

// Функція для отримання параметра `key` з URL
const getKeyFromUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('key');
};

// Оновлена функція для асинхронного отримання даних з chrome.storage
const getUserInputFromStorage = async () => {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['userInput'], (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error('Помилка доступу до storage'));
            } else {
                resolve(result.userInput || 'default_value');
            }
        });
    });
};

// Основна логіка
(async () => {
    console.log("Очікуємо завантаження елемента...");

    try {
        let currentKey = getKeyFromUrl();  // Отримуємо початковий `key`
        console.log("Поточний ключ:", currentKey);

        // Функція для обробки елемента довідника
        const processElement = async () => {
            const field72ValueElement = await waitForElement(
                "body > main > div.body-container > div > div.page-layout-block.handbook-card-container.page-layout-block-gray.b-last-block > div.b-main-block-content > div.baron_wrapper.baron_wrapper_scroll_redirect > div > div.b-main-block.baron_container > div > div > div > div > div > div > div > div:nth-child(5) > div > div > div > div > div > div > div > div.object-edit-field-bottom-panel-rc__wrapper-box > div > div.view > div > span"
            );

            console.log("Елемент знайдено:", field72ValueElement);

            // Перевіряємо, чи кнопка вже створена
            if (!document.querySelector("#send-data-button")) {
                // Створюємо обгортку для тексту і кнопки
                const wrapper = document.createElement('div');
                wrapper.style.display = "flex";
                wrapper.style.alignItems = "center";

                // Переміщуємо текстовий елемент у нову обгортку
                field72ValueElement.parentElement.insertBefore(wrapper, field72ValueElement);
                wrapper.appendChild(field72ValueElement);

                // Створюємо кнопку
                const button = document.createElement('button');
                button.id = "send-data-button";
                button.textContent = "Увійти в бекофіс";
                button.style.marginLeft = "10px"; // Відступ між текстом і кнопкою
                button.style.cursor = "pointer";
                button.style.transition = "all 0.3s ease";

                // Apply disco mode if enabled
                chrome.storage.local.get(['discoMode'], (result) => {
                    if (result.discoMode) {
                        applyDiscoStyle(button);
                    }
                });

                // Додаємо кнопку до обгортки
                wrapper.appendChild(button);

                // Додаємо обробник події для кнопки
                button.addEventListener('click', async () => {
                    console.log("Кнопка натиснута.");

                    const rawField72Value = field72ValueElement.textContent.trim();
                    const field72Value = extractDaoCloudAddress(rawField72Value);
                    if (!field72Value) {
                        console.warn("Адреса .daocloud.fun не знайдена, дію скасовано.");
                        return;
                    }

                    const field74ValueElement = document.querySelector(
                        "body > main > div.body-container > div > div.page-layout-block.handbook-card-container.page-layout-block-gray.b-last-block > div.b-main-block-content > div.baron_wrapper.baron_wrapper_scroll_redirect > div > div.b-main-block.baron_container > div > div > div > div > div > div > div > div:nth-child(7) > div > div > div > div > div > div > div > div.object-edit-field-bottom-panel-rc__wrapper-box > div > div.view > div > span"
                    );
                    const field74Value = field74ValueElement ? field74ValueElement.textContent.trim() : null;

                    // Отримуємо збережене значення з chrome.storage
                    try {
                        const savedField = await getUserInputFromStorage();
                        console.log("Збережене значення:", savedField);

                        // Формуємо дані для запиту
                        const payload = {
                            address: field72Value,
                            port: field74Value,
                            client_id: savedField,
                        };

                        console.log("Дані для надсилання:", payload);

                        // Надсилаємо POST-запит
                        const response = await fetch('https://planfix-to-syrve.com:8000/send_data/', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(payload),
                        });

                        if (response.ok) {
                            console.log(await response.json(), response.status);
                            console.log("Дані успішно надіслано.");
                        } else {
                            console.error("Помилка при надсиланні:", response.status, response.statusText);
                        }
                    } catch (error) {
                        console.error("Помилка мережі:", error);
                    }
                });
            }
        };

        // Спостереження за зміною URL (зміна `key`)
        const observer = new MutationObserver(async () => {
            const newKey = getKeyFromUrl();
            if (newKey !== currentKey) {
                console.log("Змінився ключ:", newKey);
                currentKey = newKey;
                await processElement();  // Перезапускаємо логіку для нового елемента
            }
        });

        // Налаштування спостереження за змінами в URL
        observer.observe(document, {
            childList: true,
            subtree: true
        });

        // Початковий запуск
        await processElement();

    } catch (error) {
        console.error(error.message);
    }
})();

// --- Логіка для сторінки з панеллю полів (f-id="72") ---
(async () => {
    const LICENSE_MANAGER_BASE = "https://syrve-license-manager-1038989357415.us-west1.run.app/";
    const BUTTONS_ID = "license-buttons-panel";

    const createLicenseBtn = (label, action, color) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = `
            margin-left: 8px;
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 4px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            background: ${color};
            color: #fff;
            transition: opacity 0.2s ease;
            white-space: nowrap;
        `;
        btn.addEventListener('mouseenter', () => { btn.style.opacity = "0.82"; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = "1"; });
        btn.addEventListener('click', () => {
            const serverField = document.querySelector('.field-target[f-id="72"] .ObjectEditFieldBase__view__value__text');
            const rawServer = serverField ? serverField.textContent.trim() : '';
            const server = extractDaoCloudAddress(rawServer);
            if (!server) { alert("Адреса .daocloud.fun не знайдена."); return; }
            const portField = document.querySelector('.field-target[f-id="74"] .ObjectEditFieldBase__view__value__text');
            const port = portField ? portField.textContent.trim() : '';
            const portParam = port ? `&port=${encodeURIComponent(port)}` : '';
            window.open(`${LICENSE_MANAGER_BASE}?server=${encodeURIComponent(server)}${portParam}&action=${action}`, '_blank');
        });
        return btn;
    };

    const injectPanelButtons = () => {
        if (document.getElementById(BUTTONS_ID)) return;

        const serverFieldTarget = document.querySelector('.field-target[f-id="72"]');
        if (!serverFieldTarget) return;

        const wrapperBox = serverFieldTarget.querySelector('.object-edit-field-bottom-panel-rc__wrapper-box');
        if (!wrapperBox) return;

        const container = document.createElement('div');
        container.id = BUTTONS_ID;
        container.style.cssText = `
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
            padding: 6px 0 2px 0;
        `;
        container.appendChild(createLicenseBtn("✓ Перевірити ліцензії", "check", "#059669"));
        container.appendChild(createLicenseBtn("↻ Оновити ліцензії", "update", "#d97706"));

        wrapperBox.after(container);
    };

    // Використовуємо MutationObserver для очікування появи елемента
    const panelObserver = new MutationObserver(() => {
        if (document.querySelector('.field-target[f-id="72"]')) {
            injectPanelButtons();
        }
        // Прибираємо кнопки при зміні сторінки, щоб уникнути дублювання
        if (!document.querySelector('.field-target[f-id="72"]') && document.getElementById(BUTTONS_ID)) {
            document.getElementById(BUTTONS_ID).remove();
        }
    });

    panelObserver.observe(document.body, { childList: true, subtree: true });

    // Одразу пробуємо, якщо елемент вже є
    injectPanelButtons();
})();

// --- Логіка для сторінки-списку довідника: sticky hover-панель масових дій ---
(() => {
    const LICENSE_MANAGER_BASE = "https://syrve-license-manager-1038989357415.us-west1.run.app/";

    const COL_CLIENT = 'td-item-qe-4';
    const COL_SERVER = 'td-item-qe-6';
    const COL_PORT   = 'td-item-qe-8';
    const COL_CHAIN  = 'td-item-qe-10';

    // Читати текст ячейки через <a>, щоб не захоплювати сторонній текст
    const cellText = (row, colClass) => {
        const td = row.querySelector(`td.${colClass}`);
        if (!td) return '';
        const link = td.querySelector('a');
        return (link ? link.textContent : td.textContent).trim();
    };

    // Зібрати унікальні пари server:port для групи
    const collectServers = (colClass, groupValue) => {
        const rows = document.querySelectorAll('tr.handbook-data-item');
        const seen = new Set();
        const result = [];
        rows.forEach(row => {
            if (cellText(row, colClass) !== groupValue) return;
            const server = cellText(row, COL_SERVER);
            if (!server) return;
            const port = cellText(row, COL_PORT) || '443';
            const entry = `${server}:${port}`;
            if (!seen.has(entry)) { seen.add(entry); result.push(entry); }
        });
        return result;
    };

    // --- Floating panel ---
    const panel = document.createElement('div');
    panel.id = 'bulk-hover-panel';
    panel.style.cssText = `
        position: fixed;
        z-index: 99999;
        background: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 10px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.14);
        padding: 10px 14px;
        display: none;
        flex-direction: column;
        gap: 8px;
        min-width: 220px;
        pointer-events: auto;
        opacity: 0;
        transition: opacity 0.15s ease;
        font-family: inherit;
        font-size: 12px;
    `;
    document.body.appendChild(panel);

    const makeBtn = (label, bg, onClick) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = `
            cursor: pointer;
            padding: 3px 10px;
            border-radius: 5px;
            border: none;
            font-weight: 600;
            font-size: 11px;
            background: ${bg};
            color: #fff;
            transition: opacity 0.15s ease;
            white-space: nowrap;
            flex-shrink: 0;
        `;
        btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.75'; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
        btn.addEventListener('click', onClick);
        return btn;
    };

    const makeGroupRow = (label, value, colClass) => {
        if (!value) return null;
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        const lbl = document.createElement('span');
        lbl.textContent = `${label}:`;
        lbl.style.cssText = 'color: #6b7280; font-weight: 500; flex-shrink: 0; min-width: 46px; font-size: 11px;';

        const val = document.createElement('span');
        val.textContent = value;
        val.style.cssText = 'font-weight: 600; color: #111827; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

        const openUrl = (action) => {
            const servers = collectServers(colClass, value);
            if (!servers.length) { alert(`Не знайдено серверів для: ${value}`); return; }
            window.open(`${LICENSE_MANAGER_BASE}?servers=${encodeURIComponent(servers.join(','))}&action=${action}`, '_blank');
        };

        row.appendChild(lbl);
        row.appendChild(val);
        row.appendChild(makeBtn('✓ Перевірити', '#059669', () => openUrl('check')));
        row.appendChild(makeBtn('↻ Оновити',    '#d97706', () => openUrl('update')));
        return row;
    };

    let hideTimer = null;

    // Позиціонувати панель під ячейкою, вирівнюючи по лівому краю
    const positionBelow = (td) => {
        const rect = td.getBoundingClientRect();
        const panelW = panel.offsetWidth || 260;

        // вертикально: під ячейкою + 4px
        let top = rect.bottom + 4;

        // горизонтально: від лівого краю ячейки, з урахуванням меж екрану
        let left = rect.left;
        if (left + panelW > window.innerWidth - 8) {
            left = window.innerWidth - panelW - 8;
        }
        left = Math.max(8, left);

        panel.style.top  = `${top}px`;
        panel.style.left = `${left}px`;
        panel.style.right = 'auto';
    };

    const showPanel = (td, colClass, label, value) => {
        clearTimeout(hideTimer);
        if (!value) return;

        panel.innerHTML = '';
        const groupRow = makeGroupRow(label, value, colClass);
        if (!groupRow) return;
        panel.appendChild(groupRow);

        panel.style.display = 'flex';
        // Позиціонуємо після display:flex, щоб offsetWidth був актуальним
        requestAnimationFrame(() => {
            positionBelow(td);
            panel.style.opacity = '1';
        });
    };

    const hidePanel = (delay = 200) => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            panel.style.opacity = '0';
            setTimeout(() => { panel.style.display = 'none'; }, 150);
        }, delay);
    };

    panel.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    panel.addEventListener('mouseleave', () => hidePanel(150));

    // Підвішуємо події на конкретні ячейки (Chain / Клієнт)
    const COLS = [
        { colClass: COL_CHAIN,  label: 'Chain'   },
        { colClass: COL_CLIENT, label: 'Клієнт' },
    ];

    const attachCellHover = () => {
        document.querySelectorAll('tr.handbook-data-item').forEach(row => {
            COLS.forEach(({ colClass, label }) => {
                const td = row.querySelector(`td.${colClass}`);
                if (!td || td.dataset.hoverAttached) return;
                td.dataset.hoverAttached = '1';
                td.style.cursor = 'default';

                td.addEventListener('mouseenter', () => {
                    const value = cellText(row, colClass);
                    showPanel(td, colClass, label, value);
                });
                td.addEventListener('mouseleave', () => hidePanel());
            });
        });
    };

    const observer = new MutationObserver(attachCellHover);
    observer.observe(document.body, { childList: true, subtree: true });
    attachCellHover();
})();
