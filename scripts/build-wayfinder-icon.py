"""Create a style-free icon from the supplied Wayfinder source artwork."""

from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
source = (root / "assets/wayfinder-source.svg").read_bytes().decode("utf-8")
source = source.replace("\r\n", "\n").replace("\r", "\n")
style = ''' <style>
        path { fill: #000; }
        @media (prefers-color-scheme: dark) {
            path { fill: #FFF; }
        }
    </style>
'''
if source.count(style) != 1:
    raise SystemExit("Source artwork style differs from the reviewed input")
result = source.replace(style, "").replace('fill="#000"', 'fill="#767676"').encode("utf-8")
destination = root / "assets/wayfinder.svg"
if sys.argv[1:] == ["--check"]:
    if not destination.is_file() or destination.read_bytes() != result:
        raise SystemExit("Wayfinder icon is missing or stale")
elif not sys.argv[1:]:
    destination.write_bytes(result)
else:
    raise SystemExit("Usage: python scripts/build-wayfinder-icon.py [--check]")
