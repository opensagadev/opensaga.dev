#!/usr/bin/env python3
"""Regenerate NuDat's small, synthetic example archive using a local NuDat CLI."""
import argparse
import json
import io
import math
import struct
import wave
import zlib
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
    # Browser-preview fixtures: a palette card and a quiet three-second tone.
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    colors = [(105, 64, 182), (76, 120, 168), (232, 180, 43), (89, 100, 116)]
    pixels = b''.join(b'\x00' + b''.join(bytes(colors[x // 80]) for x in range(320)) for _ in range(180))
    files['media/palette.png'] = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 320, 180, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')
    def dds(fourcc, data, width, height):
        header = bytearray(128)
        header[:4] = b'DDS '
        for offset, value in [(4,124),(8,0x81007),(12,height),(16,width),(20,len(data)),(76,24 if fourcc == b'ETC1' else 32),(80,4),(108,0x1000)]:
            struct.pack_into('<I', header, offset, value)
        header[84:88] = fourcc
        return bytes(header) + data
    dxt, etc = bytearray(), bytearray()
    for y in range(24):
        for x in range(40):
            r,g,b = colors[x // 10]
            # Flat palette blocks with a small brightness checker to expose block order.
            if (x // 4 + y // 4) % 2: r,g,b = (max(0,c-24) for c in (r,g,b))
            rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
            dxt.extend(struct.pack('<HHI', rgb565, 0, 0))
            ctrl = ((r >> 4) * 17 << 24) | ((g >> 4) * 17 << 16) | ((b >> 4) * 17 << 8)
            etc.extend(struct.pack('>II', ctrl, 0))
    files['media/palette.dds'] = dds(b'DXT1', dxt, 160, 96)
    files['media/palette.android_etc1_tex'] = dds(b'ETC1', etc, 160, 96)
    audio = io.BytesIO()
    with wave.open(audio, 'wb') as output_audio:
        output_audio.setnchannels(1)
        output_audio.setsampwidth(2)
        output_audio.setframerate(22050)
        output_audio.writeframes(b''.join(struct.pack('<h', int(1800 * math.sin(2 * math.pi * 440 * i / 22050) * min(1, i / 2205, (66149 - i) / 2205))) for i in range(66150)))
    files['media/tone.wav'] = audio.getvalue()
    for index in range(64):
        files[f'localization/messages_{index + 1:02}.txt'] = f'# Example message set {index + 1}\nwelcome=Welcome to OpenSaga\nopen=Open archive\nextract=Download file\n'
    for name, content in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode())
    subprocess.run([args.nudat, 'pack', str(root), str(output), '--format', 'pc'], check=True)
