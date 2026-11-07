#!/usr/bin/env python3
"""Verify signatures on the actual board before assigning a signed release.

Close all serial monitors first. Required: --port /dev/cu... --manifest release.json
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import termios
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', required=True)
parser.add_argument('--manifest', required=True)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('tracker_serial', Path(__file__).resolve().parents[1] / 'tools/camera-preview.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
manifest = json.loads(Path(args.manifest).read_text())
manifest.pop('storage_path', None)
# Normalize custom macOS baud before tcsetattr; CameraSerial reapplies IOSSIOSPEED.
fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
settings = termios.tcgetattr(fd)
settings[4] = settings[5] = termios.B115200
termios.tcsetattr(fd, termios.TCSANOW, settings)
os.close(fd)
connection = module.CameraSerial(args.port)
try:
    for name, changes, expected in [
        ('valid', {}, True),
        ('tampered-hash', {'sha256': '0' * 64}, False),
        ('wrong-board', {'board': 'other'}, False),
        ('oversize', {'size': 3145729}, False),
        ('old-sequence', {'sequence': 0}, False),
        ('bad-signature', {'signature': 'A' * 96}, False),
    ]:
        command = {'command': 'otaVerify', 'manifest': {**manifest, **changes}}
        os.write(connection.fd, (json.dumps(command) + '\n').encode())
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                reply = json.loads(connection.line(deadline))
            except (ValueError, UnicodeDecodeError):
                continue
            if reply.get('event') == 'ota_verification':
                if reply.get('valid') != expected:
                    raise AssertionError(f'{name} failed: {reply.get("valid")}')
                print(f'{name}: passed', flush=True)
                break
        else:
            raise TimeoutError(f'{name}: no verification reply')
finally:
    termios.tcsetattr(connection.fd, termios.TCSANOW, connection.original)
    os.close(connection.fd)
