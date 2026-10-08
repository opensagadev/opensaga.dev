#!/usr/bin/env python3
"""Regenerate NuDat's small, synthetic example archive using a local NuDat CLI."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--nudat', default='nudat', help='path to the NuDat CLI')
args = parser.parse_args()
output = Path(__file__).resolve().parents[1] / 'site/apps/nudat/example.dat'
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    files = {
        'README.txt': 'Welcome to the NuDat example archive.\n\nThese are synthetic demonstration files, not game assets.\n\nOpen a folder, search for a filename, preview a text file, or select files to download as a ZIP. Your archives are processed locally.\n',
        'config/settings.ini': '[example]\nname = OpenSaga demo\nversion = 1\n\n[display]\nwidth = 1280\nheight = 720\n',
        'levels/demo/scene.json': json.dumps({'name': 'Demo scene', 'objects': [{'name': 'camera', 'position': [0, 4, 10]}, {'name': 'player', 'position': [0, 0, 0]}]}, indent=2) + '\n',
        'levels/demo/readme.txt': 'This folder demonstrates nested archive navigation.\nUse the breadcrumbs above the file list to return to a parent folder.\n',
        'data/palette.csv': 'name,hex\nviolet,#6940b6\nblue,#4c78a8\ngold,#e8b42b\nslate,#596474\n',
        'data/sample.bin': bytes(range(256)),
        'data/empty.txt': '',
    }
    for index in range(64):
        files[f'localization/messages_{index + 1:02}.txt'] = f'# Example message set {index + 1}\nwelcome=Welcome to OpenSaga\nopen=Open archive\nextract=Download file\n'
    for name, content in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode())
    subprocess.run([args.nudat, 'pack', str(root), str(output), '--format', 'pc'], check=True)
