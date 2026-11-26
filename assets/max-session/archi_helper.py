"""Archi Helper session for 3ds Max. Run with Scripting > Run Script or PythonHost."""

import builtins
import json
import math
import os
import tempfile
import time
import uuid

import pymxs
from PySide2 import QtCore, QtNetwork


rt = pymxs.runtime
VERSION = "1.1.0"
YEAR = 1998 + int(rt.maxVersion()[0]) // 1000
PID = os.getpid()


def integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("Integer outside the supported range")
    return value


def position(value):
    if not isinstance(value, list) or len(value) != 3 or not all(
        type(v) in (float, int) and math.isfinite(v) and abs(v) <= 1e9 for v in value
    ):
        raise ValueError("Expected three finite world coordinates")
    return rt.Point3(*value)


def describe(node):
    parent = node.parent
    return {"handle": int(node.handle), "name": str(node.name)[:256],
            "class": str(rt.classOf(node)), "parent": int(parent.handle) if parent else None}


def get_node(args):
    node = rt.maxOps.getNodeByHandle(integer(args.get("handle"), 1, 0xffffffff))
    if node is None or not rt.isValidNode(node):
        raise ValueError("Object no longer exists")
    return node


def scene_page(command, args):
    offset = integer(args.get("offset", 0), 0, 0x7fffffff)
    limit = integer(args.get("limit", 100), 1, 200)
    selection = args.get("selection_only", False)
    if type(selection) is not bool:
        raise ValueError("Expected a boolean")
    if command == "get_materials":
        items = rt.sceneMaterials
    else:
        items = rt.selection if selection else rt.objects
    total = len(items)
    rows = []
    for index in range(offset, min(offset + limit, total)):
        item = items[index]
        rows.append({"name": str(item.name)[:256], "class": str(rt.classOf(item))}
                    if command == "get_materials" else describe(item))
    return {"total": total, "items": rows, "next_offset": offset + len(rows) if offset + len(rows) < total else None}


def viewport():
    folder = os.path.join(tempfile.gettempdir(), "3dsmax-mcp")
    os.makedirs(folder, exist_ok=True)
    filename = os.path.join(folder, "viewport_" + uuid.uuid4().hex + ".png")
    rt.completeRedraw()
    bitmap = rt.viewport.getViewportDib()
    try:
        bitmap.filename = filename
        if not rt.save(bitmap):
            raise RuntimeError("Could not save viewport")
    finally:
        rt.close(bitmap)
    return {"file": filename}


def dispatch(command, args):
    if command == "get_bridge_status":
        return {"pid": PID, "year": YEAR, "version": VERSION}
    if command in ("query_scene", "get_hierarchy", "get_materials"):
        return scene_page(command, args)
    if command == "inspect_object":
        node = get_node(args)
        p = node.position
        return dict(describe(node), position=[p.x, p.y, p.z],
                    bounds=[[v.x, v.y, v.z] for v in (node.min, node.max)],
                    material=str(node.material.name)[:256] if node.material else None)
    if command == "capture_viewport":
        return viewport()
    if command == "create_object":
        shape = {"box": rt.Box, "sphere": rt.Sphere, "cylinder": rt.Cylinder}.get(args.get("type"))
        name = args.get("name")
        if shape is None or (name is not None and (not isinstance(name, str) or not 1 <= len(name) <= 128)):
            raise ValueError("Invalid primitive or object name")
        size = args.get("size", 25)
        if type(size) not in (int, float) or not math.isfinite(size) or not 0 < size <= 1e9:
            raise ValueError("Expected a positive size in scene units")
        kind = args["type"]
        options = ({"length": size, "width": size, "height": size} if kind == "box"
                   else {"radius": size / 2.0} if kind == "sphere"
                   else {"radius": size / 2.0, "height": size})
        options["pos"] = position(args.get("position", [0, 0, 0]))
        if name is not None:
            options["name"] = name
        with pymxs.undo(True, "Archi Helper"):
            return describe(shape(**options))
    if command == "transform_object":
        node, point = get_node(args), position(args.get("position"))
        with pymxs.undo(True, "Archi Helper"):
            node.position = point
            return describe(node)
    if command == "undo_last":
        pymxs.run_undo()
        return {"undo_requested": True}
    raise ValueError("Operation unavailable in this session")


class Session(QtCore.QObject):
    def __init__(self):
        super().__init__(QtCore.QCoreApplication.instance())
        self.server = QtNetwork.QLocalServer(self)
        self.server.setSocketOptions(QtNetwork.QLocalServer.UserAccessOption)
        self.server.newConnection.connect(self.accept)
        if not self.server.listen("ArchiHelper-MaxSession-v2-" + str(PID)):
            raise RuntimeError(self.server.errorString())

    def accept(self):
        while self.server.hasPendingConnections():
            peer = self.server.nextPendingConnection()
            peer.setReadBufferSize(65537)
            peer.readyRead.connect(lambda socket=peer: self.receive(socket))
            peer.disconnected.connect(peer.deleteLater)
            timeout = QtCore.QTimer(peer)
            timeout.setSingleShot(True)
            timeout.timeout.connect(peer.abort)
            timeout.start(30000)
            self.receive(peer)

    def receive(self, peer):
        if peer.property("handled"):
            return
        if peer.bytesAvailable() > 65536:
            peer.abort()
            return
        if not peer.canReadLine():
            return
        peer.setProperty("handled", True)
        try:
            request = json.loads(bytes(peer.readLine()).decode("utf-8"))
            if request["pid"] != PID or request["year"] != YEAR or time.time() * 1000 >= request["expires"]:
                raise ValueError("Session changed or request expired")
            args = request["args"]
            if not isinstance(args, dict):
                raise ValueError("Expected an object")
            response = {"result": dispatch(request["name"], args)}
        except Exception as error:
            response = {"isError": True, "error": str(error)[:512]}
        peer.write((json.dumps(response, ensure_ascii=True) + "\n").encode("ascii"))
        peer.disconnectFromServer()


# Running the script again in an open scene reuses its existing session.
if not getattr(builtins, "_archi_helper_max_session_v2", None):
    builtins._archi_helper_max_session_v2 = Session()
