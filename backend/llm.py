"""
OpenRouter LLM adapter for NOVA backend.

Calls the OpenRouter chat completion API with a structured, evidence-
constrained system prompt and returns a parsed diagnosis dict.

Graceful fallback: if OPENROUTER_API_KEY is absent OR the API call fails
for any reason, `call_llm()` returns None and the caller falls back to a
rule-checker-only response with llm_assisted=False.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv

from pathlib import Path
from dotenv import load_dotenv

# Ensure backend/.env or root .env is loaded regardless of working directory
_backend_dir = Path(__file__).parent.resolve()
_backend_env = _backend_dir / ".env"
_root_env = _backend_dir.parent / ".env"

if _backend_env.exists():
    load_dotenv(_backend_env, override=True)
elif _root_env.exists():
    load_dotenv(_root_env, override=True)
else:
    load_dotenv(override=True)

logger = logging.getLogger(__name__)

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
_TIMEOUT: float = 30.0


def _get_api_key() -> str:
    return (os.getenv("OPENROUTER_API_KEY") or "").strip()


def _get_model() -> str:
    return (os.getenv("OPENROUTER_MODEL") or "openai/gpt-4o-mini").strip()


# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a Cisco network troubleshooting AI operating under strict evidence constraints.

You receive three inputs:
1. RULE CHECKER FINDINGS — deterministic PASS/FAIL/WARN results from a structured parser
2. RAW CLI EVIDENCE — Cisco show-command outputs, ipconfig, ping results
3. SYMPTOM + TOPOLOGY NOTE — human-provided context

Your task: produce a structured network diagnosis as a single JSON object.

EVIDENCE CONSTRAINT: You may ONLY reason from the provided CLI evidence and rule findings.
Do NOT guess, infer beyond what the evidence supports, or invent information not present.

OUTPUT FORMAT: Return ONLY a valid JSON object. No markdown, no code fences, no explanation text outside the JSON.

REQUIRED JSON SCHEMA:
{
  "diagnosis_state": "CONFIRMED | PROBABLE | INSUFFICIENT_EVIDENCE",
  "confidence": "High (Direct Evidence) | Medium (Inferred) | Low (Insufficient Evidence)",
  "suspected_root_cause": "Concise root cause statement (or 'Insufficient CLI Evidence' if unknown)",
  "osi_layer": "Layer 1 — Physical | Layer 2 — Data Link | Layer 3 — Network | Layer 4 — Transport | Unknown",
  "supporting_evidence": [
    {
      "evidence_type": "DIRECT_EVIDENCE | INFERRED_EVIDENCE",
      "description": "What this specific evidence shows",
      "source": "Exact CLI source identifier (e.g. SW1#show vlan brief)"
    }
  ],
  "missing_evidence": ["List of CLI outputs that would help (empty if CONFIRMED)"],
  "recommended_next_command": "Single most useful Cisco CLI command to run next",
  "recommended_fix": "Specific Cisco IOS CLI commands to apply in Packet Tracer. Use correct IOS syntax.",
  "verification_steps": "What the human engineer must manually do and check in Packet Tracer to verify the fix.",
  "required_next_evidence": ["Only include if INSUFFICIENT_EVIDENCE: specific show commands needed"],
  "reason": "Only include if INSUFFICIENT_EVIDENCE: why current evidence cannot support a diagnosis",
  "why": "Only include if INSUFFICIENT_EVIDENCE: why those specific commands would resolve the ambiguity"
}

DIAGNOSIS RULES:
- CONFIRMED: The root cause is directly proven by comparing structured values in the CLI output (e.g. gateway IP outside subnet, VLAN mismatch confirmed by show vlan brief). Rule checker FAIL findings typically warrant CONFIRMED.
- PROBABLE: You have strong circumstantial evidence but cannot directly prove the root cause from this CLI output alone.
- INSUFFICIENT_EVIDENCE: You cannot determine the root cause without more CLI data. Do NOT guess.
  - When INSUFFICIENT_EVIDENCE: set suspected_root_cause to "Insufficient CLI Evidence"
  - Populate reason, why, and required_next_evidence
  - Do not populate recommended_fix (leave as empty string)

IMPORTANT:
- Rule checker FAIL findings are high-confidence direct evidence. Prioritise them for CONFIRMED diagnoses.
- Rule checker WARN findings are circumstantial. Use as supporting context for PROBABLE.
- recommended_fix must be specific Cisco IOS commands with correct syntax, not generic advice.
- verification_steps describes what the HUMAN must do manually in Packet Tracer. NEVER claim the AI verifies automatically. The AI only recommends; the human applies and verifies.
- supporting_evidence sources must be exact CLI identifiers seen in the evidence (e.g. "R1#show ip interface brief").
- Do not add fields not in the schema."""


def _format_rule_findings(findings: List[Any]) -> str:
    """Format rule checker findings for inclusion in the LLM prompt."""
    if not findings:
        return "No rule checker findings available."
    lines = ["RULE CHECKER FINDINGS (deterministic — from structural evidence parsing):"]
    for f in findings:
        lines.append(f"  [{f.status}] {f.check}: {f.message}")
    return "\n".join(lines)


def _build_user_message(
    show_outputs: str,
    topology_note: str,
    symptom: str,
    rule_findings: List[Any],
) -> str:
    parts = []
    if symptom:
        parts.append(f"SYMPTOM:\n{symptom}")
    if topology_note:
        parts.append(f"TOPOLOGY NOTE:\n{topology_note}")
    parts.append(_format_rule_findings(rule_findings))
    parts.append(f"RAW CLI EVIDENCE:\n{show_outputs or '(no CLI output provided)'}")
    return "\n\n".join(parts)


def _clean_json_str(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```json"):
        s = s[7:]
    elif s.startswith("```"):
        s = s[3:]
    if s.endswith("```"):
        s = s[:-3]
    return s.strip()


async def call_llm(
    show_outputs: str,
    topology_note: str,
    symptom: str,
    rule_findings: List[Any],
) -> tuple[Optional[Dict[str, Any]], str, Optional[str]]:
    """
    Call OpenRouter and return (parsed_diagnosis_dict, ai_status, ai_unavailable_reason).
    ai_status values: 'AVAILABLE', 'UNAVAILABLE', 'FAILED'
    Never raises — all errors are caught and logged safely without leaking secrets.
    """
    api_key = _get_api_key()
    model = _get_model()

    logger.info("LLM request started")
    logger.info("OPENROUTER_API_KEY loaded: %s", bool(api_key))
    logger.info("Configured model: %s", model)

    if not api_key:
        reason = "OPENROUTER_API_KEY is not configured in the backend environment."
        logger.info("Fallback reason: %s", reason)
        return None, "UNAVAILABLE", reason

    user_message = _build_user_message(show_outputs, topology_note, symptom, rule_findings)

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.1,
        "max_tokens": 1200,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "NetSage AI",
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(OPENROUTER_API_URL, json=payload, headers=headers)
        
        logger.info("OpenRouter response status: %s", resp.status_code)
        resp.raise_for_status()
        
        data = resp.json()
        raw_content = data["choices"][0]["message"]["content"]
        clean_raw = _clean_json_str(raw_content)
        parsed = json.loads(clean_raw)
        
        logger.info("LLM parse success: true")
        return parsed, "AVAILABLE", None

    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code
        logger.warning("OpenRouter response status: %s", status_code)
        reason = f"OpenRouter API returned HTTP error {status_code}"
        logger.warning("Fallback reason: %s", reason)
        return None, "FAILED", reason

    except httpx.RequestError as e:
        reason = f"OpenRouter network request failed: {type(e).__name__}"
        logger.warning("Fallback reason: %s", reason)
        return None, "FAILED", reason

    except (KeyError, json.JSONDecodeError) as e:
        logger.warning("LLM parse success: false")
        reason = f"Failed to parse structured JSON from LLM output: {e}"
        logger.warning("Fallback reason: %s", reason)
        return None, "FAILED", reason

    except Exception as e:
        reason = f"Unexpected error during LLM invocation: {type(e).__name__}"
        logger.warning("Fallback reason: %s", reason)
        return None, "FAILED", reason

