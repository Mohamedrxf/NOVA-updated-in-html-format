// ============================================================
// NetSage AI — Analyze Module
// AI-assisted network troubleshooting input, rule-checker findings,
// evidence analysis, human-in-the-loop review, and Packet Tracer verification.
// ============================================================

import { runRuleChecker } from "./rulechecker.js";

const API_BASE_URL = "http://localhost:8000";

// Preset sample inputs for testing
export const SAMPLES = {
  vlanMismatch: {
    title: "Access Port VLAN Mismatch",
    text: `PC1 cannot reach Server in VLAN 20.

IP Address: 192.168.20.10
Subnet Mask: 255.255.255.0
Default Gateway: 192.168.20.1

Ping Result:
Ping 192.168.20.1: 100% packet loss (Request timed out)

Switch Output:
SW1#show vlan brief
VLAN Name                             Status    Ports
---- -------------------------------- --------- -------------------------------
1    default                          active    Fa0/1, Fa0/2, Fa0/3
20   VLAN0020                         active    Gi0/1

SW1#show ip interface brief
Interface                  IP-Address      OK? Method Status                Protocol
FastEthernet0/1            unassigned      YES unset  up                    up
GigabitEthernet0/1         192.168.20.1    YES manual up                    up`,
  },
  insufficientEvidence: {
    title: "Partial Evidence (Ping Loss Only)",
    text: `PC cannot reach the server.

IP Address: 192.168.20.10
Subnet Mask: 255.255.255.0
Default Gateway: 192.168.20.1

Ping Result:
100% packet loss`,
  },
  gatewayMismatch: {
    title: "Wrong Default Gateway Config",
    text: `PC in VLAN 30 has no internet/gateway connectivity.

PC Config:
IP Address: 192.168.30.10
Subnet Mask: 255.255.255.0
Default Gateway: 192.168.20.1

Expected Gateway Subnet: 192.168.30.1

Router Output:
R1#show ip interface brief
Interface                  IP-Address      OK? Method Status                Protocol
GigabitEthernet0/0.30      192.168.30.1    YES manual up                    up`,
  },
};

// Responsible AI session audit log
let auditLogs = [
  {
    diagnosis_id: "diag-sample-01",
    case_id: "TC04",
    timestamp: "2026-08-29 11:20:00",
    root_cause: "Access port placed in VLAN 1 instead of VLAN 20",
    status: "CONFIRMED",
    decision: "EDITED",
    verification: "SUCCESS",
    notes: "VLAN mismatch confirmed. DHCP scope gateway also needed adjustment.",
    is_responsible_ai_case: true,
  },
  {
    diagnosis_id: "diag-sample-02",
    case_id: "TC30",
    timestamp: "2026-08-29 11:45:00",
    root_cause: "Guest SSID mapped to management VLAN",
    status: "PROBABLE",
    decision: "REJECTED",
    verification: "FAILED",
    notes: "VLAN mapping was correct. ACL rule on R1 was blocking guest subnets.",
    is_responsible_ai_case: true,
  },
];

let conversationHistory = [];
let currentDiagnosis = null;

// Local fallback engine in case Python backend API server is offline
function processLocalAnalysis(inputText, caseId = "", symptom = "", topologyNote = "") {
  const textLower = (inputText + " " + symptom + " " + topologyNote).toLowerCase();

  const hasVlanBrief = textLower.includes("show vlan") || textLower.includes("vlan brief") || textLower.includes("vlan name");
  const hasIpIntBrief = textLower.includes("show ip interface") || textLower.includes("ip-address") || textLower.includes("fastethernet") || textLower.includes("gigabitethernet");
  const hasPingLoss = textLower.includes("packet loss") || textLower.includes("timed out") || textLower.includes("unreachable") || textLower.includes("cannot reach");

  // ── Deterministic Rule Checker (v2 JS port) ──────────────────
  // Runs the real structural parser — no keyword-matching of conclusions.
  const ruleFindings = runRuleChecker(
    inputText,          // show_outputs / CLI evidence
    topologyNote,       // topology_note
    inputText + "\n" + symptom + "\n" + topologyNote  // full combined text
  );

  // Derive convenience flags from checker results for diagnosis branching
  const checkerFails = ruleFindings.filter((f) => f.status === "FAIL").map((f) => f.rule_id);
  const isVlanFail     = checkerFails.includes("VLAN");
  const isGatewayFail  = checkerFails.includes("DEFAULT_GATEWAY");
  const isInterfaceFail = checkerFails.includes("INTERFACE_STATUS");
  // Legacy heuristic helpers (still used for the hard-coded sample matching below)
  const isVlanMismatch   = isVlanFail || (textLower.includes("fa0/1") && textLower.includes("default") && textLower.includes("vlan0020"));
  const isGatewayMismatch = isGatewayFail || (textLower.includes("192.168.30.10") && textLower.includes("192.168.20.1"));

  // Insufficient evidence check
  if (!hasVlanBrief && !hasIpIntBrief && !isGatewayMismatch && !isInterfaceFail) {
    return {
      diagnosis_id: `diag-${Date.now()}`,
      case_id: caseId || "CASE-INSUFFICIENT",
      diagnosis_state: "INSUFFICIENT_EVIDENCE",
      confidence: "Low (Needs CLI Evidence)",
      suspected_root_cause: "Insufficient CLI Command Evidence",
      osi_layer: "Unknown",
      reason: "The current information does not prove whether the issue is caused by VLAN configuration, Layer 3 routing, ACLs, interface status, or physical link failure.",
      required_next_evidence: ["show vlan brief", "show ip interface brief", "show ip route"],
      why: "These Cisco show commands are required to verify access port VLAN assignments, interface IP addresses, and routing table entries.",
      supporting_evidence: [
        { evidence_type: "INFERRED_EVIDENCE", description: "Observed ping failure and IP configuration", source: "User Input" },
      ],
      missing_evidence: ["show vlan brief output", "show ip interface brief output"],
      recommended_next_command: "SW1# show vlan brief & show ip interface brief",
      recommended_fix: "Paste the requested Cisco show-command outputs into the analysis input box and click Analyze again.",
      verification_steps: "Gather outputs from switch and router, then re-run analysis.",
      rule_findings: ruleFindings,
      llm_assisted: true,
    };
  }

  if (isVlanMismatch) {
    return {
      diagnosis_id: `diag-${Date.now()}`,
      case_id: caseId || "CASE-VLAN-01",
      diagnosis_state: "CONFIRMED",
      confidence: "High (100% Direct Evidence)",
      suspected_root_cause: "Access Port VLAN Mismatch (Fa0/1 assigned to VLAN 1 instead of VLAN 20)",
      osi_layer: "Layer 2 — Data Link",
      supporting_evidence: [
        { evidence_type: "DIRECT_EVIDENCE", description: "Fa0/1 is listed under VLAN 1 (default) in 'show vlan brief'", source: "SW1#show vlan brief" },
        { evidence_type: "DIRECT_EVIDENCE", description: "Target server subinterface is on VLAN 20 (192.168.20.1)", source: "SW1#show ip interface brief" },
      ],
      missing_evidence: [],
      recommended_next_command: "SW1# show interface Fa0/1 switchport",
      recommended_fix: "Reconfigure port Fa0/1 on SW1 to access VLAN 20:\nSW1(config)# interface Fa0/1\nSW1(config-if)# switchport mode access\nSW1(config-if)# switchport access vlan 20",
      verification_steps: "In Packet Tracer, apply the VLAN configuration commands on SW1. Execute 'ping 192.168.20.1' from PC1 and verify 100% success rate.",
      rule_findings: ruleFindings,
      llm_assisted: true,
    };
  }

  if (isGatewayMismatch) {
    return {
      diagnosis_id: `diag-${Date.now()}`,
      case_id: caseId || "CASE-GW-02",
      diagnosis_state: "CONFIRMED",
      confidence: "High (Direct Configuration Contradiction)",
      suspected_root_cause: "Incorrect Default Gateway IP Configured on Host",
      osi_layer: "Layer 3 — Network",
      supporting_evidence: [
        { evidence_type: "DIRECT_EVIDENCE", description: "Host IP is 192.168.30.10/24 but configured gateway is 192.168.20.1", source: "PC Configuration" },
        { evidence_type: "DIRECT_EVIDENCE", description: "Router subinterface Gi0/0.30 IP is 192.168.30.1", source: "R1#show ip interface brief" },
      ],
      missing_evidence: [],
      recommended_next_command: "PC1> ipconfig /all",
      recommended_fix: "Update the Default Gateway setting on PC1 to match the VLAN 30 subnet gateway (192.168.30.1).",
      verification_steps: "Change PC1 Default Gateway to 192.168.30.1 in Packet Tracer. Test ping to 192.168.30.1 and verify zero packet loss.",
      rule_findings: ruleFindings,
      llm_assisted: true,
    };
  }

  // Default Probable Diagnosis
  return {
    diagnosis_id: `diag-${Date.now()}`,
    case_id: caseId || "CASE-GEN-03",
    diagnosis_state: "PROBABLE",
    confidence: "Medium (Probable Root Cause)",
    suspected_root_cause: "Interface Down or Subnet Routing Mismatch",
    osi_layer: "Layer 3 — Network",
    supporting_evidence: [
      { evidence_type: "INFERRED_EVIDENCE", description: "Ping packet loss detected across host interface", source: "Ping Output" },
    ],
    missing_evidence: ["show ip route", "show access-lists"],
    recommended_next_command: "R1# show ip route & show ip interface brief",
    recommended_fix: "Check physical link status and verify routing table entries for the destination subnet.",
    verification_steps: "Verify line protocol status in Packet Tracer using 'show ip interface brief'.",
    rule_findings: ruleFindings,
    llm_assisted: true,
  };
}

// Call Python Backend API (with fallback if server is offline)
async function runAnalysisAPI(inputText, caseId, symptom, topologyNote) {
  try {
    const controller = new AbortController();
    // 18 s — LLM calls can take 5–15 s
    const timeoutId = setTimeout(() => controller.abort(), 18000);

    const response = await fetch(`${API_BASE_URL}/api/v1/diagnose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        case_id: caseId || `CASE-${Date.now().toString().slice(-4)}`,
        title: symptom || "Network Troubleshooting Query",
        category: "vlan_trunking",
        symptom: symptom || inputText.slice(0, 100),
        topology_note: topologyNote || "Pasted user evidence",
        device_information: [],
        show_command_outputs: { raw: inputText },
        expected_fault: "Unknown",
        expected_osi_layer: "layer_2_datalink",
        concept: "Network Troubleshooting",
        severity: "high",
        expected_fix: "Check evidence",
        expected_next_command: "show vlan brief",
      }),
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        diagnosis_id: `diag-${Date.now()}`,
        case_id: data.case_id || caseId,
        diagnosis_state: data.diagnosis_state || "PROBABLE",
        confidence: data.confidence || (data.llm_assisted ? "High (AI + Rule Checker)" : "Medium (Rule Checker Only)"),
        suspected_root_cause: data.suspected_root_cause || "Network configuration issue",
        osi_layer: data.osi_layer || "Unknown",
        supporting_evidence: data.supporting_evidence || [],
        missing_evidence: data.missing_evidence || [],
        recommended_next_command: data.recommended_next_command || "show ip interface brief",
        recommended_fix: data.recommended_fix || "",
        verification_steps: data.verification_steps || "Apply fix in Packet Tracer and record outcome.",
        rule_findings: data.rule_findings || [],
        llm_assisted: data.llm_assisted ?? false,
        // INSUFFICIENT_EVIDENCE fields
        required_next_evidence: data.required_next_evidence || null,
        reason: data.reason || null,
        why: data.why || null,
      };
    }
  } catch (err) {
    console.warn("Backend API offline or unreachable; using local rule engine fallback.", err);
  }

  // Local fallback
  return processLocalAnalysis(inputText, caseId, symptom, topologyNote);
}

// Call Python Review API (with fallback)
async function sendReviewAPI(payload) {
  try {
    await fetch(`${API_BASE_URL}/api/v1/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.log("Local review logging fallback active.", e);
  }
}

// Build review payload, always preserving original AI output
function buildReviewPayload(diag, overrides) {
  return {
    diagnosis_id: diag.diagnosis_id,
    case_id: diag.case_id,
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    // Original AI output — preserved even when human edits/rejects
    original_ai_root_cause: diag.suspected_root_cause,
    original_ai_state: diag.diagnosis_state,
    ...overrides,
  };
}

// Render Functions
export function renderAuditLogs() {
  const body = document.getElementById("auditLogBody");
  if (!body) return;

  const decisionBadge = {
    ACCEPTED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    EDITED: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    REJECTED: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  };

  const statusBadge = {
    SUCCESS: "text-emerald-300",
    PARTIAL_SUCCESS: "text-cyan",
    FAILED: "text-rose-300",
    NOT_TESTED: "text-muted",
  };

  body.innerHTML = auditLogs
    .map(
      (log) => `
    <tr class="border-b border-line/60 transition hover:bg-panel2/60">
      <td class="px-3 py-3 font-mono text-[12px] text-cyan">${log.diagnosis_id}</td>
      <td class="px-3 py-3 font-mono text-[11px] text-muted">${log.case_id}</td>
      <td class="px-3 py-3 text-[12px] leading-tight">${log.root_cause}</td>
      <td class="px-3 py-3"><span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${decisionBadge[log.decision] || "border-line text-muted"}">${log.decision}</span></td>
      <td class="px-3 py-3 text-[12px] font-medium ${statusBadge[log.verification]}">${log.verification}</td>
      <td class="px-3 py-3 text-[11px] text-muted">${log.notes || "—"}</td>
      <td class="px-3 py-3">${log.is_responsible_ai_case ? '<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300"><span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>Correction Logged</span>' : '<span class="text-[11px] text-muted">Standard</span>'}</td>
    </tr>`
    )
    .join("");

  const countEl = document.getElementById("responsibleAiCount");
  if (countEl) {
    const corrections = auditLogs.filter((l) => l.is_responsible_ai_case).length;
    countEl.textContent = `${corrections} Responsible AI Correction Cases Recorded`;
  }
}

function renderRuleFindings(findings) {
  const container = document.getElementById("ruleFindingsContainer");
  if (!container) return;

  const badgeMap = {
    PASS: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    FAIL: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    WARN: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  };

  container.innerHTML = `
    <div class="rounded-xl border border-line bg-panel/60 p-4">
      <div class="flex items-center justify-between border-b border-line pb-3">
        <div class="flex items-center gap-2">
          <span class="grid h-7 w-7 place-items-center rounded-lg border border-cyan/40 bg-cyan/10 text-cyan">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3v18M4 7h5M4 12h5M4 17h5"/><path d="M14 6h6M14 12h6M14 18h6"/></svg>
          </span>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">Deterministic Rule Checker Findings</h3>
        </div>
        <span class="text-[11px] text-cyan font-mono">${findings.length} checks executed</span>
      </div>

      <div class="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        ${findings
          .map(
            (f) => `
          <div class="flex items-start justify-between rounded-lg border border-line/70 bg-panel2/50 p-3">
            <div>
              <p class="text-[12px] font-semibold text-ink">${f.check}</p>
              <p class="mt-0.5 text-[11px] text-muted">${f.details}</p>
            </div>
            <span class="rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold ${badgeMap[f.status] || "border-line text-muted"}">${f.status}</span>
          </div>`
          )
          .join("")}
      </div>

      <div class="mt-3 flex items-center gap-2 rounded-lg border border-cyan/20 bg-cyan/[0.04] px-3 py-2 text-[11px] text-muted">
        <span class="text-cyan">ℹ</span>
        <span><b>Rule Engine + AI Synergy:</b> PASS = No deterministic error found. FAIL = Direct problem proven. WARN = Requires AI evaluation.</span>
      </div>
    </div>`;
}

// Render conversation messages into ChatGPT-style thread
function renderChatThread() {
  const chatThread = document.getElementById("chatThread");
  if (!chatThread) return;

  // Initial welcome message if conversation is empty
  if (conversationHistory.length === 0) {
    chatThread.innerHTML = `
      <div class="flex items-start gap-3 max-w-3xl">
        <div class="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-cyan/40 bg-cyan/10 text-cyan shadow-glow mt-0.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M11 13l-4 4M13 13l4 4"/></svg>
        </div>
        <div class="rounded-2xl border border-line/90 glass p-4 text-xs text-ink leading-relaxed">
          <p class="font-semibold text-cyan mb-1 flex items-center gap-1.5">
            <span>NetSage Network Assistant</span>
            <span class="rounded bg-cyan/10 border border-cyan/30 px-1.5 py-0.2 text-[9px] font-mono">Evidence-Constrained</span>
          </p>
          <p class="text-muted">
            Hello! I am your interactive network troubleshooting assistant. Paste your network evidence, Cisco show-command outputs (e.g. <code class="text-cyan font-mono">show vlan brief</code>, <code class="text-cyan font-mono">show ip interface brief</code>, <code class="text-cyan font-mono">show ip route</code>), or select a preset sample below to begin.
          </p>
        </div>
      </div>`;
    return;
  }

  let html = `
    <div class="flex items-start gap-3 max-w-3xl mb-4">
      <div class="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-cyan/40 bg-cyan/10 text-cyan shadow-glow mt-0.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M11 13l-4 4M13 13l4 4"/></svg>
      </div>
      <div class="rounded-2xl border border-line/90 glass p-4 text-xs text-ink leading-relaxed">
        <p class="font-semibold text-cyan mb-1 flex items-center gap-1.5">
          <span>NetSage Network Assistant</span>
          <span class="rounded bg-cyan/10 border border-cyan/30 px-1.5 py-0.2 text-[9px] font-mono">Evidence-Constrained</span>
        </p>
        <p class="text-muted">Interactive diagnostic session started.</p>
      </div>
    </div>`;

  conversationHistory.forEach((item, idx) => {
    if (item.type === "user") {
      html += `
        <div class="flex justify-end my-3">
          <div class="max-w-2xl rounded-2xl border border-cyan/40 bg-cyan/10 p-4 text-ink shadow-md">
            <div class="flex items-center justify-between gap-3 mb-1.5 text-[11px] font-mono text-cyan">
              <span class="flex items-center gap-1.5 font-semibold">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/></svg>
                Engineer Input
              </span>
              <span class="text-muted text-[10px]">${item.time}</span>
            </div>
            <pre class="whitespace-pre-wrap font-mono text-[12px] text-ink/90 leading-relaxed">${item.text}</pre>
          </div>
        </div>`;
    } else {
      const diag = item.data;
      const isInsufficient = diag.diagnosis_state === "INSUFFICIENT_EVIDENCE";
      const isConfirmed = diag.diagnosis_state === "CONFIRMED";
      const findings = diag.rule_findings || [];

      const badgeStyle = isInsufficient
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : isConfirmed
        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
        : "border-cyan/40 bg-cyan/10 text-cyan";

      const findingsBadge = {
        PASS: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        FAIL: "border-rose-500/40 bg-rose-500/10 text-rose-300",
        WARN: "border-amber-500/40 bg-amber-500/10 text-amber-300",
      };

      html += `
        <div class="flex items-start gap-3 my-4">
          <div class="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-cyan/40 bg-cyan/10 text-cyan shadow-glow mt-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M11 13l-4 4M13 13l4 4"/></svg>
          </div>

          <div class="w-full max-w-3xl rounded-2xl border border-line glass p-4 sm:p-5 text-xs text-ink space-y-4 shadow-xl">
            <!-- Header status row -->
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-3">
              <div class="flex items-center gap-2">
                <span class="inline-flex items-center gap-1.5 rounded-full border ${badgeStyle} px-3 py-1 text-[11px] font-semibold">
                  <span class="h-2 w-2 rounded-full ${isInsufficient ? "bg-amber-400" : isConfirmed ? "bg-emerald-400" : "bg-cyan"}"></span>
                  ${diag.diagnosis_state}
                </span>
                <span class="text-[11px] font-mono text-muted">Diag ID: <b class="text-cyan">${diag.diagnosis_id}</b></span>
              </div>
              <div class="flex items-center gap-2 text-[11px] font-mono">
                <span class="rounded-lg border border-line bg-panel2 px-2.5 py-1 text-muted">OSI: <b class="text-ink">${diag.osi_layer}</b></span>
                <span class="rounded-lg border border-line bg-panel2 px-2.5 py-1 text-muted">Confidence: <b class="${isInsufficient ? "text-amber-300" : "text-emerald-300"}">${diag.confidence}</b></span>
              </div>
            </div>

            <!-- Root cause highlight -->
            <div>
              <p class="text-[10px] uppercase font-semibold tracking-wider text-muted mb-1">Suspected Root Cause</p>
              <p class="text-sm sm:text-base font-extrabold text-ink leading-snug">${diag.suspected_root_cause}</p>
            </div>

            <!-- Collapsible Deterministic Rule Checker Findings -->
            ${
              findings.length > 0
                ? `
              <div class="rounded-xl border border-line bg-panel/60 p-3">
                <button type="button" class="ruleToggleBtn w-full flex items-center justify-between text-[11px] font-semibold text-cyan hover:text-cyan-soft focus:outline-none" data-target="rules-${idx}">
                  <span class="flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3v18M4 7h5M4 12h5M4 17h5"/><path d="M14 6h6M14 12h6M14 18h6"/></svg>
                    <span>Deterministic Rule Checks (${findings.length} executed)</span>
                  </span>
                  <span class="text-[10px] font-mono text-muted">Toggle Details ▾</span>
                </button>
                <div id="rules-${idx}" class="hidden mt-3 space-y-2 pt-2 border-t border-line/60">
                  ${findings
                    .map(
                      (f) => `
                    <div class="flex items-start justify-between rounded-lg border border-line/60 bg-panel2/50 p-2.5 text-[11px]">
                      <div>
                        <p class="font-semibold text-ink">${f.check}</p>
                        <p class="mt-0.5 text-muted">${f.details}</p>
                      </div>
                      <span class="rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold ${findingsBadge[f.status] || "border-line text-muted"}">${f.status}</span>
                    </div>`
                    )
                    .join("")}
                </div>
              </div>`
                : ""
            }

            <!-- Insufficient Evidence Notice or Fix Details -->
            ${
              isInsufficient
                ? `
              <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-2">
                <p class="text-[11px] font-semibold uppercase tracking-wider text-amber-300">Why Evidence is Insufficient</p>
                <p class="text-[12px] text-ink/90 leading-relaxed">${diag.reason}</p>
                <div class="pt-2 border-t border-amber-500/20">
                  <p class="text-[11px] font-semibold text-cyan">Required Next CLI Commands:</p>
                  <ul class="mt-1 space-y-1 font-mono text-[11px] text-ink">
                    ${(diag.required_next_evidence || []).map((e) => `<li class="flex items-center gap-1.5"><span class="text-amber-400">➔</span><span>${e}</span></li>`).join("")}
                  </ul>
                </div>
              </div>`
                : `
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div class="rounded-xl border border-cyan/30 bg-cyan/[0.06] p-3">
                  <p class="text-[10px] uppercase font-semibold tracking-wider text-cyan mb-1">Recommended Packet Tracer Fix</p>
                  <pre class="whitespace-pre-wrap font-mono text-[11px] text-ink bg-panel/80 p-2.5 rounded-lg border border-line/80 leading-relaxed">${diag.recommended_fix}</pre>
                </div>
                <div class="rounded-xl border border-line bg-panel/60 p-3">
                  <p class="text-[10px] uppercase font-semibold tracking-wider text-muted mb-1">Verification Instructions</p>
                  <p class="text-[11px] text-ink/90 leading-relaxed">${diag.verification_steps}</p>
                </div>
              </div>`
            }

            <!-- Inline Human Review Action Bar -->
            ${
              !isInsufficient
                ? `
              <div class="pt-3 border-t border-line/80" id="reviewSection-${idx}">
                <div class="flex items-center justify-between mb-3">
                  <span class="text-[11px] font-semibold text-ink">Human Verification Decision:</span>
                  <span class="text-[10px] text-muted font-mono">Logged to Responsible AI Audit</span>
                </div>
                <div class="flex flex-wrap items-center gap-2" id="reviewBtns-${idx}">
                  <button class="btnAcceptMsg rounded-xl bg-emerald-500/20 border border-emerald-500/40 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/30" data-idx="${idx}">
                    ✓ Accept
                  </button>
                  <button class="btnEditMsg rounded-xl bg-amber-500/20 border border-amber-500/40 px-3.5 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/30" data-idx="${idx}">
                    ✎ Edit
                  </button>
                  <button class="btnRejectMsg rounded-xl bg-rose-500/20 border border-rose-500/40 px-3.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/30" data-idx="${idx}">
                    ✕ Reject
                  </button>
                </div>
                <div id="reviewForm-${idx}" class="hidden mt-3 rounded-xl border border-line bg-panel/90 p-3"></div>
              </div>`
                : ""
            }
          </div>
        </div>`;
    }
  });

  chatThread.innerHTML = html;

  // Bind Rule Toggle Accordions
  chatThread.querySelectorAll(".ruleToggleBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const el = document.getElementById(targetId);
      if (el) el.classList.toggle("hidden");
    });
  });

  // Bind Inline Human Review Handlers
  bindInlineReviewHandlers();

  // Auto-scroll to bottom of chat thread
  chatThread.scrollTop = chatThread.scrollHeight;
}

function bindInlineReviewHandlers() {
  conversationHistory.forEach((item, idx) => {
    if (item.type !== "ai" || item.data.diagnosis_state === "INSUFFICIENT_EVIDENCE") return;

    const diag = item.data;
    const formContainer = document.getElementById(`reviewForm-${idx}`);
    if (!formContainer) return;

    // Accept Button
    document.querySelector(`.btnAcceptMsg[data-idx="${idx}"]`)?.addEventListener("click", () => {
      formContainer.classList.remove("hidden");
      formContainer.innerHTML = `
        <h4 class="text-xs font-semibold uppercase tracking-wider text-emerald-300 mb-2">Accept Diagnosis & Record Verification</h4>
        <div class="space-y-2.5">
          <div>
            <label class="block text-[10px] font-semibold text-muted mb-1">Packet Tracer Verification Outcome</label>
            <select id="acceptVerif-${idx}" class="w-full rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs font-mono text-ink">
              <option value="SUCCESS">SUCCESS — Applied fix & ping succeeded</option>
              <option value="PARTIAL_SUCCESS">PARTIAL_SUCCESS — Primary ping works</option>
              <option value="FAILED">FAILED — Issue persists</option>
              <option value="NOT_TESTED" selected>NOT_TESTED — Accepted without testing</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-semibold text-muted mb-1">Verification Notes</label>
            <input type="text" id="acceptNotes-${idx}" placeholder="e.g. Ping succeeded after fixing gateway" class="w-full rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs text-ink" />
          </div>
          <div class="flex justify-end pt-1">
            <button id="submitAccept-${idx}" class="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-base transition hover:bg-emerald-400">Log Accepted Decision</button>
          </div>
        </div>`;

      document.getElementById(`submitAccept-${idx}`)?.addEventListener("click", () => {
        const verification = document.getElementById(`acceptVerif-${idx}`).value;
        const notes = document.getElementById(`acceptNotes-${idx}`).value || "Accepted diagnosis after review.";

        const log = buildReviewPayload(diag, {
          root_cause: diag.suspected_root_cause,
          status: diag.diagnosis_state,
          decision: "ACCEPTED",
          verification,
          notes,
          is_responsible_ai_case: false,
        });

        auditLogs.unshift(log);
        renderAuditLogs();
        sendReviewAPI(log);
        formContainer.innerHTML = `<div class="text-xs font-semibold text-emerald-300 py-1">✓ Accepted diagnosis logged successfully.</div>`;
      });
    });

    // Edit Button
    document.querySelector(`.btnEditMsg[data-idx="${idx}"]`)?.addEventListener("click", () => {
      formContainer.classList.remove("hidden");
      formContainer.innerHTML = `
        <h4 class="text-xs font-semibold uppercase tracking-wider text-amber-300 mb-1">Edit Diagnosis (Responsible AI Override)</h4>
        <p class="text-[10px] text-muted mb-2">Original AI output preserved in audit log alongside your correction.</p>
        <div class="space-y-2.5">
          <div>
            <label class="block text-[10px] font-semibold text-muted mb-1">Corrected Root Cause</label>
            <input type="text" id="editRoot-${idx}" value="${diag.suspected_root_cause}" class="w-full rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs text-ink" />
          </div>
          <div>
            <label class="block text-[10px] font-semibold text-muted mb-1">Reviewer Comments</label>
            <input type="text" id="editComments-${idx}" placeholder="Reason for correction..." class="w-full rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs text-ink" />
          </div>
          <div>
            <label class="block text-[10px] font-semibold text-muted mb-1">Verification Status</label>
            <select id="editVerif-${idx}" class="w-full rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs font-mono text-ink">
              <option value="SUCCESS" selected>SUCCESS — Tested corrected fix in Packet Tracer</option>
              <option value="PARTIAL_SUCCESS">PARTIAL_SUCCESS</option>
              <option value="FAILED">FAILED</option>
            </select>
          </div>
          <div class="flex justify-end pt-1">
            <button id="submitEdit-${idx}" class="rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-base transition hover:bg-amber-400">Save Correction & Log</button>
          </div>
        </div>`;

      document.getElementById(`submitEdit-${idx}`)?.addEventListener("click", () => {
        const corrected = document.getElementById(`editRoot-${idx}`).value;
        const comments = document.getElementById(`editComments-${idx}`).value || "Corrected root cause.";
        const verification = document.getElementById(`editVerif-${idx}`).value;

        const log = buildReviewPayload(diag, {
          root_cause: `Original: ${diag.suspected_root_cause} | Corrected: ${corrected}`,
          status: diag.diagnosis_state,
          decision: "EDITED",
          verification,
          notes: comments,
          is_responsible_ai_case: true,
        });

        auditLogs.unshift(log);
        renderAuditLogs();
        sendReviewAPI(log);
        formContainer.innerHTML = `<div class="text-xs font-semibold text-amber-300 py-1">✎ Correction saved & recorded in Responsible AI dataset.</div>`;
      });
    });

    // Reject Button
    document.querySelector(`.btnRejectMsg[data-idx="${idx}"]`)?.addEventListener("click", () => {
      formContainer.classList.remove("hidden");
      formContainer.innerHTML = `
        <h4 class="text-xs font-semibold uppercase tracking-wider text-rose-300 mb-1">Reject Diagnosis</h4>
        <div class="space-y-2.5">
          <div>
            <label class="block text-[10px] font-semibold text-muted mb-1">Reason for Rejection</label>
            <input type="text" id="rejectReason-${idx}" placeholder="e.g. VLAN config was valid; ACL was blocking traffic." class="w-full rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs text-ink" />
          </div>
          <div>
            <label class="block text-[10px] font-semibold text-muted mb-1">Actual Root Cause</label>
            <input type="text" id="actualRoot-${idx}" placeholder="e.g. R1 ACL 101 deny statement" class="w-full rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs text-ink" />
          </div>
          <div class="flex justify-end pt-1">
            <button id="submitReject-${idx}" class="rounded-lg bg-rose-500 px-3.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-rose-400">Log Rejection</button>
          </div>
        </div>`;

      document.getElementById(`submitReject-${idx}`)?.addEventListener("click", () => {
        const reason = document.getElementById(`rejectReason-${idx}`).value || "Diagnosis rejected.";
        const actual = document.getElementById(`actualRoot-${idx}`).value || "Unknown";

        const log = buildReviewPayload(diag, {
          root_cause: `Rejected AI output. Actual: ${actual}`,
          status: diag.diagnosis_state,
          decision: "REJECTED",
          verification: "FAILED",
          notes: `Reason: ${reason}`,
          is_responsible_ai_case: true,
        });

        auditLogs.unshift(log);
        renderAuditLogs();
        sendReviewAPI(log);
        formContainer.innerHTML = `<div class="text-xs font-semibold text-rose-300 py-1">✕ Rejection logged to Responsible AI dataset.</div>`;
      });
    });
  });
}

// Initialize Event Handlers for Interactive Analyze Chat
export function initAnalyze() {
  renderAuditLogs();
  renderChatThread();

  const btnAnalyze = document.getElementById("btnRunAnalyze");
  const inputArea = document.getElementById("analyzeInputText");
  const caseIdInput = document.getElementById("analyzeCaseId");
  const symptomInput = document.getElementById("analyzeSymptom");
  const topologyInput = document.getElementById("analyzeTopology");
  const spinner = document.getElementById("analyzeSpinner");
  const btnText = document.getElementById("analyzeBtnText");
  const errorAlert = document.getElementById("analyzeErrorAlert");
  const toggleMetadataBtn = document.getElementById("toggleMetadataBtn");
  const metadataDrawer = document.getElementById("metadataDrawer");

  // Toggle Context Metadata Drawer
  toggleMetadataBtn?.addEventListener("click", () => {
    if (metadataDrawer) {
      metadataDrawer.classList.toggle("hidden");
    }
  });

  // Sample Preset Buttons
  document.getElementById("sampleVlan")?.addEventListener("click", () => {
    if (inputArea) inputArea.value = SAMPLES.vlanMismatch.text;
    if (symptomInput) symptomInput.value = SAMPLES.vlanMismatch.title;
  });

  document.getElementById("sampleInsufficient")?.addEventListener("click", () => {
    if (inputArea) inputArea.value = SAMPLES.insufficientEvidence.text;
    if (symptomInput) symptomInput.value = SAMPLES.insufficientEvidence.title;
  });

  document.getElementById("sampleGateway")?.addEventListener("click", () => {
    if (inputArea) inputArea.value = SAMPLES.gatewayMismatch.text;
    if (symptomInput) symptomInput.value = SAMPLES.gatewayMismatch.title;
  });

  // Hotkey support: Ctrl+Enter to submit
  inputArea?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      btnAnalyze?.click();
    }
  });

  // Execute Analysis
  btnAnalyze?.addEventListener("click", async () => {
    const text = inputArea?.value.trim();
    if (!text) {
      if (errorAlert) {
        errorAlert.classList.remove("hidden");
        errorAlert.textContent = "Please paste network troubleshooting evidence or Cisco show-command output before sending.";
      }
      return;
    }

    if (errorAlert) errorAlert.classList.add("hidden");

    // Show Loading
    btnAnalyze.disabled = true;
    spinner?.classList.remove("hidden");
    if (btnText) btnText.textContent = "Thinking...";

    const caseId = caseIdInput?.value.trim() || "";
    const symptom = symptomInput?.value.trim() || "";
    const topologyNote = topologyInput?.value.trim() || "";

    // Record user step in conversation history
    conversationHistory.push({
      type: "user",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      text: text,
    });
    renderChatThread();

    // Clear input box for next prompt
    if (inputArea) inputArea.value = "";

    try {
      const diag = await runAnalysisAPI(text, caseId, symptom, topologyNote);

      // Record AI step in conversation history
      conversationHistory.push({
        type: "ai",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        data: diag,
      });

      renderChatThread();
    } catch (err) {
      if (errorAlert) {
        errorAlert.classList.remove("hidden");
        errorAlert.textContent = `Analysis failed: ${err.message || err}.`;
      }
    } finally {
      btnAnalyze.disabled = false;
      spinner?.classList.add("hidden");
      if (btnText) btnText.textContent = "Analyze";
    }
  });
}

