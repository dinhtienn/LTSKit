#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CapCut TTS worker for LTSKit. JSON in via argv; JSON out on stdout."""
from __future__ import annotations

import json
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Dict, Optional

POLL_INTERVALS = (0.3, 0.5)
POLL_INTERVAL_STEADY = 1.0


def _out(obj: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _err_text(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"


def _is_shark(msg: str) -> bool:
    t = msg.lower()
    return (
        "shark" in t
        or "shark_block" in t
        or "risk control" in t
        or "device blocked" in t
        or ("block" in t and "403" in t)
    )


def _is_busy(msg: str) -> bool:
    t = msg.lower()
    return (
        "system busy" in t
        or "ret': '1014'" in t
        or 'ret": "1014"' in t
        or "ret': 1014" in t
        or (
            re.search(r"\b1014\b", t) is not None
            and ("busy" in t or "no task" in t)
        )
    )


def _is_network(msg: str) -> bool:
    t = msg.lower()
    return (
        "connection aborted" in t
        or "remotedisconnected" in t
        or "connection reset" in t
        or "connectionerror" in t
        or "read timed out" in t
        or "connecttimeout" in t
        or "max retries exceeded" in t
    )


def _random_device() -> Dict[str, str]:
    """Match upstream device.json.example / DEFAULT_DEVICE (Mac CapCut PC)."""
    import random

    def digits(n: int) -> str:
        s = "".join(str(random.randint(0, 9)) for _ in range(n))
        return s if s[0] != "0" else "7" + s[1:]

    did = digits(19)
    return {
        "aid": "359289",
        "app_name": "CapCut",
        "appvr": "8.7.0",
        "version_name": "8.7.0",
        "version_code": "8.7.0",
        "channel": "capcutpc_google",
        "device_platform": "mac",
        "device_type": "MacBookPro17,4",
        "device_brand": "MacBookPro17,4",
        "os_version": "15.7.4",
        "device_id": did,
        "iid": digits(19),
        "tdid": did,
        "region": "VN",
        "loc": "VN",
        "lan": "vi-VN",
        "pf": "3",
    }


def _write_device(path: Path, device: Dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(device, ensure_ascii=False, indent=2), encoding="utf-8")


def _ensure_device(path: Path) -> Dict[str, str]:
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("device_id") and data.get("iid") and data.get("tdid"):
                return data
        except Exception:
            pass
    device = _random_device()
    _write_device(path, device)
    return device


def _find_audio_url(obj: Any, depth: int = 0) -> Optional[str]:
    if depth > 12 or obj is None:
        return None
    if isinstance(obj, str):
        if obj.startswith("http") and re.search(r"\.(mp3|m4a|wav)(\?|$)", obj, re.I):
            return obj
        if obj.startswith("http") and (
            "audio" in obj.lower()
            or "tos-" in obj.lower()
            or "speech" in obj.lower()
            or "tiktokcdn" in obj.lower()
            or "capcut" in obj.lower()
        ):
            return obj
        return None
    if isinstance(obj, dict):
        for key in (
            "speech_url",
            "audio_url",
            "play_url",
            "download_url",
            "url",
            "audio",
            "speaker_url",
        ):
            if key in obj:
                found = _find_audio_url(obj[key], depth + 1)
                if found:
                    return found
        for v in obj.values():
            found = _find_audio_url(v, depth + 1)
            if found:
                return found
    if isinstance(obj, list):
        for item in obj:
            found = _find_audio_url(item, depth + 1)
            if found:
                return found
    return None


def _task_done(status: Optional[str]) -> bool:
    if not status:
        return False
    return status.lower() in ("success", "succeed", "succeeded", "done", "completed", "finish", "finished")


def _task_failed(status: Optional[str]) -> bool:
    if not status:
        return False
    return status.lower() in ("failed", "fail", "error")


def _generate_and_download(
    client: Any,
    text: str,
    voice_type: str,
    resource_id: str,
    out_path: Path,
    requests_mod: Any,
    timeout: float = 90.0,
) -> None:
    """
    Upstream SDK waits for status == 'success', but live CapCut API returns 'succeed'
    plus speech_url in payload — so we poll ourselves.
    """
    create_res = client.create_tts_task(
        texts=text, voice=voice_type, resource_id=resource_id, rate="1.0"
    )
    ret = str((create_res or {}).get("ret") or "")
    if ret and ret not in ("0", "200"):
        raise RuntimeError(
            f"CapCut API ret={ret}: {json.dumps(create_res, ensure_ascii=False)[:500]}"
        )
    tasks = ((create_res.get("data") or {}).get("tasks")) or []
    if not tasks:
        raise RuntimeError(
            f"No task returned from API: {json.dumps(create_res, ensure_ascii=False)[:500]}"
        )
    task_id = tasks[0]["id"]
    token = tasks[0]["token"]

    # create response may already be done (rare)
    url = _find_audio_url(create_res)
    if url:
        _download_url(requests_mod, url, out_path)
        return

    start = time.time()
    last_query: Dict[str, Any] = {}
    poll_count = 0
    while time.time() - start < timeout:
        last_query = client.query_tts_task(task_id, token)
        q_tasks = ((last_query.get("data") or {}).get("tasks")) or []
        if q_tasks:
            status = q_tasks[0].get("status")
            if _task_done(status):
                url = _find_audio_url(last_query)
                if not url:
                    pl = q_tasks[0].get("payload")
                    if isinstance(pl, str):
                        try:
                            pl = json.loads(pl)
                        except Exception:
                            pl = {}
                    url = _find_audio_url(pl)
                if not url:
                    raise RuntimeError(
                        f"Task xong nhưng không thấy speech_url: {json.dumps(last_query)[:400]}"
                    )
                _download_url(requests_mod, url, out_path)
                return
            if _task_failed(status):
                raise RuntimeError(
                    f"TTS task failed: {json.dumps(last_query, ensure_ascii=False)[:500]}"
                )
        interval = (
            POLL_INTERVALS[poll_count]
            if poll_count < len(POLL_INTERVALS)
            else POLL_INTERVAL_STEADY
        )
        poll_count += 1
        time.sleep(interval)
    raise RuntimeError(
        f"TTS Task timed out after {timeout} seconds "
        f"(last={json.dumps(last_query, ensure_ascii=False)[:300]})"
    )


def _download_url(requests_mod: Any, url: str, out_path: Path) -> None:
    resp = requests_mod.get(url, timeout=60)
    resp.raise_for_status()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(resp.content)
    if out_path.stat().st_size < 64:
        raise RuntimeError("File audio tải về quá nhỏ")


def cmd_status() -> Dict[str, Any]:
    info: Dict[str, Any] = {
        "ok": False,
        "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
    }
    if sys.version_info < (3, 9):
        info["error"] = "Cần Python 3.9+"
        return info
    try:
        import capcut_tts_api  # type: ignore

        info["ok"] = True
        info["package"] = getattr(capcut_tts_api, "__version__", "installed")
        return info
    except Exception as exc:
        info["error"] = f"Chưa cài capcut_tts_api: {_err_text(exc)}"
        return info


def cmd_synth(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = (payload.get("text") or "").strip()
    voice = payload.get("voice") or "BV421_vivn_streaming"
    device_path = Path(payload["devicePath"])
    out_path = Path(payload["outPath"])
    catalog = payload.get("catalogPath")
    catalog_path = Path(catalog) if catalog else None

    if not text:
        return {"ok": False, "error": "Văn bản trống", "code": "io"}

    try:
        from capcut_tts_api import CapCutClient  # type: ignore
        import requests
    except Exception as exc:
        return {"ok": False, "error": f"Thiếu SDK: {_err_text(exc)}", "code": "api"}

    # pip package does not ship Voice.json — resolve with bundled catalog when provided
    try:
        probe = CapCutClient()
        voice_type, resource_id = probe.resolve_voice(
            voice=voice,
            catalog_path=str(catalog_path) if catalog_path and catalog_path.is_file() else None,
        )
    except Exception as exc:
        return {
            "ok": False,
            "error": f"Không resolve được giọng: {_err_text(exc)}",
            "code": "api",
        }

    try:
        client = CapCutClient(device=str(device_path))
        # Do NOT use generate_speech(wait=True): SDK only accepts status
        # "success" but live API returns "succeed" + speech_url.
        _generate_and_download(
            client,
            text,
            voice_type,
            resource_id,
            out_path,
            requests,
            timeout=90.0,
        )
        return {"ok": True, "outPath": str(out_path)}
    except Exception as exc:
        message = _err_text(exc)
        if _is_shark(message):
            return {"ok": False, "error": message, "code": "shark"}
        if _is_busy(message):
            return {
                "ok": False,
                "error": "CapCut đang bận (1014 system busy).",
                "code": "busy",
            }
        if _is_network(message):
            return {
                "ok": False,
                "error": "Mất kết nối tới CapCut.",
                "code": "network",
            }
        return {
            "ok": False,
            "error": message,
            "code": "api",
        }


class _SynthSession:
    """Holds the SDK import and resolved voice for the lifetime of a serve process.

    The one-shot `synth` command re-does this work on every cue; serve mode
    does it once. Voice and device path are stable for a whole job, so the
    session rebuilds only when they change.
    """

    def __init__(self) -> None:
        self._client_cls: Any = None
        self._requests: Any = None
        self._voice_key: Optional[str] = None
        self._voice_type: str = ""
        self._resource_id: str = ""
        self._device_key: Optional[str] = None
        self._client: Any = None

    def _load_sdk(self) -> None:
        if self._client_cls is not None:
            return
        from capcut_tts_api import CapCutClient  # type: ignore
        import requests

        self._client_cls = CapCutClient
        self._requests = requests

    def _resolve(self, voice: str, catalog_path: Optional[Path]) -> None:
        key = f"{voice}|{catalog_path}"
        if self._voice_key == key:
            return
        probe = self._client_cls()
        self._voice_type, self._resource_id = probe.resolve_voice(
            voice=voice,
            catalog_path=str(catalog_path)
            if catalog_path and catalog_path.is_file()
            else None,
        )
        self._voice_key = key

    def _client_for(self, device_path: Path) -> Any:
        key = str(device_path)
        if self._device_key != key or self._client is None:
            self._client = self._client_cls(device=key)
            self._device_key = key
        return self._client

    def reset_device(self) -> None:
        self._device_key = None
        self._client = None

    def synth(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        text = (payload.get("text") or "").strip()
        voice = payload.get("voice") or "BV421_vivn_streaming"
        device_path = Path(payload["devicePath"])
        out_path = Path(payload["outPath"])
        catalog = payload.get("catalogPath")
        catalog_path = Path(catalog) if catalog else None

        if not text:
            return {"ok": False, "error": "Văn bản trống", "code": "io"}

        try:
            self._load_sdk()
        except Exception as exc:
            return {"ok": False, "error": f"Thiếu SDK: {_err_text(exc)}", "code": "api"}

        try:
            self._resolve(voice, catalog_path)
        except Exception as exc:
            return {
                "ok": False,
                "error": f"Không resolve được giọng: {_err_text(exc)}",
                "code": "api",
            }

        try:
            client = self._client_for(device_path)
            _generate_and_download(
                client,
                text,
                self._voice_type,
                self._resource_id,
                out_path,
                self._requests,
                timeout=90.0,
            )
            return {"ok": True, "outPath": str(out_path)}
        except Exception as exc:
            message = _err_text(exc)
            if _is_shark(message):
                self.reset_device()
                return {"ok": False, "error": message, "code": "shark"}
            if _is_busy(message):
                return {
                    "ok": False,
                    "error": "CapCut đang bận (1014 system busy).",
                    "code": "busy",
                }
            if _is_network(message):
                return {
                    "ok": False,
                    "error": "Mất kết nối tới CapCut.",
                    "code": "network",
                }
            return {"ok": False, "error": message, "code": "api"}


def _handle_request(session: _SynthSession, line: str) -> Optional[Dict[str, Any]]:
    """Return the response for one request line, or None to stop serving."""
    try:
        payload = json.loads(line)
    except Exception as exc:
        return {"ok": False, "error": f"Bad request: {_err_text(exc)}", "code": "api"}
    cmd = payload.get("cmd")
    if cmd == "shutdown":
        return None
    if cmd == "synth":
        return session.synth(payload)
    return {"ok": False, "error": f"unknown command: {cmd}", "code": "api"}


def cmd_serve() -> int:
    session = _SynthSession()
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            response = _handle_request(session, line)
        except Exception as exc:
            response = {"ok": False, "error": _err_text(exc), "code": "api"}
        if response is None:
            return 0
        _out(response)
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    if hasattr(sys.stdin, "reconfigure"):
        try:
            sys.stdin.reconfigure(encoding="utf-8")
        except Exception:
            pass
    if len(sys.argv) < 2:
        _out({"ok": False, "error": "missing command"})
        return 2
    cmd = sys.argv[1]
    try:
        if cmd == "status":
            _out(cmd_status())
            return 0
        if cmd == "synth":
            raw = sys.argv[2] if len(sys.argv) > 2 else "{}"
            payload = json.loads(raw)
            _out(cmd_synth(payload))
            return 0
        if cmd == "serve":
            return cmd_serve()
        _out({"ok": False, "error": f"unknown command: {cmd}"})
        return 2
    except Exception as exc:
        _out(
            {
                "ok": False,
                "error": _err_text(exc),
                "trace": traceback.format_exc()[-500:],
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
