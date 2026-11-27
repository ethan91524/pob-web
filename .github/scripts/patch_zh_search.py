"""Let PoB's searches match the Chinese display text as well as the English.

The web build shows Chinese only at draw time; PoB's own search code still compares English.
This swaps the lowercase-English haystacks in the passive tree, item database and gem searches
for PobWebSearchText(...) (defined in boot.lua), which returns English plus the Chinese text.

Usage: patch_zh_search.py <root.zip>
Replacements whose source text is missing are skipped with a warning, so a PoB upgrade never
breaks the deploy (that search just goes back to English-only).
"""
import os
import sys
import zipfile

PATCHES = {
    "Classes/PassiveTreeView.lua": [
        ("PCall(search, node.dn:lower(), needMatches)", "PCall(search, PobWebSearchText(node.dn), needMatches)"),
        ("PCall(search, line:lower(), needMatches)", "PCall(search, PobWebSearchText(line), needMatches)"),
    ],
    "Classes/ItemDBControl.lua": [
        ("local searchName = item.name:lower()", "local searchName = PobWebSearchText(item.name)"),
        ("string.matchOrPattern, line.line:lower(), searchStr)", "string.matchOrPattern, PobWebSearchText(line.line), searchStr)"),
    ],
    "Classes/GemSelectControl.lua": [
        ('((" "..gemData.name:lower()):match(pattern))', '((" "..PobWebSearchText(gemData.name)):match(pattern))'),
    ],
}


def patch_text(name: str, text: str) -> str:
    for old, new in PATCHES[name]:
        count = text.count(old)
        if count == 0:
            print(f"patch_zh_search: {name}: not found, skipped: {old}")
            continue
        text = text.replace(old, new)
        print(f"patch_zh_search: {name}: replaced {count}x: {old}")
    return text


def main() -> None:
    path = sys.argv[1]
    tmp = path + ".tmp"
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info)
            if info.filename in PATCHES:
                data = patch_text(info.filename, data.decode("utf-8")).encode("utf-8")
            zout.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED)
    os.replace(tmp, path)


if __name__ == "__main__":
    main()
