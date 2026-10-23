---
id: "ac25-capabilities"
title: "Archicad 25: historical API observations"
summary: "AC25 build 7000 / Tapir 1.7.2: databaseId for ChangeWindow, navigator and local PDF publishing."
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

Historical review dated 2026-10-22, Archicad 25 build 7000 RUS with Tapir 1.7.2. This is not a new integration run or a promise for other builds.

LayoutBook and PublisherSets trees, layout settings, publisher set names and publishing an existing PDF set to a local folder were observed. Recheck the current project, exact schemas, set format and produced files.

ChangeWindow with navigatorItemId was unsupported on this connection. Resolve databaseId with GetDatabaseIdFromNavigatorItemId, then use windowType="Layout" and databaseId. Never infer visible content or master-layout ownership from an empty element query. Read archicad-capabilities and layout-audit for the shared procedure.
