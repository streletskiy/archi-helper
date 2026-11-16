---
id: "object-rotation-contract"
title: "Поворот библиотечного объекта"
summary: "Целевой угол Object в радианах, проверка ответа и повторное чтение угла после ModifyObjects."
kind: "skill"
activation: "auto"
enabled: true
tags: ["object","rotation","поворот","объект"]
archicad: []
triggers: ["ModifyObjects","objectsWithDetails","поворот","поверну","объект"]
related: ["model-edit-verification"]
---

# Поворот библиотечного объекта через ModifyObjects

Сверьте схему команды с текущим подключением перед разрешённым изменением. Для элемента типа `Object` команда `ModifyObjects` принимает `objectsWithDetails[].angle` в радианах на одном уровне с `elementId`. Поле задаёт целевой угол. Если задача требует повернуть объект на заданную величину, прочитайте текущий угол и прибавьте к нему приращение в радианах.

Явно синтетический запрос с целевым углом 90°.

```json
{"objectsWithDetails":[{"elementId":{"guid":"00000000-0000-4000-8000-000000000001"},"angle":1.5707963267948966}]}
```

До записи сохраните исходный угол из `GetDetailsOfElements` в `detailsOfElements[].details.angle`. Для ограниченного чтения запрашивайте `fields: ["type","details"]`, если фильтр доступен в текущей схеме. Проверьте каждую запись `executionResults`, затем заново прочитайте угол и сравните его с целевым с числовым допуском, учитывая эквивалентные углы через полный оборот. При неизвестном исходе перечитайте состояние до повтора. Для разрешённого восстановления передайте сохранённый угол и подтвердите его новым чтением.

Единицы и путь чтения сверены по исходникам Tapir `2.0.0` и документации DevKit. Структура запроса и ответа проверена по поставляемой схеме `ModifyObjects` версии `1.5.7` и синтетическому JSON. Для оценки видимого поворота и сохранности геометрии нужна отдельная проверка в PLN. [Пример Tapir](https://github.com/ENZYME-APD/tapir-archicad-automation/blob/2.0.0/archicad-addon/Examples/Element/ModifyObjects.py), [Graphisoft DevKit](https://graphisoft.github.io/archicad-api-devkit/struct_a_p_i___object_type.html)
