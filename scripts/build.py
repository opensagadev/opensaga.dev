#!/usr/bin/env python3
"""Build the standalone site from pinned source submodules."""
from __future__ import annotations
import argparse
import json
import shutil
import subprocess
from pathlib import Path
from pages import generate_site

ROOT = Path(__file__).resolve().parents[1]


def run(*args, cwd=ROOT):
    subprocess.run(args, cwd=cwd, check=True)


def assemble(saga: Path, output: Path, *, skip_wasm=False):
    output.mkdir(parents=True, exist_ok=True)
    generate_site(saga / 'matching.json', output / 'index.html', 256 * 512, 512)
    assets = output / 'assets'
    assets.mkdir(exist_ok=True)
    shutil.copyfile(ROOT / 'node_modules/d3/dist/d3.min.js', assets / 'd3.min.js')
    shutil.copyfile(ROOT / 'node_modules/fflate/esm/browser.js', assets / 'fflate.js')
    if skip_wasm:
        # A layout preview must clearly distinguish itself from a playable build.
        for route in ['play', 'nudat']:
            path = output / route / 'index.html'
            html = path.read_text()
            html = html.replace('<!--__PREVIEW__-->', '')
            html = html.replace('<main class="site-container site-content">',
                '<main class="site-container site-content"><p role="status" class="status-message">Layout preview. Run npm run build to compile the applications.</p>', 1)
            path.write_text(html)
    else:
        wasm = saga / 'bazel-bin/src'
        for name in ['saga.js', 'saga.wasm']:
            shutil.copyfile(wasm / name, output / 'play' / name)
        shutil.copytree(ROOT / 'build/nudat', output / 'nudat/pkg', dirs_exist_ok=True)
    versions = {}
    for name in ['saga', 'nudat']:
        path = ROOT / 'vendor' / name
        versions[name] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=path, text=True).strip()
    (output / 'build-info.json').write_text(json.dumps({'sources': versions, 'wasm': not skip_wasm}, indent=2) + '\n')
    (output / 'CNAME').write_text('opensaga.dev\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-wasm', action='store_true', help='build a layout preview without compiling applications')
    parser.add_argument('--saga', type=Path, default=ROOT / 'vendor/saga', help='override Saga checkout for local development')
    args = parser.parse_args()
    saga = args.saga.resolve()
    for path in [saga / 'matching.json', ROOT / 'vendor/nudat/Cargo.toml']:
        if not path.is_file():
            parser.error(f'{path} missing; run git submodule update --init --recursive')
    (ROOT / 'build').mkdir(exist_ok=True)
    run('npm', 'run', 'build:css')
    if not args.skip_wasm:
        run('bazel', 'build', '--config=wasm', '//src:saga_wasm', cwd=saga)
        run('wasm-pack', 'build', 'crates/nudat-web', '--target', 'web', '--out-dir', '../../build/nudat', '--release', '--', '--locked')
    # Stage a complete tree; never mix a new site with old application assets.
    staging = ROOT / 'build/site'
    if staging.exists():
        shutil.rmtree(staging)
    assemble(saga, staging, skip_wasm=args.skip_wasm)
    output = ROOT / 'dist'
    if output.exists():
        shutil.rmtree(output)
    shutil.move(staging, output)
    print(f'Built {output}')


if __name__ == '__main__':
    main()
