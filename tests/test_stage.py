"""Check how staging pages are marked."""
import unittest

from scripts.stage import mark_staging


class StageTest(unittest.TestCase):
    def test_marks_pages_as_staging(self):
        html = mark_staging('<html><head>\n<title>x</title></head><body class="player-page"><main></main></body></html>', 'abc1234')
        self.assertIn('<head>\n    <meta name="robots" content="noindex">', html)
        self.assertIn('<body class="player-page"><div role="note"', html)
        self.assertIn('<code>abc1234</code>', html)
        self.assertEqual(html.count('role="note"'), 1)


if __name__ == '__main__':
    unittest.main()
