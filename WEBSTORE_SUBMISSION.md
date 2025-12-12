# Google Web Store Submission Guide

## Исправленные проблемы

### Ошибка валидации
**Проблема**: "Invalid value for 'web_accessible_resources[0]'. Invalid match pattern"

**Причина**: Паттерны в `web_accessible_resources` не совпадали с паттернами в `content_scripts`.

**Решение**: Обновлен паттерн в `web_accessible_resources` для соответствия `content_scripts`:
```json
"web_accessible_resources": [
  {
    "resources": [
      "inpage/pip-main.js",
      "inpage/pip-placeholder.css"
    ],
    "matches": [
      "https://studio--studio-1696970562-bd013.us-central1.hosted.app/syrve-install/*",
      "https://hub.daolog.net/*"
    ]
  }
]
```

## Проверка перед отправкой

### 1. Валидация manifest.json
```bash
# Проверка синтаксиса JSON
python3 -m json.tool manifest.json

# Проверка версии манифеста
grep manifest_version manifest.json
```

### 2. Проверка всех файлов
Убедитесь, что все файлы, упомянутые в manifest.json, существуют:
- `background.js`
- `icons/icon16.png`
- `planfix/popup.html`
- `planfix/popup.js`
- `content/bridge.js`
- `content/planfix.js`
- `inpage/pip-main.js`
- `inpage/pip-placeholder.css`

### 3. Создание ZIP-архива
```bash
# Создайте ZIP-архив с необходимыми файлами
zip -r extension.zip manifest.json background.js icons/ content/ inpage/ planfix/
```

## Требования Manifest V3

✅ **Соответствие требованиям:**
- `manifest_version`: 3
- `background.service_worker` вместо `background.scripts`
- `action` вместо `browser_action`
- `host_permissions` для сетевых запросов
- Правильные паттерны в `web_accessible_resources`

## Структура расширения

```
PiP/
├── manifest.json           # Основной файл конфигурации
├── background.js          # Service Worker (фоновый скрипт)
├── icons/
│   └── icon16.png        # Иконка расширения
├── content/
│   ├── bridge.js         # Content script для PiP
│   └── planfix.js        # Content script для PlanFix
├── inpage/
│   ├── pip-main.js       # Основной скрипт PiP
│   └── pip-placeholder.css # Стили для PiP
└── planfix/
    ├── popup.html        # HTML для popup
    └── popup.js          # JavaScript для popup
```

## Шаги для отправки в Web Store

1. **Подготовка**
   - Убедитесь, что все файлы на месте
   - Проверьте manifest.json на валидность
   - Протестируйте расширение локально

2. **Создание архива**
   - Создайте ZIP-архив с содержимым расширения
   - Не включайте скрытые файлы (.git, .DS_Store, и т.д.)

3. **Загрузка в Chrome Web Store**
   - Перейдите в [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Нажмите "New Item"
   - Загрузите ZIP-архив
   - Заполните описание и скриншоты
   - Отправьте на проверку

## Частые проблемы и решения

### Проблема: Invalid match pattern
**Решение**: Убедитесь, что все паттерны в `web_accessible_resources.matches` совпадают с паттернами в соответствующих `content_scripts.matches`.

### Проблема: Missing files
**Решение**: Проверьте, что все файлы, упомянутые в manifest.json, существуют в архиве.

### Проблема: Service worker not loading
**Решение**: Убедитесь, что `background.service_worker` указывает на правильный файл и файл использует ES modules синтаксис.

## Текущее состояние

✅ **Готово к отправке**
- Manifest V3: ✓
- Все файлы существуют: ✓
- Паттерны валидны: ✓
- Размер пакета: ~164KB
- Количество файлов: 9

## Поддерживаемые сайты

Расширение работает на следующих сайтах:
- `https://studio--studio-1696970562-bd013.us-central1.hosted.app/syrve-install/*`
- `https://hub.daolog.net/*`
- `https://dao.planfix.ua/*`
