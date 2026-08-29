"""
NOVA — FastAPI Backend
======================
Endpoints:
  POST /api/v1/diagnose   — Python RuleChecker + OpenRouter LLM → diagnosis
  POST /api/v1/review     — Log human review decision
  GET  /api/v1/reviews    — Return review log entries
  GET  /api/v1/health     — Health check

Run:
  uvicorn backend.main:app --reload --port 8000
  (from the project root: k:/Projects/NOVA-updated-in-html-format)
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .llm import call_llm
from .models import (
    DiagnoseRequest,
    DiagnoseResponse,
    EvidenceItem,
    ReviewRequest,
    ReviewResponse,
    RuleFinding,
)
from .review_log import log_diagnosis, log_responsible_ai, log_review
from .rulechecker import RuleChecker

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="NetSage AI Backend",
    description="Evidence-constrained network troubleshooting API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory review cache (survives only for the current server process)
_reviews_cache: List[Dict[str, Any]] = []

# ── Helpers ───────────────────────────────────────────────────────────────────

# Map RuleChecker internal check names → human-readable UI labels
_CHECK_LABELS: Dict[str, str] = {
    "duplicate_ip": "Duplicate IP Allocation",
    "subnet_mask": "Subnet Mask Validation",
    "default_gateway": "Default Gateway Reachability",
    "interface_status": "Interface Physical / Line Status",
    "vlan": "VLAN & Trunking Assignment",
    "routing": "Routing Table & OSPF Verification",
}


def _findings_to_models(checker: RuleChecker) -> List[RuleFinding]:
    return [
        RuleFinding(
            rule_id=f.check,
            check=_CHECK_LABELS.get(f.check, f.check.replace("_", " ").title()),
            status=f.status,
            details=f.message,
        )
        for f in checker.findings
    ]


def _build_rule_only_response(
    case_id: str,
    rule_findings: List[RuleFinding],
    ai_status: str = "UNAVAILABLE",
    ai_unavailable_reason: Optional[str] = None,
) -> DiagnoseResponse:
    """
    Fallback diagnosis built entirely from rule checker output,
    with no LLM involved. Clearly marks llm_assisted=False.
    """
    fails = [f for f in rule_findings if f.status == "FAIL"]
    warns = [f for f in rule_findings if f.status == "WARN"]

    if fails:
        # Build a diagnosis from the first FAIL finding
        primary = fails[0]
        state = "CONFIRMED"
        confidence = "Medium (Rule Checker — No AI Diagnosis)"
        root_cause = (
            f"Deterministic check failed: {primary.check}. "
            f"AI diagnosis unavailable — see rule checker findings for details."
        )
        osi = _guess_osi(primary.rule_id)
        evidence = [
            EvidenceItem(
                evidence_type="DIRECT_EVIDENCE",
                description=f.details,
                source=f"Python RuleChecker v2 — {_CHECK_LABELS.get(f.rule_id, f.rule_id)}",
            )
            for f in fails
        ]
        missing: List[str] = []
        fix = "Review the FAIL findings above and apply the indicated fix in Packet Tracer."
        next_cmd = "show ip interface brief"
        steps = (
            "Apply the fix indicated by the rule checker findings in Packet Tracer. "
            "Run the relevant show commands to verify the fix was applied correctly. "
            "This step must be performed manually by the engineer."
        )
        return DiagnoseResponse(
            case_id=case_id,
            diagnosis_state=state,
            confidence=confidence,
            suspected_root_cause=root_cause,
            osi_layer=osi,
            supporting_evidence=evidence,
            missing_evidence=missing,
            recommended_next_command=next_cmd,
            recommended_fix=fix,
            verification_steps=steps,
            rule_findings=rule_findings,
            llm_assisted=False,
            ai_status=ai_status,
            ai_unavailable_reason=ai_unavailable_reason,
        )
    elif warns:
        primary = warns[0]
        return DiagnoseResponse(
            case_id=case_id,
            diagnosis_state="PROBABLE",
            confidence="Low (Rule Checker WARN — No AI Diagnosis)",
            suspected_root_cause=(
                f"Possible issue: {primary.check}. "
                "AI diagnosis unavailable — collect more CLI evidence."
            ),
            osi_layer=_guess_osi(primary.rule_id),
            supporting_evidence=[
                EvidenceItem(
                    evidence_type="INFERRED_EVIDENCE",
                    description=f.details,
                    source=f"Python RuleChecker v2 — {_CHECK_LABELS.get(f.rule_id, f.rule_id)}",
                )
                for f in warns
            ],
            missing_evidence=["show vlan brief", "show ip interface brief", "show ip route"],
            recommended_next_command="show ip interface brief",
            recommended_fix="",
            verification_steps="Collect the missing CLI evidence listed above, then re-run the analysis.",
            rule_findings=rule_findings,
            llm_assisted=False,
            ai_status=ai_status,
            ai_unavailable_reason=ai_unavailable_reason,
        )
    else:
        return DiagnoseResponse(
            case_id=case_id,
            diagnosis_state="INSUFFICIENT_EVIDENCE",
            confidence="Low (Insufficient Evidence — No AI Diagnosis)",
            suspected_root_cause="Insufficient CLI Evidence",
            osi_layer="Unknown",
            supporting_evidence=[],
            missing_evidence=["show vlan brief", "show ip interface brief", "show ip route"],
            recommended_next_command="show ip interface brief",
            recommended_fix="",
            verification_steps="",
            rule_findings=rule_findings,
            llm_assisted=False,
            ai_status=ai_status,
            ai_unavailable_reason=ai_unavailable_reason,
            required_next_evidence=["show vlan brief", "show ip interface brief", "show ip route"],
            reason=(
                "All deterministic checks passed, but there is not enough CLI evidence "
                "to determine the root cause. AI diagnosis is also unavailable."
            ),
            why=(
                "These commands provide the layer 2 and layer 3 state needed to "
                "identify VLAN, gateway, routing, or interface problems."
            ),
        )


def _guess_osi(rule_id: str) -> str:
    mapping = {
        "duplicate_ip": "Layer 3 — Network",
        "subnet_mask": "Layer 3 — Network",
        "default_gateway": "Layer 3 — Network",
        "interface_status": "Layer 1 — Physical",
        "vlan": "Layer 2 — Data Link",
        "routing": "Layer 3 — Network",
    }
    return mapping.get(rule_id, "Unknown")


def _llm_to_response(
    case_id: str,
    llm: Dict[str, Any],
    rule_findings: List[RuleFinding],
    ai_status: str = "AVAILABLE",
    ai_unavailable_reason: Optional[str] = None,
) -> DiagnoseResponse:
    """Convert a raw LLM dict into a DiagnoseResponse, merging rule findings."""
    evidence = [
        EvidenceItem(
            evidence_type=e.get("evidence_type", "INFERRED_EVIDENCE"),
            description=e.get("description", ""),
            source=e.get("source", "LLM inference"),
        )
        for e in llm.get("supporting_evidence", [])
    ]

    return DiagnoseResponse(
        case_id=case_id,
        diagnosis_state=llm.get("diagnosis_state", "PROBABLE"),
        confidence=llm.get("confidence", "Medium (AI Assessed)"),
        suspected_root_cause=llm.get("suspected_root_cause", "Unknown"),
        osi_layer=llm.get("osi_layer", "Unknown"),
        supporting_evidence=evidence,
        missing_evidence=llm.get("missing_evidence", []),
        recommended_next_command=llm.get("recommended_next_command", ""),
        recommended_fix=llm.get("recommended_fix", ""),
        verification_steps=llm.get("verification_steps", ""),
        rule_findings=rule_findings,
        llm_assisted=True,
        ai_status=ai_status,
        ai_unavailable_reason=ai_unavailable_reason,
        required_next_evidence=llm.get("required_next_evidence"),
        reason=llm.get("reason"),
        why=llm.get("why"),
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/v1/health")
async def health():
    return {
        "status": "ok",
        "service": "NetSage AI Backend",
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
    }


@app.post("/api/v1/diagnose", response_model=DiagnoseResponse)
async def diagnose(req: DiagnoseRequest):
    """
    Main diagnosis endpoint.
    1. Run Python RuleChecker (deterministic, always)
    2. If OpenRouter key present → call LLM with findings + evidence
    3. If LLM unavailable → return rule-checker-only response (clearly marked)
    4. Log everything to ai_diagnosis_log.jsonl
    """
    case_id = req.case_id or f"CASE-{int(time.time())}"
    show_outputs = (req.show_command_outputs or {}).get("raw", "")
    topology_note = req.topology_note or ""
    symptom = req.symptom or req.title or ""

    logger.info("Diagnosing case_id=%s", case_id)

    # ── Step 1: Deterministic rule check (Python RuleChecker v2) ──────────────
    checker = RuleChecker()
    checker.run_case(
        {
            "case_id": case_id,
            "topology_note": topology_note,
            "show_outputs": show_outputs,
            "symptom": symptom,
        }
    )
    rule_findings = _findings_to_models(checker)

    fail_count = sum(1 for f in rule_findings if f.status == "FAIL")
    warn_count = sum(1 for f in rule_findings if f.status == "WARN")
    logger.info("Rule checker: %d FAIL, %d WARN", fail_count, warn_count)

    # ── Step 2: LLM diagnosis (optional, graceful fallback) ───────────────────
    llm_raw: Any = None
    response: DiagnoseResponse

    llm_result, ai_status, ai_reason = await call_llm(
        show_outputs=show_outputs,
        topology_note=topology_note,
        symptom=symptom,
        rule_findings=checker.findings,
    )

    if llm_result is not None:
        llm_raw = llm_result
        response = _llm_to_response(
            case_id,
            llm_result,
            rule_findings,
            ai_status=ai_status,
            ai_unavailable_reason=ai_reason,
        )
        logger.info("LLM diagnosis: state=%s ai_status=%s", response.diagnosis_state, ai_status)
    else:
        # No LLM — build from rule checker only
        response = _build_rule_only_response(
            case_id,
            rule_findings,
            ai_status=ai_status,
            ai_unavailable_reason=ai_reason,
        )
        logger.info("Rule-checker-only response: state=%s ai_status=%s", response.diagnosis_state, ai_status)

    # ── Step 3: Log diagnosis ─────────────────────────────────────────────────
    log_diagnosis(
        case_id=case_id,
        request_payload=req.model_dump(),
        rule_findings=checker.findings,
        llm_raw_output=llm_raw,
        final_diagnosis_state=response.diagnosis_state,
        llm_assisted=response.llm_assisted,
    )

    return response



@app.post("/api/v1/review", response_model=ReviewResponse)
async def review(req: ReviewRequest):
    """
    Log a human review decision.
    - All decisions → reviews.jsonl
    - EDITED or REJECTED → also responsible_ai_log.jsonl
    """
    timestamp = req.timestamp or datetime.now(tz=timezone.utc).isoformat()

    entry = {
        "timestamp": timestamp,
        "diagnosis_id": req.diagnosis_id,
        "case_id": req.case_id,
        "root_cause": req.root_cause,
        "original_ai_root_cause": req.original_ai_root_cause,
        "original_ai_state": req.original_ai_state,
        "status": req.status,
        "decision": req.decision,
        "verification": req.verification,
        "notes": req.notes,
        "is_responsible_ai_case": req.is_responsible_ai_case,
    }

    # Always log to reviews.jsonl
    log_review(entry)
    _reviews_cache.append(entry)

    # EDITED or REJECTED → responsible AI log
    if req.decision in ("EDITED", "REJECTED"):
        log_responsible_ai(entry)
        logger.info(
            "Responsible AI correction logged: case=%s decision=%s",
            req.case_id,
            req.decision,
        )

    logger.info(
        "Review logged: case=%s decision=%s verification=%s",
        req.case_id,
        req.decision,
        req.verification,
    )
    return ReviewResponse(status="logged", message=f"Review recorded: {req.decision}")


@app.get("/api/v1/reviews")
async def get_reviews():
    """Return all review entries from the in-memory cache."""
    return {"reviews": _reviews_cache, "count": len(_reviews_cache)}
