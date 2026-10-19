"""Package this extension's runtime files for the Chrome Web Store."""

import json
import tempfile
import zipfile
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / "manifest.json").read_text())
    names = ["manifest.json", "LICENSE", *manifest.get("icons", {}).values()]
    for script in manifest.get("content_scripts", []):
        names.extend(script.get("js", []))
        names.extend(script.get("css", []))
    names = list(dict.fromkeys(names))

    # Check every input before creating/replacing a release archive.
    for name in names:
        source = (root / name).resolve()
        if not source.is_relative_to(root) or not source.is_file():
            raise ValueError(f"Missing or invalid extension file: {name}")

    output = root / "dist" / f"vim-keys-for-github-code-review-{manifest['version']}.zip"
    output.parent.mkdir(exist_ok=True)
    # Build a fresh archive each time so removed files cannot linger in it.
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        archive = Path(temporary) / output.name
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
            for name in names:
                package.write(root / name, name)
        with zipfile.ZipFile(archive) as package:
            if package.testzip() is not None:
                raise ValueError("ZIP integrity check failed")
        archive.replace(output)

    print(f"Created {output.relative_to(root)} ({len(names)} files, {output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
