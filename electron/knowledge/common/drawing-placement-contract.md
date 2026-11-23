---
id: "drawing-placement-contract"
title: "Размещение чертежа на макете"
summary: "Источник, база назначения, коэффициент и номинальный масштаб в CreateDrawings."
kind: "skill"
activation: "auto"
enabled: true
tags: ["drawing","placement","layout","чертёж","макет","масштаб"]
archicad: []
triggers: ["CreateDrawings","drawingScale","layoutDatabaseId","DrawingNameType","чертёж","чертеж","размест"]
related: ["archicad-capabilities"]
---

# Размещение чертежа на макете через CreateDrawings

Сверьте схему текущего подключения. В каждой записи `drawingsData[]` передайте `navigatorItemId` пригодного для размещения вида или точки обзора и координаты `position` на макете. Для явного выбора макета передайте `layoutDatabaseId`. Получите идентификатор базы макета через `GetDatabaseIdFromNavigatorItemId` по узлу LayoutBook. Без `layoutDatabaseId` схема описывает размещение на активном макете. Исходный вид и целевой макет проверяйте по соответствующим деревьям навигатора.

`scale` задаёт положительный коэффициент относительно исходного вида и читается в деталях чертежа как `ratio`. `drawingScale` задаёт номинальный масштаб и читается под тем же именем. Для названия из исходного вида предусмотрено `nameType: "ViewOrSourceFileName"`. Если передать `name` без `nameType`, схема подразумевает `CustomName`.

Явно синтетический запрос с коэффициентом масштаба и номинальным масштабом.

```json
{"drawingsData":[{"navigatorItemId":{"guid":"00000000-0000-4000-8000-000000000001"},"layoutDatabaseId":{"guid":"00000000-0000-4000-8000-000000000002"},"position":{"x":0.1,"y":0.2},"scale":0.5,"drawingScale":100,"nameType":"ViewOrSourceFileName"}]}
```

Проверьте каждую запись `elements[]` после снятия оболочки MCP. Успешная запись возвращает `elementId`, отказ возвращает `error`. Для полученного ID заново прочитайте детали на целевом макете через доступный API и проверьте источник, позицию и нужные параметры масштаба. При частичном или неизвестном исходе проверьте содержимое макета до повторного создания.

Проверены поставляемая схема `CreateDrawings` версии `1.4.0`, поля `DrawingDetails` и синтетический JSON. Отображение и размеры чертежа на макете требуют отдельной проверки в PLN. [Поля CreateDrawings в Tapir](https://github.com/ENZYME-APD/tapir-archicad-automation/pull/654)
