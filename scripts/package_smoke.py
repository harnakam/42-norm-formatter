"""Validate the installable archive and execute its bundled Python tools."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile


def main() -> None:
    archive_path = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix='norm-package-smoke-') as temporary:
        root = Path(temporary)
        with zipfile.ZipFile(archive_path) as archive:
            names = archive.namelist()
            assert not any('__pycache__' in n or '.mypy_cache' in n or n.endswith('.pyc')
                           or '/.env' in n for n in names)
            for name in ('extension.js', 'lib/python/extension.js', 'lib/highlighter.js',
                         'python/tool_runner.py', 'python/repairs.py', 'python/norm_runner.py'):
                data = archive.read('extension/' + name)
                assert data == (archive_path.parent / name).read_bytes(), name + ' differs from source'
            archive.extractall(root)
        extension = root / 'extension'
        project = root / 'project'
        project.mkdir()
        source = 'def main()\n\tprint( "hello" )\n\nmain()\n'
        runner = extension / 'python/tool_runner.py'

        def request(kind: str, text: str) -> dict[str, object]:
            result = subprocess.run(
                [sys.executable, '-B', str(runner)],
                input=json.dumps({'version': 1, 'kind': kind, 'source': text,
                                  'filename': str(project / 'main.py'),
                                  'workspaceRoot': str(project), 'config': {}}),
                text=True, capture_output=True, check=True, cwd=project,
                env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONPATH': '',
                     'PYTHONNOUSERSITE': '1'}, timeout=120,
            )
            response = json.loads(result.stdout)
            assert response['ok'], response
            return response

        formatted = request('format-document', source)['formatted']
        assert isinstance(formatted, str) and 'def main() -> None:' in formatted
        (project / 'main.py').write_text(formatted, encoding='utf-8')
        response = request('check-document', formatted)
        assert response['diagnostics'] == [], response
        assert response['summary']['failedTools'] == [], response
        assert sorted(p.name for p in project.iterdir()) == ['main.py']
        assert not list(extension.rglob('__pycache__'))
        print(f'Package smoke passed: {len(names)} entries; bundled format + strict check; no cache.')


if __name__ == '__main__':
    main()
