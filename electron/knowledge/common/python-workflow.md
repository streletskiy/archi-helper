---
id: "python-workflow"
title: "Python и SDK для подключённой версии Archicad"
summary: "Сигнатуры SDK, параметры GetElementsByType, типизированные объекты, порты, UTF-8 и отдельное окружение."
kind: "skill"
activation: "auto"
enabled: true
tags: ["python","sdk","types","питон","скрипт"]
triggers: ["python","sdk","script","скрипт","питон","run_python","GetElementsByType"]
related: ["archicad-capabilities"]
---

# Работа с Python

Если нужна операция Archicad через Python, получите точную сигнатуру через `get_api_catalog` с `source="graphisoft"`, а конструкторы требуемых типов — с `source="types"`. Тот же каталог доступен по пути `os.environ['ARCHI_API_CATALOG']`. Порт выбранного подключения находится в `os.environ['ARCHICAD_PORT']`; сначала проверьте подключение и проект через MCP.

Типизированный SDK Graphisoft отличается от Tapir. Подключайтесь через `archicad.ACConnection.connect(int(os.environ['ARCHICAD_PORT']))`, проверяйте, что результат не равен `None`, и передавайте типизированные аргументы. Преобразуйте возвращённые объекты через `to_dict()`, а не `dict()`, `__dict__` или обращение по ключу словаря. Команды только для Tapir, например `GetDetailsOfElements`, не являются методами `conn.commands`.

Встроенный помощник JSON импортируется через `from archicad_mcp.tapir.client import run_tapir_command`; например, `run_tapir_command('GetStories', {})` возвращает словарь. Точную схему аргументов JSON ищите с `source="tapir"`. Используйте только имена и аргументы, документированные для этого источника API и версии подключения. Не угадывайте порты и содержимое HTTP-запросов. Для текстового вывода дочерних процессов в Windows явно указывайте `encoding='utf-8'`.

## GetElementsByType: обязательный параметр и контейнер запроса

Сначала выберите источник API. В SDK Graphisoft вызов имеет сигнатуру `conn.commands.GetElementsByType(elementType)` и возвращает список типизированных ссылок на элементы. У одноимённой команды Tapir аргументы — JSON-объект с обязательным строковым `elementType`; доступные `filters` и `databases` сверяйте с её схемой. Эти дополнительные аргументы нельзя переносить в сигнатуру SDK.

В прямом HTTP-запросе Graphisoft аргументы находятся внутри `parameters`. Явно синтетический пример тела запроса:

```json
{"command":"API.GetElementsByType","parameters":{"elementType":"Wall"}}
```

Пустой объект параметров не содержит обязательного `elementType`. Поле `elementType` на верхнем уровне тела или внутри `arguments` также не заполняет `parameters.elementType`. Если наблюдатель показывает `input_shape:{}`, проверьте полный локальный запрос: такая форма не различает отсутствие контейнера и пустой контейнер и не определяет источник API.

Для Tapir используйте `run_tapir_command('GetElementsByType', {'elementType': 'Wall'})`. Помощник сам формирует `API.ExecuteAddOnCommand` с `addOnCommandId` в пространстве `TapirCommand` и аргументами в `addOnCommandParameters`. Одинаковое короткое имя команды не делает эти HTTP-маршруты взаимозаменяемыми.

После ошибки исправьте контейнер и обязательное поле, затем повторите только нужное чтение. В прямом JSON-ответе сначала проверьте `succeeded` и `error`, затем `result.elements`; помощник Tapir возвращает уже распакованный словарь. При запросе нескольких баз через Tapir отдельно проверьте `executionResultForDatabases`: наличие `elements` не заменяет проверку результатов баз. Успешный вызов и пустой список сами по себе не подтверждают нужное покрытие проекта.

Проверка 2026-10-29 ограничена поставляемым каталогом Tapir 1.7.2, сигнатурами SDK, [документацией Graphisoft](https://archicadapi.graphisoft.com/archicadPythonPackage/archicad.html#archicad.Commands.GetElementsByType) и синтетическими JSON-запросами. Новый интеграционный запуск в PLN не выполнялся.

## Ответы, зависимости и восстановление

Сохранённый MCP-результат может содержать оболочку `structuredContent` или JSON-строку внутри `content[].text`. Декодируйте её до обращения к полям команды; не принимайте `KeyError` за доказательство отсутствия API. Проверяйте `executionResults` поэлементно: `success:false` внутри ответа означает неудачу даже при успешной доставке MCP. Для библиотечных элементов и типов GDL читайте `library-parts-gdl`.

Встроенный uv доступен через `os.environ['ARCHI_UV']`, Python — через `sys.executable`. Если нужны дополнительные библиотеки, создайте отдельное окружение в рабочей папке чата. Не изменяйте встроенное окружение приложения.

Проверка `assert` после изменяющего вызова не является транзакцией: её падение не отменяет ранее применённые операции. Сохраняйте исходное состояние до вызовов, проверяйте длину и каждый результат пакета, после исключения или тайм-аута прочитайте состояние перед повтором. Порядок восстановления и проверки геометрии описан в `model-edit-verification`.
