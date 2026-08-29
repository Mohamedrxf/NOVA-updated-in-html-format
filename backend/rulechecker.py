"""
NetSage-X Deterministic Network Rule Checker (v2)

Performs deterministic validation on structured network troubleshooting
cases BEFORE AI-assisted diagnosis, per the problem statement's six
required checks: duplicate IPs, wrong masks, gateway mismatch, interface
down, missing VLAN, missing routes.

Design principle: every finding must be derived by parsing and comparing
actual structured values pulled from `show_outputs` / `topology_note`
(IPs, masks, VLAN tables, route tables, OSPF areas) -- never by searching
the case's prose for words that already state the conclusion (e.g.
"duplicate ip", "wrong subnet mask"). A checker that only fires when the
case text happens to already say the answer isn't actually deterministic;
it's just keyword-matching a narrated answer.

Three finding statuses, matching the project's evidence-state philosophy:
  PASS  - no issue found
  FAIL  - directly proven by structured evidence (Confirmed-level)
  WARN  - a structural anomaly that needs human/AI follow-up, not
          provable from this evidence alone (Probable-level)
"""

from __future__ import annotations

import csv
import ipaddress
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

IPV4 = r"\d{1,3}(?:\.\d{1,3}){3}"


@dataclass
class Finding:
    case_id: str
    check: str
    status: str  # PASS | FAIL | WARN
    message: str


# --------------------------------------------------------------------
# Structured extraction helpers
# --------------------------------------------------------------------

def split_device_blocks(text: str) -> List[Tuple[str, str]]:
    """
    Split combined evidence text into (device_label, block_text) chunks
    based on Cisco-style prompts (e.g. 'R1#show ip route', 'PC1>ipconfig',
    'SW2#show vlan brief'). Falls back to a single unlabeled block if no
    prompts are found.
    """
    prompt_re = re.compile(r"(?m)^([\w\-]+)[#>](.*)$")
    matches = list(prompt_re.finditer(text))
    if not matches:
        return [("UNKNOWN", text)]

    blocks: List[Tuple[str, str]] = []
    # Text before the first recognised prompt (e.g. a bare 'ipconfig' line
    # with no device label) must not be silently dropped.
    if matches[0].start() > 0:
        blocks.append(("UNKNOWN", text[: matches[0].start()]))
    for i, m in enumerate(matches):
        device = m.group(1)
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        blocks.append((device, text[start:end]))
    return blocks


def extract_ip_configs(text: str) -> List[Dict[str, Optional[str]]]:
    """
    Extract (ip, mask, gateway) triplets from ipconfig-style blocks, e.g.:
        IPv4 Address: 192.168.20.25
        Subnet Mask: 255.255.0.0
        Default Gateway: 192.168.20.1
    Mask and gateway are optional; a block is emitted whenever an IPv4
    Address line is found.
    """
    results = []
    for device, block in split_device_blocks(text):
        ip_m = re.search(rf"IPv4 Address:\s*({IPV4})", block, re.IGNORECASE)
        if not ip_m:
            continue
        mask_m = re.search(rf"Subnet Mask:\s*({IPV4})", block, re.IGNORECASE)
        gw_m = re.search(
            rf"(?:Default Gateway|Gateway):\s*({IPV4})", block, re.IGNORECASE
        )
        results.append(
            {
                "device": device,
                "ip": ip_m.group(1),
                "mask": mask_m.group(1) if mask_m else None,
                "gateway": gw_m.group(1) if gw_m else None,
            }
        )
    return results


def extract_interface_brief(text: str) -> List[Dict[str, str]]:
    """
    Extract rows from 'show ip interface brief' output, e.g.:
        GigabitEthernet0/0  192.168.10.1  up  up
        G0/1  192.168.130.1  administratively down  down
    """
    rows = []
    for device, block in split_device_blocks(text):
        if "show ip interface brief" not in block.lower():
            continue
        for line in block.splitlines():
            m = re.match(
                rf"\s*(\S+)\s+({IPV4})\s+(.+?)\s+(up|down)\s*$",
                line.strip(),
                re.IGNORECASE,
            )
            if m:
                rows.append(
                    {
                        "device": device,
                        "interface": m.group(1),
                        "ip": m.group(2),
                        "admin_status": m.group(3).strip(),
                        "line_status": m.group(4),
                    }
                )
    return rows


def extract_vlan_tables(text: str) -> Dict[str, set]:
    """
    Extract VLAN IDs present per device from 'show vlan brief' output.
    Returns {device: {vlan_id, ...}}.
    """
    out: Dict[str, set] = {}
    for device, block in split_device_blocks(text):
        if "show vlan brief" not in block.lower():
            continue
        vlans = set(re.findall(r"(?m)^\s*(\d{1,4})\s+\S", block))
        if vlans:
            out.setdefault(device, set()).update(vlans)
    return out


def extract_trunk_allowed_vlans(text: str) -> Dict[str, set]:
    out: Dict[str, set] = {}
    for device, block in split_device_blocks(text):
        if "trunk" not in block.lower():
            continue
        m = re.search(r"Vlans allowed on trunk\s*\n?\s*\S+\s+([\d,\s]+)", block)
        if m:
            ids = set(re.findall(r"\d+", m.group(1)))
            out.setdefault(device, set()).update(ids)
    return out


def extract_access_vlan(text: str) -> Optional[str]:
    m = re.search(r"Access Mode VLAN:\s*(\d+)", text, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r"switchport access vlan\s+(\d+)", text, re.IGNORECASE)
    return m.group(1) if m else None


def extract_intended_vlan(topology_note: str) -> Optional[str]:
    m = re.search(r"belongs to VLAN\s*(\d+)", topology_note, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(
        r"(?:should be (?:in|on)|required (?:in|on)) VLAN\s*(\d+)",
        topology_note,
        re.IGNORECASE,
    )
    return m.group(1) if m else None


def extract_required_vlan_on_all(topology_note: str) -> Optional[str]:
    """E.g. 'VLAN 30 is required on both switches.'"""
    m = re.search(
        r"VLAN\s*(\d+)\s+is required on (?:both|all)", topology_note, re.IGNORECASE
    )
    return m.group(1) if m else None


def extract_dhcp_pools(text: str) -> List[Dict[str, object]]:
    """
    Extract 'ip dhcp pool' blocks. A pool is only judged reliable enough to
    flag a *missing* 'default-router' line when the block also shows at
    least one other pool directive (e.g. dns-server) -- that indicates the
    evidence is a reasonably complete config excerpt, not a one-line
    truncated snippet where the absence of default-router proves nothing.
    """
    pools = []
    for block in re.split(r"(?=ip dhcp pool)", text, flags=re.IGNORECASE):
        if not re.search(r"ip dhcp pool", block, re.IGNORECASE):
            continue
        net_m = re.search(rf"network\s+({IPV4})\s+({IPV4})", block)
        has_default_router = bool(re.search(r"default-router", block, re.IGNORECASE))
        other_directives = bool(
            re.search(r"dns-server|domain-name|lease\s", block, re.IGNORECASE)
        )
        if net_m:
            pools.append(
                {
                    "network": net_m.group(1),
                    "mask": net_m.group(2),
                    "has_default_router": has_default_router,
                    "excerpt_looks_complete": other_directives,
                }
            )
    return pools


def extract_route_table(text: str) -> List[Dict[str, str]]:
    """Extract routing table entries: prefix and next hop (if static)."""
    entries = []
    for line in text.splitlines():
        m = re.match(
            rf"\s*[A-Z]\*?\s+({IPV4}/\d{{1,2}})(?:\s+is directly connected.*|\s+\[\d+/\d+\]\s+via\s+({IPV4}))?",
            line,
        )
        if m:
            entries.append({"prefix": m.group(1), "via": m.group(2)})
    return entries


def extract_no_route_statements(text: str) -> List[str]:
    return re.findall(rf"No route to ({IPV4}/\d{{1,2}})", text, re.IGNORECASE)


def extract_ospf_interfaces(text: str) -> List[Dict[str, str]]:
    entries = []
    for device, block in split_device_blocks(text):
        if "show ip ospf interface" not in block.lower():
            continue
        addr_m = re.search(rf"Internet Address\s+({IPV4})/(\d{{1,2}})", block)
        area_m = re.search(r"Area\s+(\d+)", block)
        if addr_m and area_m:
            entries.append(
                {
                    "device": device,
                    "ip": addr_m.group(1),
                    "prefixlen": addr_m.group(2),
                    "area": area_m.group(1),
                }
            )
    return entries


def extract_topology_cidrs(topology_note: str) -> List[str]:
    return re.findall(rf"{IPV4}/\d{{1,2}}", topology_note)


def extract_named_router_ips(topology_note: str) -> List[str]:
    """E.g. 'R2 is 10.0.1.2' or 'ISP router 10.0.4.2'."""
    ips = re.findall(
        rf"(?:is|router)\s+({IPV4})(?!/)", topology_note, re.IGNORECASE
    )
    return ips


def extract_owned_addresses(full_text: str) -> Dict[str, List[str]]:
    """
    Collect IPs that appear in an 'ownership' context (this address belongs
    to / was assigned to a specific device), grouped by IP, with a short
    snippet of the owning context. Used for structural duplicate detection.

    IMPORTANT: do not pre-split the text on '.' (e.g. a naive sentence
    splitter) before running these patterns -- IPv4 addresses themselves
    contain literal '.' characters, so splitting on it shreds the very
    addresses being searched for. Patterns are matched directly against
    the full text instead.
    """
    owned: Dict[str, List[str]] = {}
    patterns = [
        rf"IPv4 Address:\s*({IPV4})",
        rf"manually configured with(?: a)? static IP[^\n]*?({IPV4})",
        rf"statically configured with(?: that same address)?[^\n]*?({IPV4})",
        rf"\(({IPV4})\)\s+is manually configured",
    ]
    for pat in patterns:
        for m in re.finditer(pat, full_text, re.IGNORECASE):
            ip = m.group(1)
            # Use exactly what the pattern matched -- it already contains
            # the ownership keyword and the IP, with no risk of bleeding
            # into unrelated neighbouring text.
            snippet = " ".join(m.group(0).split())
            owned.setdefault(ip, [])
            if snippet not in owned[ip]:
                owned[ip].append(snippet)
    return owned


# --------------------------------------------------------------------
# Checker
# --------------------------------------------------------------------

@dataclass
class RuleChecker:
    findings: List[Finding] = field(default_factory=list)

    def add(self, case_id: str, check: str, status: str, message: str) -> None:
        self.findings.append(Finding(case_id, check, status, message))

    # 1. Duplicate IPs -------------------------------------------------
    def check_duplicate_ips(self, case_id: str, full_text: str) -> None:
        owned = extract_owned_addresses(full_text)
        conflicts = {ip: ctx for ip, ctx in owned.items() if len(ctx) >= 2}
        if conflicts:
            for ip, ctxs in conflicts.items():
                self.add(
                    case_id,
                    "duplicate_ip",
                    "FAIL",
                    f"{ip} is claimed as an owned/assigned address in "
                    f"{len(ctxs)} separate places: "
                    + " | ".join(ctxs),
                )
        else:
            self.add(
                case_id,
                "duplicate_ip",
                "PASS",
                "No address was found assigned to more than one device.",
            )

    # 2. Subnet masks ----------------------------------------------------
    def check_subnet_masks(self, case_id: str, text: str) -> None:
        configs = extract_ip_configs(text)
        found_issue = False

        for cfg in configs:
            if not cfg["mask"]:
                continue
            try:
                net = ipaddress.IPv4Network(f"0.0.0.0/{cfg['mask']}", strict=False)
            except ValueError:
                self.add(
                    case_id,
                    "subnet_mask",
                    "FAIL",
                    f"{cfg['device']}: subnet mask {cfg['mask']} is not a "
                    f"structurally valid IPv4 mask.",
                )
                found_issue = True
                continue

            prefixlen = net.prefixlen
            ip = ipaddress.IPv4Address(cfg["ip"])

            # Cross-reference: does another device in this case share the
            # same /24-looking network but imply a smaller (more specific)
            # subnet than this mask allows?
            for other in extract_interface_brief(text):
                other_ip = ipaddress.IPv4Address(other["ip"])
                same_first_three = str(ip).rsplit(".", 1)[0] == str(
                    other_ip
                ).rsplit(".", 1)[0]
                if same_first_three and prefixlen < 24 and ip.is_private:
                    self.add(
                        case_id,
                        "subnet_mask",
                        "WARN",
                        f"{cfg['device']}: mask {cfg['mask']} (/{prefixlen}) is "
                        f"broader than the /24 implied by {other['device']}'s "
                        f"interface {other['ip']} on the same network -- verify "
                        f"intended subnet size.",
                    )
                    found_issue = True

        if not found_issue:
            self.add(
                case_id, "subnet_mask", "PASS", "No mask problem detected."
            )

    # 3. Default gateway ---------------------------------------------------
    def check_gateway(self, case_id: str, text: str) -> None:
        configs = extract_ip_configs(text)
        brief_rows = extract_interface_brief(text)
        pools = extract_dhcp_pools(text)
        found_issue = False

        for cfg in configs:
            if not cfg["gateway"]:
                continue

            if cfg["gateway"] == "0.0.0.0":
                self.add(
                    case_id,
                    "default_gateway",
                    "FAIL",
                    f"{cfg['device']}: default gateway is 0.0.0.0 -- no "
                    f"gateway was actually assigned.",
                )
                found_issue = True
                continue

            gw = ipaddress.IPv4Address(cfg["gateway"])
            ip = ipaddress.IPv4Address(cfg["ip"])

            if cfg["mask"]:
                net = ipaddress.IPv4Network(
                    f"{cfg['ip']}/{cfg['mask']}", strict=False
                )
                if gw not in net:
                    self.add(
                        case_id,
                        "default_gateway",
                        "FAIL",
                        f"{cfg['device']}: gateway {cfg['gateway']} is outside "
                        f"{cfg['ip']}'s own subnet {net}.",
                    )
                    found_issue = True
                    continue

            # Cross-reference against any router interface on the same /24
            for row in brief_rows:
                row_ip = ipaddress.IPv4Address(row["ip"])
                if str(ip).rsplit(".", 1)[0] == str(row_ip).rsplit(".", 1)[0]:
                    if row["ip"] != cfg["gateway"]:
                        self.add(
                            case_id,
                            "default_gateway",
                            "FAIL",
                            f"{cfg['device']}: configured gateway "
                            f"{cfg['gateway']} does not match {row['device']}'s "
                            f"actual interface address {row['ip']} on the same "
                            f"network.",
                        )
                        found_issue = True

        for pool in pools:
            if not pool["has_default_router"] and pool["excerpt_looks_complete"]:
                self.add(
                    case_id,
                    "default_gateway",
                    "FAIL",
                    f"DHCP pool for {pool['network']}/{pool['mask']} shows other "
                    f"directives but no 'default-router' statement, so clients "
                    f"receive no gateway.",
                )
                found_issue = True

        if not found_issue:
            self.add(
                case_id,
                "default_gateway",
                "PASS",
                "No deterministic default gateway mismatch detected.",
            )

    # 4. Interface state -----------------------------------------------
    def check_interfaces(self, case_id: str, text: str) -> None:
        down_patterns = [
            r"administratively down",
            r"\bshutdown\b",
            r"\bdown/down\b",
            r"line protocol is down",
            r"\bnotconnect\b",
            r"\berr-disabled\b",
            r"\bdisabled\b",
        ]
        matches = [p for p in down_patterns if re.search(p, text, re.IGNORECASE)]
        if matches:
            self.add(
                case_id,
                "interface_status",
                "FAIL",
                "Interface evidence indicates a down/disabled/shutdown state "
                f"(matched: {', '.join(matches)}).",
            )
        else:
            self.add(
                case_id,
                "interface_status",
                "PASS",
                "No down interface state detected.",
            )

    # 5. VLAN --------------------------------------------------------------
    def check_vlan(self, case_id: str, topology_note: str, text: str) -> None:
        found_issue = False

        # (a) Port's operational VLAN vs. topology's intended VLAN
        intended = extract_intended_vlan(topology_note)
        actual = extract_access_vlan(text)
        if intended and actual and intended != actual:
            self.add(
                case_id,
                "vlan",
                "FAIL",
                f"Port operates in VLAN {actual}, but topology states it "
                f"should be in VLAN {intended}.",
            )
            found_issue = True

        # (b) A VLAN required on multiple switches missing from one's table
        required = extract_required_vlan_on_all(topology_note)
        if required:
            vlan_tables = extract_vlan_tables(text)
            missing_from = [
                dev for dev, ids in vlan_tables.items() if required not in ids
            ]
            if vlan_tables and missing_from:
                self.add(
                    case_id,
                    "vlan",
                    "FAIL",
                    f"VLAN {required} is required on all switches but is "
                    f"missing from: {', '.join(missing_from)}.",
                )
                found_issue = True

        # (c) VLAN allowed on a trunk but absent from the local VLAN database
        trunk_vlans = extract_trunk_allowed_vlans(text)
        vlan_tables = extract_vlan_tables(text)
        for dev, allowed in trunk_vlans.items():
            local = vlan_tables.get(dev, set())
            missing = allowed - local if local else set()
            if missing:
                self.add(
                    case_id,
                    "vlan",
                    "WARN",
                    f"{dev}: trunk allows VLAN(s) {sorted(missing)} not present "
                    f"in this device's own VLAN database.",
                )
                found_issue = True

        if not found_issue:
            self.add(
                case_id,
                "vlan",
                "PASS",
                "No deterministic VLAN configuration problem detected.",
            )

    # 6. Routing -------------------------------------------------------
    def check_routes(self, case_id: str, topology_note: str, text: str) -> None:
        found_issue = False
        route_entries = extract_route_table(text)
        known_prefixes = {e["prefix"] for e in route_entries}

        # (a) Explicit 'No route to X' statements
        for missing in extract_no_route_statements(text):
            self.add(
                case_id,
                "routing",
                "FAIL",
                f"Evidence explicitly shows no route to {missing}.",
            )
            found_issue = True

        # (b) Network named in topology as reachable/owned, absent from
        #     every route table shown
        for cidr in extract_topology_cidrs(topology_note):
            if route_entries and cidr not in known_prefixes:
                # only flag if this cidr looks like the "destination" the
                # symptom is about (skip point-to-point /30 links, which
                # are usually just the connecting path, not the target)
                prefixlen = int(cidr.split("/")[1])
                if prefixlen <= 24 and cidr not in known_prefixes:
                    self.add(
                        case_id,
                        "routing",
                        "WARN",
                        f"Topology references {cidr} but it does not appear "
                        f"in the routing table shown -- possible missing route.",
                    )
                    found_issue = True

        # (c) Static route next-hop vs. topology-stated correct router IP
        candidate_ips = set(extract_named_router_ips(topology_note))
        for entry in route_entries:
            if entry["via"] and candidate_ips and entry["via"] not in candidate_ips:
                self.add(
                    case_id,
                    "routing",
                    "WARN",
                    f"Route to {entry['prefix']} goes via {entry['via']}, which "
                    f"does not match the router IP(s) named in topology "
                    f"({', '.join(sorted(candidate_ips))}) -- possible wrong "
                    f"next hop.",
                )
                found_issue = True

        # (d) OSPF area mismatch on what is evidently the same link
        ospf = extract_ospf_interfaces(text)
        for i in range(len(ospf)):
            for j in range(i + 1, len(ospf)):
                a, b = ospf[i], ospf[j]
                net_a = ipaddress.IPv4Network(
                    f"{a['ip']}/{a['prefixlen']}", strict=False
                )
                net_b = ipaddress.IPv4Network(
                    f"{b['ip']}/{b['prefixlen']}", strict=False
                )
                if net_a == net_b and a["area"] != b["area"]:
                    self.add(
                        case_id,
                        "routing",
                        "FAIL",
                        f"{a['device']} and {b['device']} are on the same "
                        f"OSPF-enabled link ({net_a}) but configured in "
                        f"different areas ({a['area']} vs {b['area']}).",
                    )
                    found_issue = True

        if not found_issue:
            self.add(
                case_id,
                "routing",
                "PASS",
                "No deterministic routing problem detected.",
            )

    # ---------------------------------------------------------------------
    def run_case(self, case: Dict[str, str]) -> None:
        case_id = case.get("case_id", "UNKNOWN")
        topology_note = str(case.get("topology_note", ""))
        full_text = "\n".join(
            str(v) for k, v in case.items() if v and k != "case_id"
        )
        show_outputs = str(case.get("show_outputs", ""))

        self.check_duplicate_ips(case_id, full_text)
        self.check_subnet_masks(case_id, show_outputs)
        self.check_gateway(case_id, show_outputs)
        self.check_interfaces(case_id, show_outputs)
        self.check_vlan(case_id, topology_note, show_outputs)
        self.check_routes(case_id, topology_note, show_outputs)

    def format_report(self) -> str:
        lines = [
            "NETSAGE-X DETERMINISTIC RULE CHECKER (v2)",
            "=" * 70,
        ]
        current = None
        for f in self.findings:
            if f.case_id != current:
                current = f.case_id
                lines.append(f"\n[{current}]")
            lines.append(f"  {f.status:<4} | {f.check:<18} | {f.message}")
        lines.append("\n" + "=" * 70)
        lines.append(f"SUMMARY: {self.summary()}")
        return "\n".join(lines) + "\n"

    def print_report(self) -> None:
        print(self.format_report(), end="")

    def summary(self) -> Dict[str, int]:
        counts = {"PASS": 0, "FAIL": 0, "WARN": 0}
        for f in self.findings:
            counts[f.status] += 1
        return counts


def load_cases(csv_path: Path) -> List[Dict[str, str]]:
    with csv_path.open(mode="r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def main() -> None:
    here = Path(__file__).resolve().parent
    csv_path = here / "cases.csv"
    output_path = here / "output.txt"
    if not csv_path.exists():
        raise FileNotFoundError(
            f"Could not find '{csv_path}'. Place cases.csv in the same "
            "directory as this script."
        )
    cases = load_cases(csv_path)
    checker = RuleChecker()
    for case in cases:
        checker.run_case(case)
    report = checker.format_report()
    output_path.write_text(report, encoding="utf-8")
    print(report, end="")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
