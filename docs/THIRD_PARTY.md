# Сторонние компоненты

Код Archi Helper опубликован под MIT. Лицензия проекта не заменяет лицензии включённых компонентов.

| Компонент | Лицензия / источник |
| --- | --- |
| Electron, React, react-markdown, remark-gfm, TanStack Virtual, MCP SDK, electron-updater, jose | MIT; тексты лицензий поставляются с приложением |
| lucide-react | ISC |
| CPython 3.13.7 | PSF |
| uv 0.11.26 | MIT; полный текст в `vendor/licenses/uv-MIT.txt` |
| FastMCP | Apache-2.0 |
| Pillow | HPND |
| pypdf | BSD-3-Clause |
| PyMuPDF / MuPDF 1.28.2 | AGPL-3.0; см. ниже |
| archicad | Apache-2.0; полный текст в метаданных Python-пакета |

[archicad-mcp](https://github.com/lgradisar/archicad-mcp) включён с исходниками и MIT-лицензией в `vendor/archicad-mcp`, коммит `13b8645cf9d6c59543a9c2f6b0021ac76e2b0b36`. Два файла определений команд и TAPIR_VERSION обновлены из официального Tapir 1.7.2: 314 команд, проверка соединения и универсальный вызов дают 316 инструментов.

[Tapir](https://github.com/ENZYME-APD/tapir-archicad-automation) — отдельное расширение ENZYME APD. Оно не вложено в установщик: приложение скачивает его из официального релиза с проверкой SHA-256.

## Исходники PyMuPDF / MuPDF

Обработка PDF использует неизменённый PyMuPDF 1.28.2 под AGPL-3.0. Текст лицензии находится в `vendor/licenses/AGPL-3.0.txt`. Отдельные архивы исходников PyMuPDF и MuPDF с инструкциями сборки прилагаются к каждому релизу рядом с установщиками. Их URL и SHA-256 закреплены в `vendor/pymupdf-source.json`.

Для воспроизведения загрузки: `npm run release:sources`. Исходники самого помощника соответствуют тегу релиза. При изменении или перераспространении компонентов сохраняйте их лицензии и выполняйте условия предоставления исходников. MIT-лицензия помощника не переопределяет AGPL или условия Graphisoft.

Точные версии зависимостей записаны в `package-lock.json` и `vendor/requirements.lock`. Метаданные и лицензии Python-пакетов остаются в `site-packages`; лицензии Electron и Chromium поставляются рядом с EXE.

Зависимости основного процесса включены в `electron/main.bundle.mjs`. Их тексты лицензий и компактные метаданные находятся в `resources/licenses/node`; дерево `node_modules` для запуска не требуется. Комментарии лицензий зависимостей интерфейса сохранены в собранных файлах Vite. Нативный экран обновления использует системный .NET Framework Windows; отдельная копия среды .NET в установщик не включена.

Персонаж и каска — исходные изображения проекта. Они созданы через [Aseprite MCP](https://github.com/MalloyTheDev/aseprite-mcp); сам Aseprite и сервер генерации в приложение не включены.

Archi Helper — независимое приложение, не продукт Graphisoft.

Логотип ChatGPT взят из [официальных материалов Sign in with ChatGPT](https://developers.openai.com/siwc/ui-ux-guidelines) ([SVG](https://developers.openai.com/assets/siwc/chatgpt-logo-white.svg)). Название и логотип принадлежат OpenAI и не покрываются MIT-лицензией Archi Helper.
