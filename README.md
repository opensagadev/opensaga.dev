# opensaga.dev

Standalone GitHub Pages site for opensaga. This repository owns the landing
page, shared design, progress explorer, Saga player, and NuDat browser tool.
The source projects are pinned Git submodules; deployment never silently
builds their latest branches.

| Route | Application | Input |
| --- | --- | --- |
| `/` | Landing page and project FAQ | Saga's committed matching metrics |
| `/progress/` | Interactive Saga decompilation statistics | `vendor/saga/matching.json` |
| `/play/` | Experimental Saga WebAssembly player | Bazel build and your own Android OBB |
| `/nudat/` | NuDat archive explorer | Rust library built to WASM and your local DAT/OBB |

NuDat lists/searches entries, previews text, verifies archives, downloads
individual files, and exports filtered files as ZIP. A Web Worker reads small
Blob ranges through the library's generic reader API. Archives remain on your
computer; large archives are never loaded in full into WASM memory. Downloading
an individual entry is limited to the library's 512 MiB read limit; ZIP exports
accumulate decoded output in browser memory.

## Build and preview

Requirements: Node.js 24 + npm, Python 3.12+, Rust with
`wasm32-unknown-unknown`, wasm-pack 0.15.0, and Bazelisk (Saga pins Bazel 9.2.0).
Bazel downloads its Emscripten and C++ toolchains.

```sh
git clone --recurse-submodules https://github.com/opensagadev/opensaga.dev.git
cd opensaga.dev
npm ci
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.0 --locked
npm run build
npm test
npm run serve
```

Open http://127.0.0.1:8000. `dist/` is the complete deployable artifact.
No original game assets or reference binaries are required to build the site.
For a quick layout preview, use `npm run build:preview`, then `npm run serve`;
that preview deliberately omits application binaries. To use a working Saga
checkout locally: `python3 scripts/build.py --saga ../saga`.

## Shared design and new applications

`site/shared/` owns the shell, navigation, theme, typography, forms, buttons,
tables, dialogs, and responsive layouts. Tailwind scans all templates and JS
under `site/`; the build emits one stylesheet used by every application.
There are no page-local stylesheets. `site/apps.json` supplies navigation and
application titles. Existing `/play/` and `/progress/` links, including `?obb=`,
retain their behavior.

Add a manifest entry and a `site/apps/<id>/index.html` content fragment. The
builder wraps it in `site/shared/layout.html` and copies its JavaScript files.
Use ordinary semantic HTML and the shared `site-section`, `site-title`,
`site-subtitle`, `site-intro`, `site-actions`, and `field-label` classes. Add
reusable UI components to `site/shared/theme.css`. The migrated player and
progress explorer retain their complete HTML templates and receive the same
shared header, head, and footer.

`crates/nudat-web` is the WASM adapter; format parsing, compression and
validation belong to NuDat. Its dependency disables NuDat's CLI feature.
The library handles `Read`, `Seek`, and `Write` sources, while the native CLI
owns files, directories, temporary staging, and thread scheduling.

## Updating source versions

```sh
git submodule update --init --recursive
git -C vendor/saga fetch origin
git -C vendor/saga checkout <published-saga-commit>
git -C vendor/nudat fetch origin
git -C vendor/nudat checkout <published-nudat-commit>
npm run build
npm test
git add vendor/saga vendor/nudat
git commit
```

Only pin commits available in the public source repositories. Each deployment
includes `build-info.json` with the exact source revisions. The `branch = main`
submodule hints support deliberate `git submodule update --remote`; ordinary
builds and CI always use the pinned revisions.

## Deployment

`.github/workflows/pages.yml` builds both WASM applications, compiles shared
styles, assembles all pages, and validates the result on main pushes and pull
requests. Main pushes/manual dispatches deploy `dist/`; pull requests only
build and test. Configure this repository's Pages source as **GitHub Actions**
and custom domain as **opensaga.dev**. Remove that domain from Saga's Pages
settings when cutting over, and point DNS at the opensagadev Pages host.
`CNAME` alone does not configure the domain for an Actions deployment; see
[GitHub's Pages configuration guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

Saga's threaded player has a `/play/`-scoped isolation service worker; other
applications use normal browser isolation. Remote OBB sources must permit
CORS. For local assets, use the player's file selector.

## Asset credits

The existing opensaga branding was migrated from Saga. Stud proportions refer
to James Jessiman's [LDraw 6141](https://library.ldraw.org/parts/10969),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Discord and GitHub
icons come from Simple Icons 16.31.0 (CC0). D3 (ISC) and fflate (MIT) are bundled
locally from their pinned npm packages. Copyrighted game assets are not included.
