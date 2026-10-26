"""0: check passes; 1: service fails or exploit succeeds; 2: checker error."""
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
            sys.exit(2 if mode == 'defense' else 1)
        if read('/checksum') != hashlib.sha256(expected.encode()).hexdigest():
            sys.exit(2 if mode == 'defense' else 1)
        break
    except (OSError, urllib.error.URLError):
        time.sleep(.2)
else:
    sys.exit(2 if mode == 'defense' else 1)

if mode == 'defense':
    try:
        leaked = read('/leak')
        sys.exit(1 if leaked == expected else 2)
    except urllib.error.HTTPError as error:
        sys.exit(0 if error.code == 403 else 2)
    except (OSError, urllib.error.URLError):
        sys.exit(2)
elif mode in ('functional', 'availability'):
    sys.exit(0)
else:
    sys.exit(2)
