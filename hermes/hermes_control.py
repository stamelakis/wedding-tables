"""Make an app controllable by Hermes. Copy this file next to your app.

Two lines in your program and Hermes can run anything it can do:

    from hermes_control import expose

    control = expose("FB Posting Workstation", {
        "start_auto":  (start_auto,  "Start the auto poster"),
        "stop_auto":   (stop_auto,   "Stop the auto poster"),
        "status":      (status,      "How many posts are queued"),
    })

Each value is (function, description). The description is what Hermes matches
your speech against, so write it the way you'd say it out loud.

Return a string and Hermes reads it back to you; return None and it just says
the action is done. Raise, and it reports the error instead of pretending.

WHY NOT A COMMAND-LINE FLAG: your app is already open. `app.py --start-auto`
would launch a second copy, not press the button in the one on your screen.
This talks to the running instance.

WHY THIS IS SAFE: the server binds 127.0.0.1 only, so nothing outside this
machine can reach it, and it will not start on any other address. Every
request must carry a token that is written to a file only your account can
read. It runs only the functions you list — there is no eval, no shell, and no
way to name a function you didn't expose.

TKINTER: pass your root window and callbacks are marshalled onto the UI thread
with `after()`, because touching Tk widgets from the HTTP thread will
eventually crash:

    control = expose("My App", ACTIONS, tk_root=root)
"""

from __future__ import annotations

import atexit
import json
import os
import queue
import secrets
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Callable, Optional

APPS_DIR = (
    Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    / "Hermes"
    / "apps"
)


def _safe_name(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "-" for c in name).strip("-")


class Control:
    def __init__(self, name: str, actions: dict, tk_root=None):
        self.name = name
        self.tk_root = tk_root
        self.actions = {}
        for key, value in actions.items():
            fn, describe = value if isinstance(value, tuple) else (value, key)
            self.actions[key] = (fn, describe)

        self.token = secrets.token_urlsafe(24)
        self._server: Optional[HTTPServer] = None
        self._file = APPS_DIR / f"{_safe_name(name)}.json"

    # -- running a callback on the right thread --------------------------
    def _invoke(self, fn: Callable, params: dict):
        if self.tk_root is None:
            return fn(**params) if params else fn()

        # Tk is not thread-safe: hop onto the UI thread and wait for the result.
        box: "queue.Queue" = queue.Queue(maxsize=1)

        def run():
            try:
                box.put(("ok", fn(**params) if params else fn()))
            except Exception as exc:  # noqa: BLE001 — reported, not swallowed
                box.put(("error", exc))

        self.tk_root.after(0, run)
        status, value = box.get(timeout=30)
        if status == "error":
            raise value
        return value

    def start(self) -> "Control":
        control = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_a):  # keep the app's console clean
                pass

            def _reply(self, code: int, body: dict):
                raw = json.dumps(body).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler's naming
                if self.path.rstrip("/") != "/actions":
                    return self._reply(404, {"ok": False, "message": "no such path"})
                self._reply(200, {
                    "ok": True,
                    "name": control.name,
                    "actions": [
                        {"name": k, "describe": d}
                        for k, (_fn, d) in control.actions.items()
                    ],
                })

            def do_POST(self):  # noqa: N802
                if self.path.rstrip("/") != "/do":
                    return self._reply(404, {"ok": False, "message": "no such path"})
                if self.headers.get("X-Hermes-Token") != control.token:
                    return self._reply(401, {"ok": False, "message": "bad token"})
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                    payload = json.loads(self.rfile.read(length) or b"{}")
                    name = str(payload.get("action", ""))
                    params = payload.get("params") or {}
                except (ValueError, TypeError):
                    return self._reply(400, {"ok": False, "message": "bad request"})

                entry = control.actions.get(name)
                if entry is None:
                    return self._reply(404, {"ok": False, "message": f"no action {name}"})
                try:
                    result = control._invoke(entry[0], params)
                except Exception as exc:  # noqa: BLE001 — tell the truth upstream
                    return self._reply(
                        200, {"ok": False, "message": f"{name} failed: {exc}"}
                    )
                return self._reply(
                    200, {"ok": True, "message": str(result) if result else f"{name} done."}
                )

        # Port 0 lets the OS pick a free one; the file tells Hermes which.
        self._server = HTTPServer(("127.0.0.1", 0), Handler)
        port = self._server.server_address[1]
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

        APPS_DIR.mkdir(parents=True, exist_ok=True)
        self._file.write_text(
            json.dumps(
                {
                    "name": self.name,
                    "port": port,
                    "token": self.token,
                    "pid": os.getpid(),
                    "actions": [
                        {"name": k, "describe": d}
                        for k, (_fn, d) in self.actions.items()
                    ],
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        atexit.register(self.stop)
        return self

    def stop(self) -> None:
        try:
            # An older window must not remove a newer window's announcement.
            if json.loads(self._file.read_text(encoding="utf-8")).get("token") == self.token:
                self._file.unlink(missing_ok=True)
        except (OSError, ValueError):
            pass
        if self._server is not None:
            server = self._server
            self._server = None
            # An HTTP request can be waiting for Tk while Tk closes the app.
            # Never join that request from the UI thread.
            def shutdown():
                server.shutdown()
                server.server_close()
            threading.Thread(target=shutdown, daemon=True).start()


def expose(name: str, actions: dict, tk_root=None) -> Control:
    """Publish `actions` so Hermes can run them. Returns the Control."""
    return Control(name, actions, tk_root=tk_root).start()


def is_port_free(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) != 0
