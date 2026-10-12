"""Persist Agent-only model configuration without exposing API keys in responses."""
from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path


def validate_gemini_keys(keys: list[str]) -> list[str]:
    if not 1 <= len(keys) <= 20:
        raise ValueError("Enter 1 to 20 Gemini API keys")
    clean = []
    for key in keys:
        if not isinstance(key, str) or not 1 <= len(key) <= 512 or not re.fullmatch(r"[\x21-\x7e]+", key) or "," in key:
            raise ValueError("Paste Gemini API keys without spaces, quotes or labels")
        if key not in clean:
            clean.append(key)
    return clean


def save_gemini_config(keys: list[str], model: str) -> None:
    path = Path(os.getenv("AGENT_CONFIG_FILE", Path(__file__).resolve().parents[2] / ".env")).resolve()
    if not path.is_file():
        raise RuntimeError("Local Agent .env file is missing")
    text = path.read_text(encoding="utf-8-sig")
    settings = {"LLM_PROVIDER": "gemini", "GEMINI_MODEL": model, "GEMINI_API_KEYS": ",".join(keys)}
    for name, value in settings.items():
        pattern = re.compile(rf"(?m)^{name}=[^\r\n]*")
        replacement = f"{name}={value}"
        text, count = pattern.subn(lambda _: replacement, text)
        if not count:
            text = text.rstrip("\r\n") + "\n" + replacement + "\n"
    descriptor, temporary = tempfile.mkstemp(prefix=".agent-config-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
        os.chmod(temporary, path.stat().st_mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
