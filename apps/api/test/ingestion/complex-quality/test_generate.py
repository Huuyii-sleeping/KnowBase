"""Renderer/generator tests use authored sources, never invoke an inference model."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader
from generate import generate
from render import render

FONT = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")


@unittest.skipUnless(FONT.exists(), "Set up the documented CJK font on this host")
class GeneratorTests(unittest.TestCase):
    def test_full_corpus_reproducible_hashes_scans_and_page_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = generate(Path(tmp) / "first", FONT)
            second = generate(Path(tmp) / "second", FONT)
            self.assertEqual(first, second)
            self.assertEqual(len(first["cases"]), 14)
            for item in first["cases"]:
                file = Path(tmp) / "first" / item["file"]
                if file.suffix == ".pdf":
                    reader = PdfReader(file)
                    self.assertEqual(len(reader.pages), item["pages"])
                    if item["category"] == "scanned-table":
                        self.assertFalse(reader.pages[0].extract_text().strip())
                    if item["category"] == "formula-image":
                        text = reader.pages[0].extract_text()
                        self.assertIn("补偿公式", text)
                        self.assertNotIn("固定端", text)  # Raster diagram really requires OCR.
            with self.assertRaises(FileExistsError):
                generate(Path(tmp) / "first", FONT)

    def test_labels_are_painted_after_cells_when_holdout_columns_move(self):
        class RecordingCanvas:
            def __init__(self):
                self.order = []

            def __getattr__(self, name):
                if name == "save":
                    return lambda: None
                return lambda *args, **kwargs: self.order.append(name)

        recording = RecordingCanvas()
        item = dict(id="layout", file="layout.pdf", width=100, height=100, scan=False,
                    pages=[[dict(kind="text", x=5, y=20, text="值", size=12),
                            dict(kind="rect", x=0, y=0, w=50, h=30, fill="#ffffff")]])
        with patch("render.canvas.Canvas", return_value=recording), patch("render.render_pages", return_value=[]):
            render(item)
        self.assertLess(recording.order.index("rect"), recording.order.index("drawString"))

    def test_unknown_layout_primitive_fails_without_a_success_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch("generate.render", side_effect=ValueError("invalid layout")):
                with self.assertRaises(ValueError):
                    generate(Path(tmp) / "broken", FONT)
            self.assertFalse((Path(tmp) / "broken/manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
