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

NuDat uses a wide, three-pane explorer with a folder sidebar, back/forward/up
navigation, breadcrumbs, file sizes and compression in the list, and a roomy preview pane. It searches all archive paths, previews
text with line numbers inline and in an expanded dialog, previews browser-supported
images, audio, DDS and ETC1 textures, verifies archives, and downloads individual files or ZIPs of a
folder, search results, or a selection. An included synthetic example makes
the complete workflow available without original game assets. Long operations
can be cancelled; an invalid replacement archive preserves the open archive. A Web Worker reads small
Blob ranges through the library's generic reader API. Archives remain on your
computer; large archives are never loaded in full into WASM memory. Text previews
are limited to 1 MiB and 10,000 displayed lines; media previews
are limited to 64 MiB and depend on browser codec support. Audio never autoplays
and stops when leaving its preview. Downloading an individual entry is limited to the library's 512 MiB read limit; ZIP exports
accumulate decoded output in browser memory.

Texture previews decode on the archive worker, without GPU compression extensions.
Supported formats are DDS BC1–BC5 (DXT1–DXT5, ATI1/2 and equivalent DX10 formats),
16/24/32-bit RGB(A), and ETC1 in DDS, PKM, or KTX1 containers. This includes
Saga's `.etc1` and `.android_etc1_tex` DDS files and their nonstandard pixel-format
header size. Previews show the base mip of the first face/layer, with a 16-megapixel
limit; unsupported formats (including BC6/7, ETC2, and volume textures) show an
error instead of a misleading image. The parser follows the
[Microsoft DDS documentation](https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dx-graphics-dds-pguide)
and [Khronos ETC1 specification](https://registry.khronos.org/OpenGL/extensions/OES/OES_compressed_ETC1_RGB8_texture.txt).
The example archive contains generated DDS/ETC1 samples. Decoder tests cover
colors, alpha, subblock orientation, row padding, container variants, and corrupt data.

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
The theme uses neutral surfaces, thin rules, and simple document layouts. Violet
links and selection, gold folders, and the unchanged logo supply the color.
Matching graphs retain the red-to-green score scale. It follows
the system light/dark preference. Navigation, panels, buttons, inputs, tables,
and focus states all use these shared tokens. There are no page-local stylesheets. `site/apps.json` supplies navigation and
application titles; `"wide": true` gives an application the shared wide workspace.
For mixed widths, `"sectioned": true` lets the content use separate `site-container`
and `site-container site-container-wide` sections, as NuDat does for its introduction
and explorer. Existing `/play/` and `/progress/` links, including `?obb=`,
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

The progress explorer keeps its summary at the reading width and its map in
a wider workspace around 90% of the desktop viewport height. Scroll over the map or use its zoom buttons to zoom; drag to pan. Labels are
on by default, including source-unit headings in the function-size view, and
can be toggled off. Source files can be searched in the sidebar. Matching
graphs retain the red-to-green score scale.

Regenerate the synthetic NuDat example with
`python3 scripts/create_example.py --nudat /path/to/nudat`. The checked-in
archive contains only generated demonstration files.

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
