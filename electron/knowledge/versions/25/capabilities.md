---
id: "ac25-capabilities"
title: "Archicad 25: проверенные возможности API"
summary: "Сборка 7000 и Tapir 1.7.2: databaseId для ChangeWindow, навигатор и локальная публикация PDF."
kind: "knowledge"
activation: "auto"
enabled: true
tags: ["layout","database","publisher","макет","версия"]
archicad: [25]
verifiedOn: [{"archicad":25,"build":7000,"tapir":"1.7.2"}]
triggers: ["ac25","archicad25"]
related: []
---

# Archicad 25

Область ранее проверенных возможностей: Archicad 25, сборка 7000 RUS, Tapir 1.7.2. Это историческая граница проверки, а не новый интеграционный запуск или обещание работы на других сборках.

В этой конфигурации проверялись деревья `LayoutBook` и `PublisherSets`, настройки макетов, имена наборов публикации и публикация существующего набора PDF в локальную папку. Для текущей работы заново проверьте подключение, точные схемы, формат набора и созданные файлы.

Вариант `ChangeWindow` с `navigatorItemId` не поддерживался. Получите `databaseId` через `GetDatabaseIdFromNavigatorItemId`, затем передайте `windowType="Layout"` и `databaseId`. Пустой результат запроса элементов не доказывает отсутствия видимого содержимого или его размещения на мастер-макете. Общая процедура описана в статьях «Возможности Archicad и выбор инструментов» (`archicad-capabilities`) и «Полная проверка макетов и экспорт PDF» (`layout-audit`).
