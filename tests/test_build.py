"""Check the assembled deployment, including both real WASM applications."""
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import unittest
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'

class Links(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.urls = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('src', 'href') and value:
                self.urls.append(value)

class DeploymentTest(unittest.TestCase):
    def test_local_urls_and_shared_styles(self):
        for path in DIST.rglob('*.html'):
            text = path.read_text()
            with self.subTest(path=path.relative_to(DIST)):
                self.assertNotIn('<!--__', text)
                self.assertNotIn('__ROOT__', text)
                self.assertNotIn('/*__DATA__*/', text)
                self.assertEqual(text.count('rel="stylesheet"'), 1)
                for href in Links(text).urls:
                    url = urlsplit(href)
                    if url.scheme or url.netloc or not url.path:
                        continue
                    self.assertFalse(url.path.startswith('/'))
                    target = path.parent / url.path
                    if target.is_dir():
                        target /= 'index.html'
                    self.assertTrue(target.is_file(), f'{path}: {href}')

    def test_wasm_payloads_and_worker_scope(self):
        metadata = json.loads((DIST / 'build-info.json').read_text())
        self.assertEqual(set(metadata['sources']), {'saga', 'nudat'})
        for sha in metadata['sources'].values():
            self.assertRegex(sha, r'^[0-9a-f]{40}$')
        if not metadata['wasm']:
            self.skipTest('layout preview omits application binaries')
        for path in [DIST / 'play/saga.wasm', DIST / 'nudat/pkg/nudat_web_bg.wasm']:
            self.assertEqual(path.read_bytes()[:4], b'\0asm')
        for path in ['play/saga.js', 'nudat/pkg/nudat_web.js', 'nudat/worker.js', 'assets/fflate.js', 'assets/d3.min.js']:
            self.assertTrue((DIST / path).is_file(), path)
        worker = (DIST / 'nudat/worker.js').read_text()
        for href in re.findall(r"from ['\"]([^'\"]+)", worker):
            self.assertTrue((DIST / 'nudat' / href).is_file(), href)
        self.assertTrue((DIST / 'play/coi-serviceworker.js').is_file())
        self.assertFalse((DIST / 'coi-serviceworker.js').exists())
