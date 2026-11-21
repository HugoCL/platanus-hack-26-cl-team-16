#!/usr/bin/env python3
"""Smoke test: start the dev server (scripts/dev.mjs, what `pnpm dev` runs), open the home page in
headless Chromium, add a number, then check the agent directory.

Run with `pnpm smoke`. It asserts the page renders, clicks `data-testid="add-number"` and waits
until the Convex-backed `data-testid="numbers"` list changes, so the Convex backend is exercised
end to end. Then it opens /directorio and waits for one data-testid="agent-card" per seed
card. It writes artifacts/smoke.png (also when the check fails) and the dev server log to
artifacts/dev.log, and prints the end of that log on failure.

The first run creates .venv, installs requirements-dev.txt and Chromium, then writes
.venv/.smoke-ready with the sha256 of requirements-dev.txt. Later runs skip that while the stamp
matches. `--bootstrap-only` does just that and exits (`--with-deps` also installs Chromium's system
libraries, Linux only: .capy/setup.json uses it). Set PORT to change the port. If the port is
already in use it stops, because that server may come from another checkout. Set SMOKE_REUSE=1 to
test the server already running there instead.

Stopping the server: scripts/dev.mjs runs in its own session and gets one SIGINT, which convex turns
into a clean stop of `next dev` and the local backend (see scripts/dev.mjs). SIGINT, SIGTERM or
SIGHUP sent to this script go through the same teardown, and further signals during it are
ignored so the fallback below always runs. smoke starts `node scripts/dev.mjs` directly instead of
`pnpm dev`: on Linux pnpm runs the script through `sh -c` (dash) and a SIGINT sent to pnpm never
reaches it. If the dev server is still alive after the grace period,
the whole process group is SIGKILLed, plus every process that was a descendant when the stop
began and is still the same process (`next dev` can sit in its own group and outlive the rest).
"""

import hashlib
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENV = ROOT / ".venv"
VENV_PYTHON = VENV / "bin" / "python"
REQUIREMENTS = ROOT / "requirements-dev.txt"
STAMP = VENV / ".smoke-ready"
ARTIFACTS = ROOT / "artifacts"
PORT = int(os.environ.get("PORT", "3000"))
URL = f"http://localhost:{PORT}"
DIRECTORY_PAGE_SIZE = 20
SEED_COUNT_SCRIPT = """
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(
  "export async function resolve(s, c, next) { try { return await next(s, c); }"
  + " catch (e) { if (s.startsWith('.') && !s.endsWith('.ts')) return next(s + '.ts', c); throw e; } }"
));
const { SEED_AGENTS } = await import("./shared/seedData.ts");
console.log(SEED_AGENTS.filter(({ card }) => card.status !== "draft").length);
"""


def port_open(port):
    try:
        with socket.create_connection(("localhost", port), timeout=1):
            return True
    except OSError:
        return False


def in_venv():
    return Path(sys.prefix).resolve() == VENV.resolve()


def requirements_hash():
    return hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()


def bootstrap_ready():
    try:
        return VENV_PYTHON.exists() and STAMP.read_text().strip() == requirements_hash()
    except OSError:
        return False


def bootstrap(with_deps=False):
    """Create .venv, install requirements-dev.txt and Chromium. Skipped while the stamp matches."""
    if bootstrap_ready() and not with_deps:
        print("smoke: .venv is up to date, skipping pip and Chromium install", flush=True)
        return
    if not VENV_PYTHON.exists():
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    subprocess.run(
        [str(VENV_PYTHON), "-m", "pip", "install", "-q", "-r", str(REQUIREMENTS)],
        check=True,
    )
    install = [str(VENV_PYTHON), "-m", "playwright", "install"]
    subprocess.run([*install, *(["--with-deps"] if with_deps else []), "chromium"], check=True)
    STAMP.write_text(requirements_hash() + "\n")


def add_number(page):
    """Click the add button and wait until the newest number is a different document.
    Returns (count before, count after, numbers shown)."""
    from playwright.sync_api import expect

    # The button only renders after the first Convex query has returned, so a visible button
    # means the browser reached the backend.
    add = page.get_by_test_id("add-number")
    add.wait_for(state="visible", timeout=60_000)
    numbers = page.get_by_test_id("numbers")
    latest = numbers.get_attribute("data-latest-id")
    count = int(numbers.get_attribute("data-count"))
    add.click()
    # data-latest-id is the _id of the newest document, so it changes even when the list is full
    # and the new number equals the one it pushes out.
    try:
        expect(numbers).not_to_have_attribute("data-latest-id", latest, timeout=15_000)
    except AssertionError:
        raise AssertionError(f"numbers did not change after adding one, still {numbers.inner_text()}")
    return count, int(numbers.get_attribute("data-count")), numbers.inner_text()


def listed_seed_cards():
    """Count the non-draft cards in SEED_AGENTS (shared/seedData.ts), read with Node's type
    stripping so the number never drifts from the seed."""
    out = subprocess.run(
        ["node", "--no-warnings", "--input-type=module", "-e", SEED_COUNT_SCRIPT],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    return int(out.stdout.strip())


def directory(page):
    """Open /directorio and wait until it lists every listed seed card, up to one page.
    Returns the number of cards shown."""
    from playwright.sync_api import expect

    expected = min(listed_seed_cards(), DIRECTORY_PAGE_SIZE)

    page.goto(f"{URL}/directorio", wait_until="networkidle", timeout=120_000)
    cards = page.get_by_test_id("agent-card")
    try:
        expect(cards).to_have_count(expected, timeout=30_000)
    except AssertionError:
        raise AssertionError(f"/directorio shows {cards.count()} cards, expected {expected}")
    return cards.count()


def check():
    from playwright.sync_api import sync_playwright

    ARTIFACTS.mkdir(exist_ok=True)
    page_errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.on("pageerror", lambda err: page_errors.append(str(err)))
            try:
                page.goto(URL, wait_until="networkidle", timeout=120_000)
                heading = page.locator("h1", has_text="Convex + Next.js + Clerk")
                heading.wait_for(state="visible", timeout=60_000)
                before, after, shown = add_number(page)
                listed = directory(page)
            finally:
                # Always keep the screenshot, and never let a failure here hide the real error.
                try:
                    page.screenshot(path=str(ARTIFACTS / "smoke.png"), full_page=True)
                except Exception as err:
                    print(f"smoke: could not save the screenshot: {err}")
        finally:
            browser.close()
    if page_errors:
        print("FAIL: uncaught page errors", *page_errors, sep="\n  ")
        return 1
    subprocess.run(
        ["pnpm", "test", "tests/convex/gate.test.ts",
         "tests/convex/roomAuthorization.test.ts"],
        cwd=ROOT, check=True, timeout=30,
    )
    print(
        f"PASS: {URL} rendered the template page and Convex stored a number"
        f" ({before} -> {after} shown: {shown}), /directorio listed {listed} cards,"
        " screenshot of /directorio at artifacts/smoke.png"
    )
    return 0


def print_log_tail(log, lines=40):
    """Show the end of the dev server log, where the real error usually is."""
    try:
        tail = log.read_text(errors="replace").splitlines()[-lines:]
    except OSError:
        return
    print(f"--- last {len(tail)} lines of {log.relative_to(ROOT)} ---", *tail, sep="\n")


def process_table():
    """{pid: (ppid, start time)} for every process. The start time tells a pid from a reused one."""
    table = {}
    try:
        out = subprocess.run(
            ["ps", "-axo", "pid=,ppid=,lstart="],
            capture_output=True,
            text=True,
            env={**os.environ, "LC_ALL": "C"},
        ).stdout
    except OSError:
        # No ps (slim images): the SIGINT and process group kill still run, only the safety net is lost.
        return table
    for line in out.splitlines():
        fields = line.split(None, 2)
        if len(fields) == 3 and fields[0].isdigit() and fields[1].isdigit():
            table[int(fields[0])] = (int(fields[1]), fields[2].strip())
    return table


def descendants(root_pid):
    """{pid: start time} of every process below root_pid, whatever process group it is in."""
    table = process_table()
    found = {}
    todo = [root_pid]
    while todo:
        parent = todo.pop()
        for pid, (ppid, started) in table.items():
            if ppid == parent and pid not in found:
                found[pid] = started
                todo.append(pid)
    return found


def stop_server(proc, grace=45):
    """SIGINT scripts/dev.mjs, which sends one SIGINT to convex, and
    convex stops `next dev` and the local backend. If that takes longer than grace, SIGKILL the
    process group and every process that was below the dev server when we started, if it is still the
    same process (`next dev` can be in its own group and survive with the port open)."""
    state["phase"] = "stopping"
    if proc.poll() is not None:
        return
    tree = descendants(proc.pid)
    proc.send_signal(signal.SIGINT)
    try:
        proc.wait(timeout=grace)
        return
    except subprocess.TimeoutExpired:
        pass
    print(f"smoke: the dev server ignored SIGINT for {grace}s, killing its process group")
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except OSError:
        pass
    now = process_table()
    for pid, started in tree.items():
        if pid in now and now[pid][1] == started:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    proc.wait()


def wait_for_server(proc, timeout=180):
    """Wait until the port accepts connections. False if the dev server exits first or time runs out."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        if port_open(PORT):
            return True
        time.sleep(0.5)
    return False


# "start": a signal is remembered until the dev server is running. "run": a signal raises SystemExit so
# the `finally` below stops the server. "stopping": signals are ignored, so a second Ctrl-C cannot
# skip the SIGKILL fallback in stop_server.
state = {"phase": "start", "pending": None}


def on_signal(signum, _frame):
    if state["phase"] == "stopping":
        return
    if state["phase"] == "start":
        state["pending"] = signum
        return
    state["phase"] = "stopping"
    raise SystemExit(128 + signum)


def run_check():
    try:
        return check()
    except Exception as err:
        print(f"FAIL: {type(err).__name__}: {err}")
        return 1


def launch():
    if port_open(PORT):
        if os.environ.get("SMOKE_REUSE") == "1":
            print(f"SMOKE_REUSE=1: testing the server already on port {PORT}")
            return run_check()
        print(
            f"FAIL: port {PORT} is already in use, possibly by another checkout. Stop that server,"
            f" set PORT to a free port, or set SMOKE_REUSE=1 to test the running server."
        )
        return 1
    ARTIFACTS.mkdir(exist_ok=True)
    log = ARTIFACTS / "dev.log"
    # Handlers go in before the server starts, so no signal can arrive while it runs unhandled.
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, on_signal)
    proc = None
    code = 1
    try:
        # Its own session, so a Ctrl-C at this terminal reaches only this script, which then stops
        # the server once. No stdin: scripts/dev.mjs must not depend on a terminal.
        with log.open("wb") as out:
            proc = subprocess.Popen(
                ["node", str(ROOT / "scripts" / "dev.mjs")],
                cwd=ROOT,
                env={**os.environ, "PORT": str(PORT)},
                stdin=subprocess.DEVNULL,
                stdout=out,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        state["phase"] = "run"
        if state["pending"] is not None:
            on_signal(state["pending"], None)
        if wait_for_server(proc):
            code = run_check()
        else:
            print(f"FAIL: the dev server did not open port {PORT} (exit code {proc.poll()})")
        if code != 0:
            print_log_tail(log)
        return code
    finally:
        if proc is not None:
            stop_server(proc)


def main():
    args = sys.argv[1:]
    if "--bootstrap-only" in args:
        bootstrap(with_deps="--with-deps" in args)
        sys.exit(0)
    if not in_venv():
        bootstrap()
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), __file__, *args])
    sys.exit(launch())


if __name__ == "__main__":
    main()
