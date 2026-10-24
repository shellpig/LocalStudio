"""Best-effort progress snapshots; video/results remain authoritative."""
import json
import logging
import time


def write_progress(path, state):
    temporary = path.with_suffix(".tmp")
    for attempt in range(4):
        try:
            temporary.write_text(json.dumps(state), encoding="utf-8")
            temporary.replace(path)
            return True
        except PermissionError as error:
            if attempt == 3:
                logging.warning("VOSR progress update skipped because the file is busy: %s", error)
                return False
            time.sleep(0.01 * (attempt + 1))


def read_progress(path, previous=None):
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(state, dict):
            return state
    except (PermissionError, FileNotFoundError, json.JSONDecodeError):
        pass
    return previous if previous is not None else {"phase": "waiting"}
