"""Build release zips into dist/.

  swish-v<version>.zip            installer bundle: installer scripts + extension/
  swish-v<version>-extension.zip  bare extension, ready for the Chrome Web Store

Usage: python scripts/build.py
"""

import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

# Everything the browser needs, and nothing else.
EXTENSION = ["manifest.json", "LICENSE", "src", "popup", "icons"]
INSTALLER = ROOT / "installer"


def extension_files():
    for entry in EXTENSION:
        path = ROOT / entry
        if path.is_dir():
            yield from sorted(p for p in path.rglob("*") if p.is_file())
        else:
            yield path


def main():
    version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
    DIST.mkdir(exist_ok=True)
    name = f"swish-v{version}"

    store_zip = DIST / f"{name}-extension.zip"
    with zipfile.ZipFile(store_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for f in extension_files():
            z.write(f, f.relative_to(ROOT).as_posix())

    bundle_zip = DIST / f"{name}.zip"
    with zipfile.ZipFile(bundle_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(INSTALLER.iterdir()):
            info = zipfile.ZipInfo.from_file(f, f"{name}/{f.name}")
            if f.suffix == ".sh":
                info.external_attr = 0o755 << 16
            z.writestr(info, f.read_bytes(), zipfile.ZIP_DEFLATED)
        for f in extension_files():
            z.write(f, f"{name}/extension/{f.relative_to(ROOT).as_posix()}")

    for z in (bundle_zip, store_zip):
        print(f"{z.relative_to(ROOT)}  ({z.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
