"""Build the Traditional Chinese display dictionary from PoeCharm's zh-rTW tables.

Usage: build_zh.py <csv folder> <output json>
Output: {"exact": {english: chinese}, "pattern": {key: [chinese_template, [placeholder order]]}}
where key is the English template with every {n} replaced by "#".
"""
import csv
import json
import os
import re
import sys

src, out = sys.argv[1], sys.argv[2]
HEADERS = {("add", "翻譯"), ("原文(有{0})", "翻譯"), ("ㄎ", "翻譯")}
PLACEHOLDER = re.compile(r"\{(\d+)\}")

exact, pattern = {}, {}
# statDescriptions last so hand-written GUI/tree entries win on exact collisions.
files = sorted(f for f in os.listdir(src) if f.endswith(".csv"))
files.sort(key=lambda f: f == "statDescriptions.csv")
for name in files:
    with open(os.path.join(src, name), encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if len(row) < 2 or (row[0], row[1]) in HEADERS:
                continue
            en, zh = row[0].replace("\\n", "\n"), row[1].replace("\\n", "\n")
            en, zh = en.strip("'") if en.startswith("'") and en.endswith("'") else en, zh.strip("'") if zh.startswith("'") and zh.endswith("'") else zh
            if not en.strip() or not zh.strip() or en == zh:
                continue
            if PLACEHOLDER.search(en):
                key = PLACEHOLDER.sub("#", en)
                order = [int(i) for i in PLACEHOLDER.findall(en)]
                pattern.setdefault(key, [zh, order])
            else:
                exact.setdefault(en, zh)

os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    json.dump({"exact": exact, "pattern": pattern}, f, ensure_ascii=False, separators=(",", ":"))
print(f"exact {len(exact)}, pattern {len(pattern)}, {os.path.getsize(out) / 1e6:.1f} MB")
