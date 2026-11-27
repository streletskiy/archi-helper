"""Archi Helper session for 3ds Max. Run with Scripting > Run Script or PythonHost."""

import builtins
import contextlib
import ctypes
import hashlib
import io
import json
import math
import os
import tempfile
import time
import uuid

import pymxs
from PySide2 import QtCore, QtNetwork


rt = pymxs.runtime
VERSION = "1.2.0"
YEAR = 1998 + int(rt.maxVersion()[0]) // 1000
PID = os.getpid()


def integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("Integer outside the supported range")
    return value


def vector(value):
    if not isinstance(value, list) or len(value) != 3 or not all(
        type(v) in (float, int) and math.isfinite(v) and abs(v) <= 1e9 for v in value
    ):
        raise ValueError("Expected three finite numbers within the supported range")
    return value


# Explicit contexts leave the artist's active coordinate system and pivot mode intact.
rotate_node = rt.execute("""(fn archiRotateNode n angles localAxes = (
    about pivot (if localAxes then (in coordsys local rotate n angles)
                 else (in coordsys world rotate n angles))
))""")


class ScriptOutput(io.StringIO):
    def __init__(self):
        super().__init__()
        self.truncated = False

    def write(self, text):
        remaining = max(0, 16384 - self.tell())
        super().write(text[:remaining])
        self.truncated |= len(text) > remaining
        return len(text)


def run_python(args):
    # Only a caller that can stage this specific request in the user's local profile
    # may execute code. A pipe message alone carries no execution authority.
    code = args.get("code")
    ticket = args.get("ticket")
    # Qt's UserAccessOption also accepts same-user clients across UAC levels.
    if ctypes.windll.shell32.IsUserAnAdmin():
        raise PermissionError("Start 3ds Max without administrator privileges to run Python from chat")
    if not isinstance(code, str) or not code.strip() or len(code) > 16000:
        raise ValueError("Expected a non-empty Python script (at most 16000 characters)")
    if not isinstance(ticket, str) or len(ticket) != 32 or uuid.UUID(hex=ticket).hex != ticket:
        raise ValueError("Invalid Python request")
    receipt = os.path.join(os.environ["LOCALAPPDATA"], "ArchiHelper", "MaxPython", ticket)
    try:
        with open(receipt, "r", encoding="ascii") as staged:
            grant = json.loads(staged.read(512))
    except FileNotFoundError:
        raise PermissionError("Missing or already consumed local Python request") from None
    digest = hashlib.sha256(code.encode("utf-8")).hexdigest()
    if grant["pid"] != PID or grant["expires"] <= time.time() * 1000 or grant["digest"] != digest:
        raise ValueError("Python request expired or changed")
    os.remove(receipt)
    program = compile(code, "<Archi Helper>", "exec")
    scope = {"__name__": "__main__", "pymxs": pymxs, "rt": rt}
    output = ScriptOutput()
    failure = None
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
        with pymxs.undo(True, "Archi Helper Python"):
            try:
                exec(program, scope)
            except BaseException as error:
                # pymxs consumes exceptions when it rolls back the undo block.
                failure = "{}: {}".format(type(error).__name__, error)
                raise RuntimeError(failure)
    if failure is not None:
        raise RuntimeError(failure)
    return {"ran_in": "max", "output": output.getvalue(), "truncated": output.truncated}


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
        # Node.rotation and matrix rotation use opposite quaternion conventions.
        angles = rt.quatToEuler(node.transform.rotationPart)
        return dict(describe(node), position=[p.x, p.y, p.z],
                    rotation={"x": angles.x, "y": angles.y, "z": angles.z},
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
        options["pos"] = rt.Point3(*vector(args.get("position", [0, 0, 0])))
        if name is not None:
            options["name"] = name
        with pymxs.undo(True, "Archi Helper"):
            return describe(shape(**options))
    if command == "transform_object":
        node = get_node(args)
        point = rt.Point3(*vector(args["position"])) if "position" in args else None
        angles = rt.EulerAngles(*vector(args["rotate"])) if "rotate" in args else None
        axes = args.get("coordinate_system", "world")
        if (point is None and angles is None) or axes not in ("world", "local"):
            raise ValueError("Specify a position or rotation, with world or local rotation axes")
        with pymxs.undo(True, "Archi Helper"):
            if angles is not None:
                rotate_node(node, angles, axes == "local")
            if point is not None:
                node.position = point
            return describe(node)
        raise RuntimeError("Transform failed and was rolled back")
    if command == "run_python":
        return run_python(args)
    if command == "undo_last":
        pymxs.run_undo()
        return {"undo_requested": True}
    raise ValueError("Operation unavailable in this session")


class Session(QtCore.QObject):
    def __init__(self, legacy=False):
        super().__init__(QtCore.QCoreApplication.instance())
        self.legacy = legacy
        self.server = QtNetwork.QLocalServer(self)
        self.server.setSocketOptions(QtNetwork.QLocalServer.UserAccessOption)
        self.server.newConnection.connect(self.accept)
        protocol = "v2" if legacy else "v3"
        if not self.server.listen("ArchiHelper-MaxSession-{}-{}".format(protocol, PID)):
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
            if self.legacy and (request["name"] == "run_python" or
                                request["name"] == "transform_object" and set(args) != {"handle", "position"}):
                raise ValueError("Operation unavailable in legacy session")
            response = {"result": dispatch(request["name"], args)}
        except Exception as error:
            response = {"isError": True, "error": str(error)[:512]}
        peer.write((json.dumps(response, ensure_ascii=True) + "\n").encode("ascii"))
        peer.disconnectFromServer()


# Running the script again in an open scene reuses its existing session.
if not getattr(builtins, "_archi_helper_max_session_v3", None):
    builtins._archi_helper_max_session_v3 = Session()
# Older Archi Helper clients can still use their original scene tools after an update.
if not getattr(builtins, "_archi_helper_max_session_v2", None):
    builtins._archi_helper_max_session_v2 = Session(legacy=True)
