"""Move Timeless Jewel lookup tables out of root.zip so the startup download stays small.

PoB only opens these files when a build uses that jewel type; the driver fetches them on demand
from <version>/lazy/<dir>/<name>, using <version>/lazy.json as the list.
"""
import json
import os
import sys
import zipfile

LAZY_DIR = "Data/TimelessJewelData"

version_dir = sys.argv[1]
src = os.path.join(version_dir, "root.zip")
tmp = os.path.join(version_dir, "root.zip.tmp")
lazy_root = os.path.join(version_dir, "lazy")

moved = []
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for info in zin.infolist():
        name = info.filename
        if name.startswith(LAZY_DIR + "/"):
            rel = name[len(LAZY_DIR) + 1:]
            if not rel:
                # Keep the folder itself: the driver mounts an in-memory store on it.
                zout.writestr(info, b"")
                continue
            if rel and not name.endswith("/"):
                out = os.path.join(lazy_root, LAZY_DIR, rel)
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out, "wb") as f:
                    f.write(zin.read(info))
                moved.append(rel)
            continue
        zout.writestr(info, zin.read(info), compress_type=zipfile.ZIP_DEFLATED)

os.replace(tmp, src)
with open(os.path.join(version_dir, "lazy.json"), "w") as f:
    json.dump({"dir": LAZY_DIR, "files": sorted(moved)}, f)
print(f"moved {len(moved)} files; root.zip now {os.path.getsize(src) / 1e6:.1f} MB")
