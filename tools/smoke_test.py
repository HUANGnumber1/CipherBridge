#!/usr/bin/env python3
# FHE-API 端到端冒烟测试：generate_keys → get_public_key → encrypt → compute → decrypt
# 用 python3 标准库 urllib，无需额外依赖。日志 stdout（重定向到 /tmp/smoke_test.log）
import json, time, sys
import urllib.request

FHE = 'http://127.0.0.1:3000'

def post(path, obj):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(FHE + path, data=data,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode())

def main():
    pk = '0xSmoke' + str(int(time.time()))
    gk = post('/generate_keys', {'public_key': pk})
    print('generate_keys   ok, fhe_public_key len =', len(gk['fhe_public_key']))
    pub = post('/get_public_key', {'public_key': pk})
    print('get_public_key  ok, fhe_public_key len =', len(pub['fhe_public_key']))
    vals = [10, 20, 30]
    enc = [post('/encrypt', {'public_key': pk, 'data_type': 'int8', 'value': v})['encrypted_value']
           for v in vals]
    print('encrypt         ok,', len(enc), 'ciphertexts')
    res = post('/compute', {'public_key': pk, 'task_id': 'smoke',
                            'data_type': 'int8', 'encrypted_values': enc})['result']
    print('compute         ok')
    dec = post('/decrypt', {'public_key': pk, 'data_type': 'int8', 'encrypted_value': res})
    print('decrypt         value =', dec['value'], '(expected', sum(vals), ')')
    assert dec['value'] == sum(vals), 'SUM MISMATCH'
    print('SMOKE TEST PASSED')
    return 0

if __name__ == '__main__':
    sys.exit(main())
