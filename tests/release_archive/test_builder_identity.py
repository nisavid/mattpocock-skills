import copy
import hashlib
import io
import json
import tarfile

import pytest

from test_release_builder import REVISION, source_archive


def test_build_refuses_inconsistent_source_versions():
    from release_builder import build

    source = source_archive(source_version="1.3.3+from.1.3.1", native_version="1.3.4+from.1.3.1")
    with pytest.raises(ValueError, match="source version mismatch"):
        build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.3+from.1.3.1")


@pytest.mark.parametrize(
    "manifest_path", [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]
)
@pytest.mark.parametrize("name", [None, "other-skills"], ids=["missing", "mismatched"])
def test_build_refuses_missing_or_mismatched_plugin_identity(manifest_path, name):
    from release_builder import build

    output = io.BytesIO()
    target = "mattpocock-skills-" + REVISION + "/" + manifest_path
    with tarfile.open(fileobj=io.BytesIO(source_archive()), mode="r:gz") as original:
        with tarfile.open(fileobj=output, mode="w:gz") as replacement:
            for member in original:
                member = copy.copy(member)
                if member.isfile():
                    data = original.extractfile(member).read()
                    if member.name == target:
                        manifest = json.loads(data)
                        if name is None:
                            del manifest["name"]
                        else:
                            manifest["name"] = name
                        data = json.dumps(manifest).encode()
                    member.size = len(data)
                    replacement.addfile(member, io.BytesIO(data))
                else:
                    replacement.addfile(member)
    source = output.getvalue()
    with pytest.raises(ValueError, match="source plugin name mismatch"):
        build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1")


@pytest.mark.parametrize("base,release", [
    ("1.3.1", "1.3.1.ergo.1"),
    ("1.3.1", "1.3.2+from.1.3.2"),
    ("1.3.1", "1.4.2+from.1.3.1"),
    ("1.3.1", "1.3.1+from.1.3.1"),
    ("1.3.1", "1.3.02+from.1.3.1"),
    ("1.03.1", "1.3.2+from.1.03.1"),
])
def test_build_refuses_release_versions_outside_policy(base, release):
    from release_builder import build

    source = source_archive()
    with pytest.raises(ValueError):
        build(source, hashlib.sha256(source).hexdigest(), REVISION, base, release)


@pytest.mark.parametrize("source_version", ["1.3.2", "1.3.5+from.1.3.2"])
def test_build_refuses_source_release_version_mismatch(source_version):
    from release_builder import build

    source = source_archive(source_version=source_version)
    with pytest.raises(ValueError, match="source version mismatch"):
        build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.2", "1.3.4+from.1.3.2")


@pytest.mark.parametrize("case", ["missing", "mismatch", "escape"])
def test_build_refuses_invalid_icon_inputs(case):
    from release_builder import build

    output = io.BytesIO()
    root = "mattpocock-skills-" + REVISION + "/"
    with tarfile.open(fileobj=io.BytesIO(source_archive(icon=True)), mode="r:gz") as original:
        with tarfile.open(fileobj=output, mode="w:gz") as replacement:
            for member in original:
                member = copy.copy(member)
                if case == "missing" and member.name == root + "assets/wayfinder.svg":
                    continue
                if member.isfile():
                    data = original.extractfile(member).read()
                    if case == "mismatch" and member.name == root + ".codex-plugin/plugin.json":
                        manifest = json.loads(data)
                        manifest["interface"]["logo"] = "./assets/other.svg"
                        data = json.dumps(manifest).encode()
                    if case == "escape" and member.name == root + ".claude-plugin/plugin.json":
                        manifest = json.loads(data)
                        manifest["icon"] = "./assets/../LICENSE"
                        data = json.dumps(manifest).encode()
                    member.size = len(data)
                    replacement.addfile(member, io.BytesIO(data))
                else:
                    replacement.addfile(member)
    source = output.getvalue()
    with pytest.raises(ValueError):
        build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1")
