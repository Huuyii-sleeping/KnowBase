import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader
from generate_ocr_tables import generate

FONT = Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf')


@unittest.skipUnless(FONT.exists(), 'Requires documented CJK font')
class OcrTableGeneratorTests(unittest.TestCase):
    def test_reproducible_image_only_sources_keep_authored_blank_coordinates(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, second = Path(tmp) / 'first', Path(tmp) / 'second'
            generate(first, FONT)
            generate(second, FONT)
            manifest = json.loads((first / 'manifest.json').read_text())
            self.assertEqual(manifest, json.loads((second / 'manifest.json').read_text()))
            self.assertEqual(len(manifest['cases']), 2)
            for item in manifest['cases']:
                self.assertFalse(PdfReader(first / item['file']).pages[0].extract_text().strip())
                self.assertTrue((first / 'previews' / (item['id'] + '-p1.png')).exists())
            gold = json.loads((first / 'gold.json').read_text())
            self.assertIn([5, 2, ''], gold['cases'][0]['tables'][0]['cells'])
            self.assertIn([5, 3, ''], gold['cases'][1]['tables'][0]['cells'])
            with self.assertRaises(FileExistsError):
                generate(first, FONT)

    def test_failed_render_never_leaves_a_success_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'failed'
            with patch('generate_ocr_tables.render', side_effect=ValueError('invalid')):
                with self.assertRaises(ValueError):
                    generate(output, FONT)
            self.assertFalse((output / 'manifest.json').exists())
