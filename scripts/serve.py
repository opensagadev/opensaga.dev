#!/usr/bin/env python3
"""Preview the static site with the player isolation headers."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.js': 'text/javascript'}

    def end_headers(self):
        # Isolation is scoped to the threaded player, matching its service worker.
        if self.path.split('?', 1)[0].startswith('/play/'):
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', default='127.0.0.1')
parser.add_argument('--port', type=int, default=8000)
args = parser.parse_args()
directory = Path(__file__).resolve().parents[1] / 'dist'
if not (directory / 'index.html').is_file():
    parser.error('dist is missing; run npm run build first')
server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(directory)))
print(f'Serving {directory} at http://{args.host}:{args.port}', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
