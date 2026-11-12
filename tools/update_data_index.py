#!/usr/bin/env python3
"""Regenerate the file lists (index.json) of the PLANE-TAS data directories.

GitHub Pages cannot list a directory, so the application reads
<directory>/index.json to know which data files exist (the GitHub API is only
a fallback and is limited to 60 requests per hour per IP address).  Run this
script after adding, renaming or removing a file in instrument/,
sample_environments/ or BG_material/, then commit the updated index.json:

    python tools/update_data_index.py

The local server (python -m http.server) shows a warning in the status line
when a list is out of date.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORIES = {"instrument": ".json", "sample_environments": ".json", "BG_material": ".cif"}


def natural_key(name):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def main():
    for directory, extension in DIRECTORIES.items():
        folder = ROOT / directory
        if not folder.is_dir():
            continue
        names = sorted(
            (p.name for p in folder.iterdir()
             if p.is_file() and p.suffix.lower() == extension and p.name.lower() != "index.json"),
            key=natural_key,
        )
        target = folder / "index.json"
        text = json.dumps(names, indent=2, ensure_ascii=False) + "\n"
        old = target.read_text(encoding="utf-8") if target.exists() else None
        if old != text:
            target.write_text(text, encoding="utf-8")
            print(f"updated {target.relative_to(ROOT)} ({len(names)} files)")
        else:
            print(f"unchanged {target.relative_to(ROOT)} ({len(names)} files)")


if __name__ == "__main__":
    main()
