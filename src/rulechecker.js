// ============================================================
// NetSage AI — Deterministic Rule Checker (JS port of v2)
// Performs structural evidence parsing for six checks:
//   duplicate_ip | subnet_mask | default_gateway |
//   interface_status | vlan | routing
// Status: PASS | FAIL | WARN
// ============================================================

const IPV4 = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;
const IPV4_RE = new RegExp(IPV4);

// ----------------------------------------------------------------
// Utility: IPv4 address/network helpers (pure JS, no library)
// ----------------------------------------------------------------

function ipToInt(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

function maskToPrefix(mask) {
  const n = ipToInt(mask);
  // Count leading 1-bits
  let bits = 0;
  for (let i = 31; i >= 0; i--) {
    if ((n >>> i) & 1) bits++;
    else break;
  }
  // Validate it's a contiguous mask
  const expected = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return n === expected ? bits : -1; // -1 = invalid
}

function prefixToMaskInt(prefixlen) {
  return prefixlen === 0 ? 0 : (0xffffffff << (32 - prefixlen)) >>> 0;
}

function networkAddress(ip, prefixlen) {
  return (ipToInt(ip) & prefixToMaskInt(prefixlen)) >>> 0;
}

function ipInNetwork(ip, networkIp, prefixlen) {
  const mask = prefixToMaskInt(prefixlen);
  return (ipToInt(ip) & mask) >>> 0 === (ipToInt(networkIp) & mask) >>> 0;
}

function networksEqual(ip1, prefix1, ip2, prefix2) {
  if (prefix1 !== prefix2) return false;
  return networkAddress(ip1, prefix1) === networkAddress(ip2, prefix2);
}

function isPrivate(ip) {
  const n = ipToInt(ip);
  return (
    (n >>> 24) === 10 ||
    ((n >>> 16) & 0xfff0) === 0xac10 || // 172.16–31
    (n >>> 16) === 0xc0a8               // 192.168
  );
}

// ----------------------------------------------------------------
// Extraction helpers
// ----------------------------------------------------------------

function splitDeviceBlocks(text) {
  const promptRe = /^([\w\-]+)[#>](.*)$/gm;
  const matches = [];
  let m;
  while ((m = promptRe.exec(text)) !== null) {
    matches.push({ device: m[1], index: m.index });
  }
  if (matches.length === 0) return [{ device: "UNKNOWN", block: text }];

  const blocks = [];
  if (matches[0].index > 0) {
    blocks.push({ device: "UNKNOWN", block: text.slice(0, matches[0].index) });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    blocks.push({ device: matches[i].device, block: text.slice(start, end) });
  }
  return blocks;
}

function extractIpConfigs(text) {
  const results = [];
  for (const { device, block } of splitDeviceBlocks(text)) {
    const ipM = block.match(new RegExp(`IPv4 Address:\\s*(${IPV4})`, "i"));
    if (!ipM) continue;
    const maskM = block.match(new RegExp(`Subnet Mask:\\s*(${IPV4})`, "i"));
    const gwM = block.match(new RegExp(`(?:Default Gateway|Gateway):\\s*(${IPV4})`, "i"));
    results.push({
      device,
      ip: ipM[1],
      mask: maskM ? maskM[1] : null,
      gateway: gwM ? gwM[1] : null,
    });
  }
  return results;
}

function extractInterfaceBrief(text) {
  const rows = [];
  for (const { device, block } of splitDeviceBlocks(text)) {
    if (!block.toLowerCase().includes("show ip interface brief")) continue;
    for (const line of block.split("\n")) {
      const m = line
        .trim()
        .match(new RegExp(`^(\\S+)\\s+(${IPV4})\\s+(.+?)\\s+(up|down)\\s*$`, "i"));
      if (m) {
        rows.push({
          device,
          interface: m[1],
          ip: m[2],
          admin_status: m[3].trim(),
          line_status: m[4],
        });
      }
    }
  }
  return rows;
}

function extractVlanTables(text) {
  const out = {};
  for (const { device, block } of splitDeviceBlocks(text)) {
    if (!block.toLowerCase().includes("show vlan brief")) continue;
    const vlans = new Set();
    for (const line of block.split("\n")) {
      const m = line.match(/^\s*(\d{1,4})\s+\S/);
      if (m) vlans.add(m[1]);
    }
    if (vlans.size > 0) {
      if (!out[device]) out[device] = new Set();
      for (const v of vlans) out[device].add(v);
    }
  }
  return out;
}

function extractTrunkAllowedVlans(text) {
  const out = {};
  for (const { device, block } of splitDeviceBlocks(text)) {
    if (!block.toLowerCase().includes("trunk")) continue;
    const m = block.match(/Vlans allowed on trunk\s*\n?\s*\S+\s+([\d,\s]+)/);
    if (m) {
      const ids = new Set(m[1].match(/\d+/g) || []);
      if (!out[device]) out[device] = new Set();
      for (const v of ids) out[device].add(v);
    }
  }
  return out;
}

function extractAccessVlan(text) {
  let m = text.match(/Access Mode VLAN:\s*(\d+)/i);
  if (m) return m[1];
  m = text.match(/switchport access vlan\s+(\d+)/i);
  return m ? m[1] : null;
}

function extractIntendedVlan(topologyNote) {
  let m = topologyNote.match(/belongs to VLAN\s*(\d+)/i);
  if (m) return m[1];
  m = topologyNote.match(/(?:should be (?:in|on)|required (?:in|on)) VLAN\s*(\d+)/i);
  return m ? m[1] : null;
}

function extractRequiredVlanOnAll(topologyNote) {
  const m = topologyNote.match(/VLAN\s*(\d+)\s+is required on (?:both|all)/i);
  return m ? m[1] : null;
}

function extractDhcpPools(text) {
  const pools = [];
  const parts = text.split(/(?=ip dhcp pool)/i);
  for (const block of parts) {
    if (!/ip dhcp pool/i.test(block)) continue;
    const netM = block.match(new RegExp(`network\\s+(${IPV4})\\s+(${IPV4})`));
    const hasDefaultRouter = /default-router/i.test(block);
    const otherDirectives = /dns-server|domain-name|lease\s/i.test(block);
    if (netM) {
      pools.push({
        network: netM[1],
        mask: netM[2],
        has_default_router: hasDefaultRouter,
        excerpt_looks_complete: otherDirectives,
      });
    }
  }
  return pools;
}

function extractRouteTable(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    const m = line.match(
      new RegExp(
        `^\\s*[A-Z]\\*?\\s+(${IPV4}/\\d{1,2})(?:\\s+is directly connected.*|\\s+\\[\\d+/\\d+\\]\\s+via\\s+(${IPV4}))?`
      )
    );
    if (m) {
      entries.push({ prefix: m[1], via: m[2] || null });
    }
  }
  return entries;
}

function extractNoRouteStatements(text) {
  const found = [];
  const re = new RegExp(`No route to (${IPV4}/\\d{1,2})`, "gi");
  let m;
  while ((m = re.exec(text)) !== null) found.push(m[1]);
  return found;
}

function extractOspfInterfaces(text) {
  const entries = [];
  for (const { device, block } of splitDeviceBlocks(text)) {
    if (!block.toLowerCase().includes("show ip ospf interface")) continue;
    const addrM = block.match(new RegExp(`Internet Address\\s+(${IPV4})/(\\d{1,2})`));
    const areaM = block.match(/Area\s+(\d+)/);
    if (addrM && areaM) {
      entries.push({
        device,
        ip: addrM[1],
        prefixlen: parseInt(addrM[2], 10),
        area: areaM[1],
      });
    }
  }
  return entries;
}

function extractTopologyCidrs(topologyNote) {
  return (topologyNote.match(new RegExp(`${IPV4}/\\d{1,2}`, "g")) || []);
}

function extractNamedRouterIps(topologyNote) {
  const re = new RegExp(`(?:is|router)\\s+(${IPV4})(?!/)`, "gi");
  const ips = [];
  let m;
  while ((m = re.exec(topologyNote)) !== null) ips.push(m[1]);
  return ips;
}

function extractOwnedAddresses(fullText) {
  const owned = {};
  const patterns = [
    new RegExp(`IPv4 Address:\\s*(${IPV4})`, "gi"),
    new RegExp(`manually configured with(?: a)? static IP[^\\n]*?(${IPV4})`, "gi"),
    new RegExp(`statically configured with(?: that same address)?[^\\n]*?(${IPV4})`, "gi"),
    new RegExp(`\\((${IPV4})\\)\\s+is manually configured`, "gi"),
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(fullText)) !== null) {
      const ip = m[1];
      const snippet = m[0].replace(/\s+/g, " ").trim();
      if (!owned[ip]) owned[ip] = [];
      if (!owned[ip].includes(snippet)) owned[ip].push(snippet);
    }
  }
  return owned;
}

// ----------------------------------------------------------------
// The six checks
// ----------------------------------------------------------------

function checkDuplicateIps(caseId, fullText) {
  const owned = extractOwnedAddresses(fullText);
  const findings = [];
  let found = false;
  for (const [ip, ctxs] of Object.entries(owned)) {
    if (ctxs.length >= 2) {
      findings.push({
        rule_id: "DUPLICATE_IP",
        check: "Duplicate IP Allocation",
        status: "FAIL",
        details: `${ip} is claimed as an owned/assigned address in ${ctxs.length} separate places: ${ctxs.join(" | ")}`,
      });
      found = true;
    }
  }
  if (!found) {
    findings.push({
      rule_id: "DUPLICATE_IP",
      check: "Duplicate IP Allocation",
      status: "PASS",
      details: "No address was found assigned to more than one device.",
    });
  }
  return findings;
}

function checkSubnetMasks(caseId, text) {
  const configs = extractIpConfigs(text);
  const briefRows = extractInterfaceBrief(text);
  const findings = [];
  let found = false;

  for (const cfg of configs) {
    if (!cfg.mask) continue;
    const prefixlen = maskToPrefix(cfg.mask);
    if (prefixlen === -1) {
      findings.push({
        rule_id: "SUBNET_MASK",
        check: "Subnet Mask Validation",
        status: "FAIL",
        details: `${cfg.device}: subnet mask ${cfg.mask} is not a structurally valid IPv4 mask.`,
      });
      found = true;
      continue;
    }

    // Cross-reference: does another device share same /24 but this mask is broader?
    for (const row of briefRows) {
      const sameFirstThree =
        cfg.ip.split(".").slice(0, 3).join(".") ===
        row.ip.split(".").slice(0, 3).join(".");
      if (sameFirstThree && prefixlen < 24 && isPrivate(cfg.ip)) {
        findings.push({
          rule_id: "SUBNET_MASK",
          check: "Subnet Mask Validation",
          status: "WARN",
          details: `${cfg.device}: mask ${cfg.mask} (/${prefixlen}) is broader than the /24 implied by ${row.device}'s interface ${row.ip} on the same network — verify intended subnet size.`,
        });
        found = true;
      }
    }
  }

  if (!found) {
    findings.push({
      rule_id: "SUBNET_MASK",
      check: "Subnet Mask Validation",
      status: "PASS",
      details: "No mask problem detected.",
    });
  }
  return findings;
}

function checkGateway(caseId, text) {
  const configs = extractIpConfigs(text);
  const briefRows = extractInterfaceBrief(text);
  const pools = extractDhcpPools(text);
  const findings = [];
  let found = false;

  for (const cfg of configs) {
    if (!cfg.gateway) continue;

    if (cfg.gateway === "0.0.0.0") {
      findings.push({
        rule_id: "DEFAULT_GATEWAY",
        check: "Default Gateway Reachability",
        status: "FAIL",
        details: `${cfg.device}: default gateway is 0.0.0.0 — no gateway was actually assigned.`,
      });
      found = true;
      continue;
    }

    if (cfg.mask) {
      const prefixlen = maskToPrefix(cfg.mask);
      if (prefixlen >= 0 && !ipInNetwork(cfg.gateway, cfg.ip, prefixlen)) {
        findings.push({
          rule_id: "DEFAULT_GATEWAY",
          check: "Default Gateway Reachability",
          status: "FAIL",
          details: `${cfg.device}: gateway ${cfg.gateway} is outside ${cfg.ip}'s own subnet (/${prefixlen}).`,
        });
        found = true;
        continue;
      }
    }

    // Cross-reference against router interface on same /24
    for (const row of briefRows) {
      const sameFirstThree =
        cfg.ip.split(".").slice(0, 3).join(".") ===
        row.ip.split(".").slice(0, 3).join(".");
      if (sameFirstThree && row.ip !== cfg.gateway) {
        findings.push({
          rule_id: "DEFAULT_GATEWAY",
          check: "Default Gateway Reachability",
          status: "FAIL",
          details: `${cfg.device}: configured gateway ${cfg.gateway} does not match ${row.device}'s actual interface address ${row.ip} on the same network.`,
        });
        found = true;
      }
    }
  }

  for (const pool of pools) {
    if (!pool.has_default_router && pool.excerpt_looks_complete) {
      findings.push({
        rule_id: "DEFAULT_GATEWAY",
        check: "Default Gateway Reachability",
        status: "FAIL",
        details: `DHCP pool for ${pool.network}/${pool.mask} shows other directives but no 'default-router' statement, so clients receive no gateway.`,
      });
      found = true;
    }
  }

  if (!found) {
    findings.push({
      rule_id: "DEFAULT_GATEWAY",
      check: "Default Gateway Reachability",
      status: "PASS",
      details: "No deterministic default gateway mismatch detected.",
    });
  }
  return findings;
}

function checkInterfaces(caseId, text) {
  const downPatterns = [
    /administratively down/i,
    /\bshutdown\b/i,
    /\bdown\/down\b/i,
    /line protocol is down/i,
    /\bnotconnect\b/i,
    /\berr-disabled\b/i,
    /\bdisabled\b/i,
  ];
  const matched = downPatterns.filter((p) => p.test(text)).map((p) => p.source.replace(/\\b/g, "").replace(/\/i$/, ""));
  if (matched.length > 0) {
    return [
      {
        rule_id: "INTERFACE_STATUS",
        check: "Interface Physical / Line Status",
        status: "FAIL",
        details: `Interface evidence indicates a down/disabled/shutdown state (matched: ${matched.join(", ")}).`,
      },
    ];
  }
  return [
    {
      rule_id: "INTERFACE_STATUS",
      check: "Interface Physical / Line Status",
      status: "PASS",
      details: "No down interface state detected.",
    },
  ];
}

function checkVlan(caseId, topologyNote, text) {
  const findings = [];
  let found = false;

  // (a) Port operational VLAN vs. intended VLAN
  const intended = extractIntendedVlan(topologyNote);
  const actual = extractAccessVlan(text);
  if (intended && actual && intended !== actual) {
    findings.push({
      rule_id: "VLAN",
      check: "VLAN & Trunking Assignment",
      status: "FAIL",
      details: `Port operates in VLAN ${actual}, but topology states it should be in VLAN ${intended}.`,
    });
    found = true;
  }

  // (b) VLAN required on all switches but missing from one
  const required = extractRequiredVlanOnAll(topologyNote);
  if (required) {
    const vlanTables = extractVlanTables(text);
    const missingFrom = Object.entries(vlanTables)
      .filter(([, ids]) => !ids.has(required))
      .map(([dev]) => dev);
    if (Object.keys(vlanTables).length > 0 && missingFrom.length > 0) {
      findings.push({
        rule_id: "VLAN",
        check: "VLAN & Trunking Assignment",
        status: "FAIL",
        details: `VLAN ${required} is required on all switches but is missing from: ${missingFrom.join(", ")}.`,
      });
      found = true;
    }
  }

  // (c) VLAN allowed on trunk but absent from local VLAN DB
  const trunkVlans = extractTrunkAllowedVlans(text);
  const vlanTables = extractVlanTables(text);
  for (const [dev, allowed] of Object.entries(trunkVlans)) {
    const local = vlanTables[dev] || new Set();
    if (local.size === 0) continue;
    const missing = [...allowed].filter((v) => !local.has(v));
    if (missing.length > 0) {
      findings.push({
        rule_id: "VLAN",
        check: "VLAN & Trunking Assignment",
        status: "WARN",
        details: `${dev}: trunk allows VLAN(s) [${missing.sort().join(", ")}] not present in this device's own VLAN database.`,
      });
      found = true;
    }
  }

  if (!found) {
    findings.push({
      rule_id: "VLAN",
      check: "VLAN & Trunking Assignment",
      status: "PASS",
      details: "No deterministic VLAN configuration problem detected.",
    });
  }
  return findings;
}

function checkRoutes(caseId, topologyNote, text) {
  const findings = [];
  let found = false;
  const routeEntries = extractRouteTable(text);
  const knownPrefixes = new Set(routeEntries.map((e) => e.prefix));

  // (a) Explicit 'No route to X'
  for (const missing of extractNoRouteStatements(text)) {
    findings.push({
      rule_id: "ROUTING",
      check: "Routing Table & OSPF Verification",
      status: "FAIL",
      details: `Evidence explicitly shows no route to ${missing}.`,
    });
    found = true;
  }

  // (b) Topology CIDR absent from every route table
  for (const cidr of extractTopologyCidrs(topologyNote)) {
    const prefixlen = parseInt(cidr.split("/")[1], 10);
    if (routeEntries.length > 0 && prefixlen <= 24 && !knownPrefixes.has(cidr)) {
      findings.push({
        rule_id: "ROUTING",
        check: "Routing Table & OSPF Verification",
        status: "WARN",
        details: `Topology references ${cidr} but it does not appear in the routing table shown — possible missing route.`,
      });
      found = true;
    }
  }

  // (c) Static route next-hop vs topology-stated router IP
  const candidateIps = new Set(extractNamedRouterIps(topologyNote));
  for (const entry of routeEntries) {
    if (entry.via && candidateIps.size > 0 && !candidateIps.has(entry.via)) {
      findings.push({
        rule_id: "ROUTING",
        check: "Routing Table & OSPF Verification",
        status: "WARN",
        details: `Route to ${entry.prefix} goes via ${entry.via}, which does not match the router IP(s) named in topology (${[...candidateIps].sort().join(", ")}) — possible wrong next hop.`,
      });
      found = true;
    }
  }

  // (d) OSPF area mismatch on same link
  const ospf = extractOspfInterfaces(text);
  for (let i = 0; i < ospf.length; i++) {
    for (let j = i + 1; j < ospf.length; j++) {
      const a = ospf[i], b = ospf[j];
      if (networksEqual(a.ip, a.prefixlen, b.ip, b.prefixlen) && a.area !== b.area) {
        findings.push({
          rule_id: "ROUTING",
          check: "Routing Table & OSPF Verification",
          status: "FAIL",
          details: `${a.device} and ${b.device} are on the same OSPF-enabled link but configured in different areas (${a.area} vs ${b.area}).`,
        });
        found = true;
      }
    }
  }

  if (!found) {
    findings.push({
      rule_id: "ROUTING",
      check: "Routing Table & OSPF Verification",
      status: "PASS",
      details: "No deterministic routing problem detected.",
    });
  }
  return findings;
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Run all six deterministic checks against the provided evidence.
 * @param {string} showOutputs   - Raw CLI output / evidence text
 * @param {string} topologyNote  - Topology description string
 * @param {string} fullText      - Combined all-fields text (for duplicate IP check)
 * @returns {Array} findings     - Array of {rule_id, check, status, details}
 */
export function runRuleChecker(showOutputs = "", topologyNote = "", fullText = "") {
  const caseId = "live";
  const text = showOutputs;
  const combined = fullText || (showOutputs + " " + topologyNote);

  return [
    ...checkDuplicateIps(caseId, combined),
    ...checkSubnetMasks(caseId, text),
    ...checkGateway(caseId, text),
    ...checkInterfaces(caseId, text),
    ...checkVlan(caseId, topologyNote, text),
    ...checkRoutes(caseId, topologyNote, text),
  ];
}

/**
 * Summarise findings counts.
 * @param {Array} findings
 * @returns {{ PASS: number, FAIL: number, WARN: number }}
 */
export function summariseFindings(findings) {
  return findings.reduce(
    (acc, f) => { acc[f.status] = (acc[f.status] || 0) + 1; return acc; },
    { PASS: 0, FAIL: 0, WARN: 0 }
  );
}
