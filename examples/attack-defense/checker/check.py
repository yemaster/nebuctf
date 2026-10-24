"""Trusted checker contract: 0 success, 1 service/check failure, 2 checker error."""
import hashlib
import os
import sys
import time
import urllib.error
import urllib.request

base = 'http://' + os.environ['TARGET_HOST'] + ':' + os.environ['TARGET_PORT']
mode = os.environ['CHECK_MODE']
expected = os.environ['EXPECTED_FLAG']
deadline = time.monotonic() + int(os.environ.get('CHECK_TIMEOUT', '15'))


def read(path):
    with urllib.request.urlopen(base + path, timeout=1) as response:
        return response.read(1024).decode()


while time.monotonic() < deadline:
    try:
        if read('/health') != 'ok':
            sys.exit(1)
        if read('/checksum') != hashlib.sha256(expected.encode()).hexdigest():
            sys.exit(1)
        break
    except (OSError, urllib.error.URLError):
        time.sleep(.2)
else:
    sys.exit(1)

if mode == 'defense':
    try:
        read('/leak')
        sys.exit(1)
    except urllib.error.HTTPError as error:
        sys.exit(0 if error.code == 403 else 1)
elif mode in ('functional', 'availability'):
    sys.exit(0)
else:
    sys.exit(2)
