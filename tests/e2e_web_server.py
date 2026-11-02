"""Temporary E2E-only local API server with synthetic Vault data."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import uvicorn

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from apps.api import create_app
from core import profile

vault = Path(tempfile.mkdtemp(prefix="personal-ai-profile-e2e-")) / "vault"
profile.init(str(vault))
profile.remember(str(vault), "回答先给结论。", "e2e-agent", "preference", "回答风格")
uvicorn.run(create_app(vault, token="e2e-token"), host="127.0.0.1", port=8766, log_level="warning")
