---
id: "python-workflow"
title: "Python and the version-selected Archicad SDK"
summary: "Exact SDK signatures, typed objects, ports, UTF-8 and isolated dependencies."
kind: "skill"
activation: "auto"
enabled: true
tags: ["python","sdk","types","питон","скрипт"]
triggers: ["python","sdk","script","скрипт","питон","run_python"]
related: ["archicad-capabilities"]
---

# Python workflow

If a Python Archicad operation is necessary, retrieve its exact signature from get_api_catalog with source='graphisoft' and the required type constructors with source='types'. The same catalog file is in os.environ['ARCHI_API_CATALOG']. The selected connection port is in os.environ['ARCHICAD_PORT']; verify the connection and project through MCP first. The typed Graphisoft SDK is separate from Tapir: connect with archicad.ACConnection.connect(int(os.environ['ARCHICAD_PORT'])), check the connection is not None, pass typed arguments, and serialize returned objects with to_dict(), never dict(), __dict__ or dictionary indexing. Tapir-only commands such as GetDetailsOfElements are not methods of conn.commands. The bundled JSON helper is from archicad_mcp.tapir.client import run_tapir_command; for example run_tapir_command('GetStories', {}) returns a dictionary. Use source='tapir' for its exact JSON input schema. Use only names and arguments documented for that API source and connection version. Do not guess ports or raw HTTP payloads. For subprocess text output on Windows, specify encoding='utf-8' explicitly.

Bundled uv is available through os.environ['ARCHI_UV']; Python is sys.executable. If extra libraries are needed, create a separate environment inside the chat workspace. Do not modify the app's bundled environment.
