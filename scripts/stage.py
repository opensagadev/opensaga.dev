#!/usr/bin/env python3
"""Build the `staging` branch into dist/staging/ next to the production site.

GitHub Pages serves one site per repository and every deployment replaces it,
so each production deployment also rebuilds the staging branch. The staging
branch is built with its own scripts and pinned submodules, which may point at
unmerged Saga, nudat, or nusave commits. A missing branch or failed staging
build never blocks the production deployment.
"""
from __future__ import annotations
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRANCH = 'staging'

BANNER = (
    '<div role="note" style="padding:6px 16px;background:#be7e0d;color:#000;'
    'font:600 13px/1.5 ui-sans-serif,system-ui,sans-serif;text-align:center">'
    'Staging build of <code>{revision}</code>. '
    '<a href="https://opensaga.dev/" style="color:inherit">Go to the production site</a>'
    '</div>'
)


def run(*args, cwd=ROOT):
    subprocess.run(args, cwd=cwd, check=True)


def mark_staging(html: str, revision: str) -> str:
    """Keep staging pages out of search results and label them visibly."""
    html = re.sub(r'(<head[^>]*>)', r'\1\n    <meta name="robots" content="noindex">', html, count=1)
    return re.sub(r'(<body[^>]*>)', lambda match: match.group(1) + BANNER.format(revision=revision), html, count=1)


def build(output: Path) -> bool:
    if subprocess.run(['git', 'fetch', '--depth=1', 'origin', BRANCH], cwd=ROOT).returncode != 0:
        print(f'No {BRANCH} branch; skipping the staging build.')
        return False
    revision = subprocess.check_output(['git', 'rev-parse', '--short', 'FETCH_HEAD'], cwd=ROOT, text=True).strip()
    source = ROOT / 'build/staging-src'
    if source.exists():
        run('git', 'worktree', 'remove', '--force', str(source))
    run('git', 'worktree', 'add', '--detach', str(source), 'FETCH_HEAD')
    run('git', 'submodule', 'update', '--init', '--recursive', cwd=source)
    run('npm', 'ci', cwd=source)
    run('npm', 'run', 'build', cwd=source)

    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(source / 'dist', output)
    (output / 'CNAME').unlink(missing_ok=True)
    for page in output.rglob('*.html'):
        page.write_text(mark_staging(page.read_text(), revision))
    print(f'Built {BRANCH} {revision} into {output}')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist' / BRANCH)
    args = parser.parse_args()
    try:
        build(args.output.resolve())
    except subprocess.CalledProcessError as error:
        # Production still deploys; the workflow summary shows the failure.
        print(f'::warning::The {BRANCH} build failed: {error}', file=sys.stderr)
        shutil.rmtree(args.output, ignore_errors=True)


if __name__ == '__main__':
    main()
