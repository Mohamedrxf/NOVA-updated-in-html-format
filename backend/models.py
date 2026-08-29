"""
Pydantic v2 request / response models for the NOVA FastAPI backend.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ── Inbound ──────────────────────────────────────────────────────────────────

class DiagnoseRequest(BaseModel):
    case_id: Optional[str] = None
    title: Optional[str] = None
    symptom: Optional[str] = None
    topology_note: Optional[str] = ""
    # Frontend sends { "raw": "<cli text>" }
    show_command_outputs: Dict[str, Any] = Field(default_factory=dict)
    # Optional metadata the frontend may include (ignored by checker)
    category: Optional[str] = None
    device_information: Optional[List] = Field(default_factory=list)
    expected_fault: Optional[str] = None
    expected_osi_layer: Optional[str] = None
    concept: Optional[str] = None
    severity: Optional[str] = None
    expected_fix: Optional[str] = None
    expected_next_command: Optional[str] = None


class ReviewRequest(BaseModel):
    diagnosis_id: str
    case_id: str
    timestamp: Optional[str] = None
    root_cause: str
    status: str                       # CONFIRMED | PROBABLE | INSUFFICIENT_EVIDENCE
    decision: str                     # ACCEPTED | EDITED | REJECTED
    verification: str                 # SUCCESS | PARTIAL_SUCCESS | FAILED | NOT_TESTED
    notes: Optional[str] = ""
    is_responsible_ai_case: bool = False
    # Preserve original AI output when human edits/rejects
    original_ai_root_cause: Optional[str] = None
    original_ai_state: Optional[str] = None


# ── Outbound ─────────────────────────────────────────────────────────────────

class RuleFinding(BaseModel):
    rule_id: str     # e.g. "duplicate_ip"
    check: str       # Human-readable label
    status: str      # PASS | FAIL | WARN
    details: str     # Finding message


class EvidenceItem(BaseModel):
    evidence_type: str   # DIRECT_EVIDENCE | INFERRED_EVIDENCE
    description: str
    source: str          # e.g. "SW1#show vlan brief"


class DiagnoseResponse(BaseModel):
    case_id: str
    diagnosis_state: str             # CONFIRMED | PROBABLE | INSUFFICIENT_EVIDENCE
    confidence: str
    suspected_root_cause: str
    osi_layer: str
    supporting_evidence: List[EvidenceItem] = Field(default_factory=list)
    missing_evidence: List[str] = Field(default_factory=list)
    recommended_next_command: str = ""
    recommended_fix: str = ""
    verification_steps: str = ""
    rule_findings: List[RuleFinding] = Field(default_factory=list)
    llm_assisted: bool = False
    ai_status: str = "UNAVAILABLE"   # AVAILABLE | UNAVAILABLE | FAILED
    ai_unavailable_reason: Optional[str] = None
    # Only present when diagnosis_state == INSUFFICIENT_EVIDENCE
    required_next_evidence: Optional[List[str]] = None
    reason: Optional[str] = None
    why: Optional[str] = None


class ReviewResponse(BaseModel):
    status: str = "logged"
    message: str = "Review recorded."
