"""Verify generated page separation, report values, and deployable links."""

from html.parser import HTMLParser
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlsplit

from scripts.pages import generate_site


class PageElements(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.elements = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class PagesTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.report_path = self.root / "matching.json"
        self.output = self.root / "site" / "index.html"
        self.report = {
            "schema_version": 1,
            "text": {"address": 4096, "size": 512},
            "sections": [],
            "units": [{
                "name": "example.cpp",
                "functions": [{
                    "name": "report_only_function",
                    "demangled_name": "report_only_function()",
                    "address": 4096,
                    "size": 512,
                    "match_percent": 44.536,
                }],
            }],
            "measures": {
                "fuzzy_match_percent": 44.536,
                "matched_functions": 0,
                "total_functions": 1,
                "matched_code_percent": 7.25,
            },
            "summary": {"bazel_units": 1},
        }

    def generate(self):
        self.report_path.write_text(json.dumps(self.report), encoding="utf-8")
        generate_site(self.report_path, self.output, 512, 512)
        assets = self.output.parent / "assets"
        assets.mkdir(exist_ok=True)
        (assets / "d3.min.js").write_text("// test fixture")
        return {
            name: (self.output.parent / name).read_text(encoding="utf-8")
            for name in ("index.html", "progress/index.html", "play/index.html", "nudat/index.html", "nusave/index.html")
        }

    def test_nudat_uses_shared_shell_and_owns_its_worker(self):
        page = self.generate()["nudat/index.html"]
        self.assertIn('src="./app.js"', page)
        self.assertIn('id="archive-file"', page)
        self.assertNotIn("<style", page)
        self.assertTrue((self.output.parent / "nudat/worker.js").is_file())
        self.assertFalse((self.output.parent / "nudat/coi-serviceworker.js").exists())

    def test_nusave_uses_the_shared_shell_and_its_own_worker(self):
        page = self.generate()["nusave/index.html"]
        self.assertIn('id="save-file"', page)
        self.assertIn('id="values-form"', page)
        self.assertNotIn("<style", page)
        self.assertTrue((self.output.parent / "nusave/worker.js").is_file())

    def test_report_cannot_close_inline_script(self):
        self.report["units"][0]["functions"][0]["demangled_name"] = "</script><script>alert(1)</script>"
        page = self.generate()["progress/index.html"]
        self.assertNotIn("</script><script>alert(1)</script>", page)
        self.assertIn(r"<\/script>", page)

    def test_homepage_uses_report_progress(self):
        for percent, expected in ((0, "0.00"), (44.536, "44.54"), (100, "100.00")):
            with self.subTest(percent=percent):
                self.report["measures"]["fuzzy_match_percent"] = percent
                home = self.generate()["index.html"]
                bars = [attrs for tag, attrs in PageElements(home).elements if tag == "progress"]
                self.assertEqual(len(bars), 1)
                self.assertEqual(bars[0]["value"], expected)
                self.assertEqual(bars[0]["max"], "100")
                self.assertIn(f"{expected}%", home)

    def test_separates_home_progress_and_player(self):
        pages = self.generate()
        home = pages["index.html"]
        progress = pages["progress/index.html"]
        player = pages["play/index.html"]

        self.assertIn('id="progress"', progress)
        self.assertIn("report_only_function", progress)
        self.assertNotIn("/*__DATA__*/", progress)
        self.assertIn('href="../play/"', progress)
        self.assertIn('id="obb-file"', player)
        self.assertIn('id="loading-screen"', player)
        self.assertIn('src="./coi-serviceworker.js"', player)
        self.assertIn('runtimeScript.src = "./saga.js"', player)
        self.assertTrue((self.output.parent / "play/coi-serviceworker.js").is_file())
        self.assertTrue((self.output.parent / ".nojekyll").is_file())
        self.assertFalse((self.output.parent / "coi-serviceworker.js").exists())

        for page in (home, player):
            self.assertNotIn("report_only_function", page)
            self.assertNotIn("d3.min.js", page)
            self.assertNotIn('id="progress"', page)
        for page in (home, progress):
            self.assertNotIn('id="obb-file"', page)
            self.assertNotIn("Module.callMain", page)
            self.assertNotIn("coi-serviceworker.js", page)
            self.assertIn("player.search = location.search", page)
            self.assertIn("player.hash = location.hash", page)
        self.assertIn('new URL("./play/", location.href)', home)
        self.assertIn('new URL("../play/", location.href)', progress)
        self.assertNotIn("cdn.jsdelivr.net", home)

    def test_internal_links_work_under_a_project_subdirectory(self):
        pages = self.generate()
        for name, html in pages.items():
            with self.subTest(page=name):
                self.assertNotIn("<!--__", html)
                self.assertNotIn("__ROOT__", html)
                elements = PageElements(html).elements
                self.assertEqual(sum(tag == "nav" and attrs.get("aria-label") == "Main navigation"
                                     for tag, attrs in elements), 1)
                self.assertEqual(sum(tag == "footer" and attrs.get("class") == "site-footer"
                                     for tag, attrs in elements), 1)
                stylesheets = [attrs["href"] for tag, attrs in elements
                               if tag == "link" and attrs.get("rel") == "stylesheet"]
                expected_css = "./site.css" if name == "index.html" else "../site.css"
                self.assertEqual(stylesheets, [expected_css])
                icons = [attrs["href"] for tag, attrs in elements
                         if tag == "link" and attrs.get("rel") == "icon"]
                root = "./" if name == "index.html" else "../"
                self.assertEqual(icons, [root + "favicon.png", root + "favicon.svg"])
                self.assertNotIn("@tailwindcss/browser", html)
                active = [attrs["href"] for tag, attrs in elements
                          if tag == "a" and attrs.get("aria-current") == "page"]
                expected_active = ["./"] if name == "index.html" else ["../" + name.split("/")[0] + "/"]
                self.assertEqual(active, expected_active)
                for tag, attrs in elements:
                    for attr in ("href", "src"):
                        if attr not in attrs:
                            continue
                        url = urlsplit(attrs[attr])
                        if url.scheme or url.netloc:
                            continue
                        self.assertFalse(url.path.startswith("/"), attrs[attr])
                        target = self.output.parent / name
                        if url.path:
                            target = target.parent / url.path
                        if target.is_dir():
                            target /= "index.html"
                        self.assertTrue(target.is_file(), f"{name}: {attrs[attr]}")
                        if url.fragment:
                            self.assertIn(f'id="{url.fragment}"', target.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
