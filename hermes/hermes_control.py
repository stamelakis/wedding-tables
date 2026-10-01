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

YOUR ACTION CAN TAKE ARGUMENTS, or none at all — declare what you want and the
rest is dropped for you:

    def efka_debt():                        # takes nothing, gets nothing
        ...

    def phone_student(value: str = ""):     # "πάρε τηλέφωνο τον Γιώργο"
        ...                                 # value = "Γιώργο"

    def create_wedding(value: str = "", task: str = ""):
        ...                                 # task = his whole sentence, if you
                                            # need more than one word out of it

`value` is the one thing he named; `task` is everything he said. Ask for
neither, either, or both. Nothing you don't declare will ever be passed.

Return a string and Hermes reads it back to you; return None and it just says
the action is done. Raise, and it reports the error instead of pretending.

WHY NOT A COMMAND-LINE FLAG: your app is already open. `app.py --start-auto`
would launch a second copy, not press the button in the one on your screen.
This talks to the running instance.

IF REGISTRATION FAILS it writes `<name>.error` beside the announcement, with
the exception, and re-raises. Catch it if your app must survive without
Hermes — but do not swallow it silently: Hermes reads those files and reports
them, which is the difference between "broken" and "apparently just closed".

WHY THIS IS SAFE: the server binds 127.0.0.1 only, so nothing outside this
machine can reach it, and it will not start on any other address. Every
request must carry a token that is written to a file only your account can
read. It runs only the functions you list — there is no eval, no shell, and no
way to name a function you didn't expose.

AUTOSTART: by default your app publishes how to restart itself, so Hermes can
open it when he asks it something while it is closed. Pass autostart=False if
that would be wrong for your program — one that pops a login prompt, say, or
one that costs money to run.

TKINTER: pass your root window and callbacks are marshalled onto the UI thread
with `after()`, because touching Tk widgets from the HTTP thread will
eventually crash:

    control = expose("My App", ACTIONS, tk_root=root)
"""

from __future__ import annotations

# Bump when this file changes. Agents copy it into their own repos, and a copy
# ten minutes stale carried two bugs the owner had already fixed — with no way
# to tell. Hermes reports this back, so a stale copy is visible rather than
# mysterious.
VERSION = "2026-10-01"

import atexit
import inspect
import json
import os
import queue
import secrets
import socket
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Callable, Optional

APPS_DIR = (
    Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    / "Hermes"
    / "apps"
)


# How often a registered app re-checks that the file still names it and that
# its own port still answers. Cheap, and it catches the one failure nothing
# else reports.
SELFCHECK_SECONDS = 180


def _answers(port: int) -> bool:
    """Is something serving /actions on this port right now?"""
    if not port:
        return False
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=1.0):
            return True
    except OSError:
        return False


def _safe_name(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "-" for c in name).strip("-")


def _launch_command() -> list:
    """How to start this program again, from its own point of view.

    Andreas has nine programs wired and keeps one or two open, so most
    questions used to fail purely because the app was closed. Hermes can start
    an installed program from the Start Menu, but a headless shim or a web-app
    bridge isn't in there — and only the process itself knows how it was run.
    Publishing it means anything that has registered once can be woken.
    """
    if getattr(sys, "frozen", False):          # PyInstaller and friends
        return [sys.executable]
    script = Path(sys.argv[0]).resolve()
    if script.is_file():
        return [sys.executable, str(script), *sys.argv[1:]]
    return []


class Control:
    def __init__(self, name: str, actions: dict, tk_root=None,
                 autostart: bool = True, selfcheck: bool = True):
        self.name = name
        self.tk_root = tk_root
        # Set autostart=False if this must never be started unattended — a
        # program that pops a login window, or one that costs money to run.
        self.autostart = autostart
        self.actions = {}
        for key, value in actions.items():
            fn, describe = value if isinstance(value, tuple) else (value, key)
            self.actions[key] = (fn, describe)

        self.token = secrets.token_urlsafe(24)
        self.selfcheck = selfcheck
        self._port = 0
        self._server: Optional[HTTPServer] = None
        self._file = APPS_DIR / f"{_safe_name(name)}.json"

    # -- running a callback on the right thread --------------------------
    @staticmethod
    def _accepted(fn: Callable, params: dict) -> dict:
        """Only the arguments this callback actually takes.

        Hermes sends `value` (a spoken argument) and `task` (the whole
        sentence) on every call. Passing them blindly broke every
        zero-argument action at once — `efka_debt() got an unexpected keyword
        argument 'value'`. Filtering here means an action declares what it
        wants and ignores the rest, and no app has to defend itself.
        """
        if not params:
            return {}
        try:
            signature = inspect.signature(fn)
        except (TypeError, ValueError):
            return {}
        if any(p.kind is p.VAR_KEYWORD for p in signature.parameters.values()):
            return dict(params)
        return {k: v for k, v in params.items() if k in signature.parameters}

    def _invoke(self, fn: Callable, params: dict):
        params = self._accepted(fn, params)
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

    def _report_failure(self, exc: BaseException) -> None:
        """Leave a note saying registration failed, and why.

        Notes ran for weeks looking exactly like an app that was closed. Its
        runtime was missing a module, the server threw the instant it started,
        and the whole thing sat inside a catch-all — so the only symptom was
        absence. Hermes reads these files and reports them, which turns a
        silent permanent failure into one line of output.

        Never raises: a program must not die because it couldn't tell Hermes
        it was there.
        """
        try:
            APPS_DIR.mkdir(parents=True, exist_ok=True)
            (APPS_DIR / f"{_safe_name(self.name)}.error").write_text(
                json.dumps({
                    "name": self.name,
                    "error": f"{exc.__class__.__name__}: {exc}",
                    "pid": os.getpid(),
                    "control_version": VERSION,
                    "at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
                }, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception:  # noqa: BLE001 — reporting a failure must not fail
            pass

    def start(self) -> "Control":
        try:
            return self._start()
        except Exception as exc:  # noqa: BLE001
            self._report_failure(exc)
            raise

    def _start(self) -> "Control":
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
                # Read the body BEFORE deciding, even when rejecting. Replying
                # to a POST without draining it makes the server close on
                # unread bytes, which the client sees as a connection abort
                # rather than a 401 — Academic Researcher Agent measured 40
                # aborts in 250 unauthenticated calls chasing exactly this.
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                    raw = self.rfile.read(length) if length > 0 else b"{}"
                except (ValueError, OSError):
                    raw = b"{}"

                if self.headers.get("X-Hermes-Token") != control.token:
                    return self._reply(401, {"ok": False, "message": "bad token"})
                try:
                    payload = json.loads(raw or b"{}")
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
        port = self._port = self._server.server_address[1]
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

        APPS_DIR.mkdir(parents=True, exist_ok=True)
        # A previous run's failure note is stale the moment we succeed.
        (APPS_DIR / f"{_safe_name(self.name)}.error").unlink(missing_ok=True)
        self._file.write_text(
            json.dumps(
                {
                    "name": self.name,
                    "port": port,
                    "token": self.token,
                    "pid": os.getpid(),
                    "control_version": VERSION,
                    "launch": _launch_command() if self.autostart else [],
                    "cwd": os.getcwd(),
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
        # Read it back. Two instances racing, or a crash mid-write, can leave
        # the file naming a port that is dead while this one is serving
        # happily — Hermes then probes the corpse and reports "not answering"
        # about a healthy app. Wedding Invitation Agent hit exactly that and
        # asked for the fix to live here, for everyone.
        self._verify_registration()
        if self.selfcheck:
            thread = threading.Thread(target=self._watch, daemon=True)
            thread.start()

        atexit.register(self.stop)
        return self

    # -- keeping the announcement honest ---------------------------------
    def _announcement(self) -> dict:
        return {
            "name": self.name,
            "port": self._port,
            "token": self.token,
            "pid": os.getpid(),
            "control_version": VERSION,
            "launch": _launch_command() if self.autostart else [],
            "cwd": os.getcwd(),
            "actions": [
                {"name": k, "describe": d} for k, (_fn, d) in self.actions.items()
            ],
        }

    def _verify_registration(self) -> bool:
        """Make sure the file on disk still names THIS instance.

        Returns True if it did or was repaired, False if another live process
        legitimately owns the name and we should stand down.
        """
        try:
            on_disk = json.loads(self._file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            on_disk = {}

        if on_disk.get("port") == self._port and on_disk.get("pid") == os.getpid():
            return True

        # Another process that is actually alive and answering as this app
        # owns the name — don't fight it.
        other = on_disk.get("port")
        if other and other != self._port and on_disk.get("pid") != os.getpid():
            if _answers(other):
                return False

        try:
            self._file.write_text(
                json.dumps(self._announcement(), indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError:
            return True
        return True

    def _watch(self) -> None:
        """Every few minutes: is the file still ours, and are we still up?

        "Published but not answering" is the failure shape all over this
        project, and until now nothing reported it — a registration only ever
        recorded that start() threw, never that a healthy-looking app had
        gone quiet.
        """
        reported = False
        while self._server is not None:
            time.sleep(SELFCHECK_SECONDS)
            if self._server is None:
                return
            if not _answers(self._port):
                if not reported:
                    self._report_failure(
                        RuntimeError(
                            f"registered on port {self._port} but it stopped "
                            "answering /actions"
                        )
                    )
                    reported = True
                continue
            if reported:
                try:
                    (APPS_DIR / f"{_safe_name(self.name)}.error").unlink(missing_ok=True)
                except OSError:
                    pass
                reported = False
            self._verify_registration()

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


def expose(name: str, actions: dict, tk_root=None, autostart: bool = True,
           selfcheck: bool = True) -> Control:
    """Publish `actions` so Hermes can run them. Returns the Control.

    autostart=True (the default) lets Hermes restart this program when he asks
    it something while it is closed. Pass False for anything that must not be
    started unattended.
    """
    return Control(name, actions, tk_root=tk_root, autostart=autostart,
                   selfcheck=selfcheck).start()


def is_port_free(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) != 0
