"""Freeze definitions from the bundled packages without connecting to Archicad."""
import ast
import importlib
import importlib.metadata
import inspect
import json
from pathlib import Path
import re
import sys
import textwrap

import archicad.releases
from archicad_mcp.tapir import COMMANDS
from archicad_mcp.tapir.parser import tapir_version


def signature(value):
    sig = inspect.signature(value)
    sig = sig.replace(parameters=[p for p in sig.parameters.values() if p.name != "self"])
    return re.sub(r"archicad\.releases\.ac\d+\.b\d+types\.", "", str(sig))


def command(name, method):
    tree = ast.parse(textwrap.dedent(inspect.getsource(method)))
    wire_name = None
    response_keys = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value == "command" and isinstance(value, ast.Constant):
                    wire_name = value.value
        if (isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant)
                and isinstance(node.value, ast.Subscript)
                and isinstance(node.value.value, ast.Name) and node.value.value.id == "result"
                and isinstance(node.value.slice, ast.Constant) and node.value.slice.value == "result"):
            response_keys.add(node.slice.value)
    return {"name": name, "httpCommand": wire_name, "pythonSignature": name + signature(method),
            "description": inspect.getdoc(method) or "", "responseKeys": sorted(response_keys)}


releases = []
for directory in sorted(Path(archicad.releases.__path__[0]).glob("ac[0-9]*")):
    version = int(directory.name[2:])
    for source in sorted(directory.glob("b*commands.py")):
        build = int(source.stem[1:-8])
        module = importlib.import_module(f"archicad.releases.ac{version}.{source.stem}")
        types = importlib.import_module(f"archicad.releases.ac{version}.b{build}types")
        releases.append({"version": version, "build": build,
            "commands": [command(name, method) for name, method in inspect.getmembers(module.Commands, inspect.isfunction) if not name.startswith("_")],
            "types": [{"name": name, "pythonSignature": name + signature(cls), "description": inspect.getdoc(cls) or ""}
                      for name, cls in inspect.getmembers(types, inspect.isclass)
                      if not name.startswith("_") and name != "Types" and cls.__module__ == types.__name__]})

catalog = {"schemaVersion": 1, "sdkVersion": importlib.metadata.version("archicad"),
           "releases": sorted(releases, key=lambda item: (item["version"], item["build"]), reverse=True),
           "tapir": {"version": tapir_version(), "commands": [
               {"name": item["name"], "description": item["description"], "group": item["group"],
                "sinceVersion": item["version"], "inputSchema": item["schema"]} for item in COMMANDS]}}
Path(sys.argv[1]).write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
print(f"API catalog: {len(releases)} SDK releases, {len(COMMANDS)} Tapir commands")
