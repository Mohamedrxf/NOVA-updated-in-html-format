import urllib.request, json

# Health check
req = urllib.request.urlopen('http://localhost:8000/api/v1/health')
print('Health:', json.loads(req.read()))

# Diagnose: gateway mismatch (rule-checker-only fallback since no LLM key)
payload = json.dumps({
    'case_id': 'TEST-GW',
    'symptom': 'PC cannot reach gateway',
    'topology_note': '',
    'show_command_outputs': {'raw': (
        'IPv4 Address: 192.168.30.10\n'
        'Subnet Mask: 255.255.255.0\n'
        'Default Gateway: 192.168.20.1\n\n'
        'R1#show ip interface brief\n'
        'GigabitEthernet0/0.30      192.168.30.1    YES manual up                    up'
    )}
}).encode()

req2 = urllib.request.Request(
    'http://localhost:8000/api/v1/diagnose',
    data=payload,
    headers={'Content-Type': 'application/json'},
    method='POST'
)
resp = json.loads(urllib.request.urlopen(req2).read())
print('State:', resp['diagnosis_state'])
print('LLM assisted:', resp['llm_assisted'])
print('Root cause:', resp['suspected_root_cause'][:80])
print('Findings:')
for f in resp['rule_findings']:
    status = f['status']
    check = f['check']
    details = f['details'][:55]
    print(f'  [{status}] {check}: {details}')

# Test review logging
rev_payload = json.dumps({
    'diagnosis_id': 'diag-test-01',
    'case_id': 'TEST-GW',
    'root_cause': 'Corrected: wrong gateway',
    'original_ai_root_cause': resp['suspected_root_cause'],
    'original_ai_state': resp['diagnosis_state'],
    'status': resp['diagnosis_state'],
    'decision': 'EDITED',
    'verification': 'SUCCESS',
    'notes': 'Fixed gateway in Packet Tracer. Ping succeeded.',
    'is_responsible_ai_case': True
}).encode()

req3 = urllib.request.Request(
    'http://localhost:8000/api/v1/review',
    data=rev_payload,
    headers={'Content-Type': 'application/json'},
    method='POST'
)
rev_resp = json.loads(urllib.request.urlopen(req3).read())
print('\nReview:', rev_resp)
