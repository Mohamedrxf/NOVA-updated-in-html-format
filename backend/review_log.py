"""
JSONL-based logging for NOVA backend.

Three separate log files (all in backend/logs/):

  ai_diagnosis_log.jsonl     — every diagnose request + rule findings + raw LLM output
  reviews.jsonl              — every human review decision (all statuses)
  responsible_ai_log.jsonl   — subset: EDITED or REJECTED decisions only

All writes are append-only. Each line is a valid JSON object.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)

_LOGS_DIR = Path(__file__).resolve().parent / "logs"
_LOGS_DIR.mkdir(parents=True, exist_ok=True)

_DIAG_LOG    = _LOGS_DIR / "ai_diagnosis_log.jsonl"
_REVIEW_LOG  = _LOGS_DIR / "reviews.jsonl"
_RAI_LOG     = _LOGS_DIR / "responsible_ai_log.jsonl"


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _append(path: Path, entry: Dict[str, Any]) -> None:
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        logger.error("Failed to write log %s: %s", path.name, e)


# ── Public API ────────────────────────────────────────────────────────────────

def log_diagnosis(
    *,
    case_id: str,
    request_payload: Dict[str, Any],
    rule_findings: list,
    llm_raw_output: Any,
    final_diagnosis_state: str,
    llm_assisted: bool,
) -> None:
    """Log every AI diagnosis attempt, including raw LLM output."""
    entry = {
        "timestamp": _now_iso(),
        "case_id": case_id,
        "llm_assisted": llm_assisted,
        "final_diagnosis_state": final_diagnosis_state,
        "rule_findings": [
            {"check": f.check, "status": f.status, "message": f.message}
            for f in rule_findings
        ],
        "llm_raw_output": llm_raw_output,
        # Preserve raw evidence (truncated to 2000 chars for storage)
        "show_outputs_excerpt": str(
            request_payload.get("show_command_outputs", {}).get("raw", "")
        )[:2000],
        "topology_note": request_payload.get("topology_note", ""),
        "symptom": request_payload.get("symptom", ""),
    }
    _append(_DIAG_LOG, entry)


def log_review(entry: Dict[str, Any]) -> None:
    """Log every human review decision to reviews.jsonl."""
    if "timestamp" not in entry or not entry["timestamp"]:
        entry = {**entry, "timestamp": _now_iso()}
    _append(_REVIEW_LOG, entry)


def log_responsible_ai(entry: Dict[str, Any]) -> None:
    """
    Log to responsible_ai_log.jsonl when decision is EDITED or REJECTED.
    Preserves the original AI output alongside the human correction.
    """
    if "timestamp" not in entry or not entry["timestamp"]:
        entry = {**entry, "timestamp": _now_iso()}
    _append(_RAI_LOG, entry)
