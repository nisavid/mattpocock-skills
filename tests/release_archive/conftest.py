import importlib.util
import sys
from pathlib import Path

path = Path(__file__).resolve().parents[2] / "scripts" / "build-release-archives.py"
spec = importlib.util.spec_from_file_location("release_builder", path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
