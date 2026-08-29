// ============================================================
// NetSage AI — static demo dataset (no backend / no API)
// Keep demo data separated from UI + chart rendering.
// ============================================================

export const kpis = [
  {
    label: "Total Cases",
    value: 30,
    suffix: "",
    desc: "Cisco-style lab scenarios analyzed",
    trend: "Full demo dataset",
    tone: "cyan",
    icon: "layers",
  },
  {
    label: "Verified Diagnoses",
    value: 24,
    suffix: "",
    desc: "Confirmed after human review",
    trend: "80% of all cases",
    tone: "emerald",
    icon: "check",
  },
  {
    label: "AI / Human Agreement",
    value: 83,
    suffix: "%",
    desc: "AI matched reviewer decision",
    trend: "25 of 30 cases",
    tone: "cyan",
    icon: "spark",
  },
  {
    label: "Human Corrections",
    value: 6,
    suffix: "",
    desc: "Edited or rejected by reviewer",
    trend: "Responsible-AI oversight",
    tone: "amber",
    icon: "pencil",
  },
];

export const faultCategories = [
  { label: "Routing", value: 6 },
  { label: "IP Addressing", value: 5 },
  { label: "VLAN / Trunking", value: 4 },
  { label: "DHCP", value: 4 },
  { label: "DNS", value: 4 },
  { label: "ACL", value: 4 },
  { label: "NAT", value: 3 },
  { label: "Wireless", value: 1 },
];

export const severity = [
  { label: "Critical", value: 3, color: "#f43f5e" },
  { label: "High", value: 20, color: "#22d3ee" },
  { label: "Medium", value: 6, color: "#f59e0b" },
  { label: "Low / Info", value: 1, color: "#64748b" },
];

export const reviewOutcomes = [
  { label: "Accepted", value: 18, color: "#34d399" },
  { label: "Edited", value: 4, color: "#f59e0b" },
  { label: "Rejected", value: 2, color: "#f43f5e" },
];

export const pipeline = [
  { step: "1", title: "Case Received", desc: "Symptoms + topology + show outputs", status: "COMPLETED", icon: "inbox" },
  { step: "2", title: "Rule Engine", desc: "Deterministic configuration checks", status: "COMPLETED", icon: "rules" },
  { step: "3", title: "AI Assessment", desc: "Candidate root cause", status: "COMPLETED", icon: "spark" },
  { step: "4", title: "Evidence Verification", desc: "Compare diagnosis against evidence", status: "COMPLETED", icon: "shield" },
  { step: "5", title: "Human Review", desc: "Accept / Edit / Reject", status: "IN REVIEW", icon: "user", emphasize: true },
  { step: "6", title: "Verified Diagnosis", desc: "Evidence-backed outcome", status: "PENDING", icon: "check" },
];

export const cases = [
  { id: "TC01", issue: "Wrong Default Gateway", category: "IP Addressing", layer: "Layer 3", ai: "Gateway mismatch", review: "Accepted", agreement: true, status: "Verified" },
  { id: "TC04", issue: "Missing VLAN", category: "VLAN / Trunking", layer: "Layer 2", ai: "VLAN configuration issue", review: "Edited", agreement: false, status: "Verified" },
  { id: "TC07", issue: "Interface Administratively Down", category: "Interface", layer: "Layer 1", ai: "Interface shutdown", review: "Accepted", agreement: true, status: "Verified" },
  { id: "TC20", issue: "OSPF Area Mismatch", category: "Routing", layer: "Layer 3", ai: "OSPF configuration mismatch", review: "Edited", agreement: false, status: "Verified" },
  { id: "TC23", issue: "ACL Denies Traffic", category: "ACL", layer: "Layer 4", ai: "ACL rule blocking traffic", review: "Accepted", agreement: true, status: "Verified" },
  { id: "TC30", issue: "Guest SSID Wrong VLAN", category: "Wireless", layer: "Layer 2", ai: "Wireless VLAN mapping issue", review: "Rejected", agreement: false, status: "Needs Review" },
];

export const reviewStates = [
  { label: "Accepted", value: 18, desc: "Human reviewer agrees with diagnosis.", tone: "emerald" },
  { label: "Edited", value: 4, desc: "Human reviewer corrected part of the diagnosis.", tone: "amber" },
  { label: "Rejected", value: 2, desc: "Human reviewer determined the AI diagnosis was incorrect.", tone: "rose" },
];

export const safetyPoints = [
  "AI does not override deterministic findings.",
  "Diagnoses must be supported by available evidence.",
  "Missing evidence is explicitly identified.",
  "Human review is required before accepting a fix.",
  "AI confidence must not be treated as certainty.",
  "Incorrect AI outputs are logged for responsible-AI analysis.",
];

// 3D topology graph — nodes + links + health status
export const topology = {
  nodes: [
    { id: "R1", label: "R1", type: "router", pos: [0, 2.4, 0] },
    { id: "R2", label: "R2", type: "router", pos: [3.2, 1.0, -1.2] },
    { id: "SW01", label: "SW-01", type: "switch", pos: [-0.4, 0.4, 0.6] },
    { id: "PC01", label: "PC-01", type: "pc", pos: [-3.0, -1.6, 1.0] },
    { id: "PC02", label: "PC-02", type: "pc", pos: [-2.2, -2.2, -1.4] },
    { id: "SERVER", label: "SERVER", type: "server", pos: [2.4, -1.8, 1.2] },
    { id: "AP01", label: "AP-01", type: "ap", pos: [-3.4, 1.4, -1.8] },
    { id: "N1", label: "", type: "node", pos: [1.2, -0.6, 2.2] },
    { id: "N2", label: "", type: "node", pos: [1.8, 2.0, 1.4] },
  ],
  links: [
    { a: "R1", b: "SW01", status: "healthy" },
    { a: "R1", b: "R2", status: "healthy" },
    { a: "SW01", b: "PC01", status: "fault" },
    { a: "SW01", b: "PC02", status: "healthy" },
    { a: "R2", b: "SERVER", status: "healthy" },
    { a: "SW01", b: "AP01", status: "investigating" },
    { a: "SW01", b: "N1", status: "healthy" },
    { a: "R1", b: "N2", status: "healthy" },
    { a: "N1", b: "SERVER", status: "investigating" },
  ],
};
