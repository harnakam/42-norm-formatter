from __future__ import annotations

import ast
import unittest

from python.repairs import add_return_annotations, repair_missing_colons


class RepairTests(unittest.TestCase):
    def test_repairs_nested_headers_and_preserves_comments_and_strings(self) -> None:
        source = 'def main()  # hi\n    if True\n        print("if a:")\n'
        fixed = repair_missing_colons(source)
        ast.parse(fixed)
        self.assertIn("def main():  # hi", fixed)
        self.assertIn("if True:", fixed)
        self.assertIn('print("if a:")', fixed)
        self.assertEqual(repair_missing_colons(fixed), fixed)

    def test_multiline_signature(self) -> None:
        self.assertEqual(
            repair_missing_colons("def f(\n    a: str\n)\n    print(a)\n"),
            "def f(\n    a: str\n):\n    print(a)\n",
        )

    def test_does_not_guess_invalid_code(self) -> None:
        for source in [
            "def f(\n",
            "if x\nprint(x)\n",
            'def f():\n    return "unterminated\n',
        ]:
            self.assertEqual(repair_missing_colons(source), source)

    def test_annotates_none_and_literal_returns(self) -> None:
        self.assertIn(
            "def main() -> None:",
            add_return_annotations('def main():\n    print("hi")\n'),
        )
        self.assertIn(
            "def answer() -> int:",
            add_return_annotations("def answer():\n    return 42\n"),
        )
        self.assertIn(
            "def main() -> None:",
            add_return_annotations(
                "def main():\n    def inner():\n        return 1\n    print(inner())\n"
            ),
        )

    def test_preserves_unknown_types_annotations_stubs_and_generators(self) -> None:
        for source in [
            "def f(x):\n    return x\n",
            "def f():\n    yield 1\n",
            'def f() -> str:\n    return "x"\n',
            "def f():\n    ...\n",
            "@decorate\ndef f():\n    return 1\n",
            "def f(x):\n    if x:\n        return 1\n",
            'def f(): # type: () -> None\n    print("hi")\n',
        ]:
            self.assertEqual(add_return_annotations(source), source)

    def test_unicode_and_idempotence(self) -> None:
        source = 'def 挨拶():\n    print("こんにちは")\n'
        fixed = add_return_annotations(source)
        ast.parse(fixed)
        self.assertIn("def 挨拶() -> None:", fixed)
        self.assertEqual(add_return_annotations(fixed), fixed)
