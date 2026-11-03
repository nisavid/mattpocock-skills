import hashlib
import copy
import io
import json
import tarfile

import pytest

from test_release_builder import REVISION, source_archive


def duplicate_name_archive():
    output = io.BytesIO()
    with tarfile.open(fileobj=io.BytesIO(source_archive()), mode="r:gz") as original:
        with tarfile.open(fileobj=output, mode="w:gz") as replacement:
            for item in original:
                if item.isfile():
                    data = original.extractfile(item).read()
                    item = copy.copy(item)
                    item.name = item.name.replace("skills/productivity/beta", "skills/productivity/alpha")
                    item.pax_headers = {}
                    if item.name.endswith((".claude-plugin/plugin.json", ".codex-plugin/plugin.json")):
                        manifest = json.loads(data)
                        manifest["skills"][1] = "./skills/productivity/alpha"
                        data = json.dumps(manifest).encode()
                    if item.name.endswith("skills/productivity/alpha/SKILL.md"):
                        data = data.replace(b"name: beta", b"name: alpha")
                    item.size = len(data)
                    replacement.addfile(item, io.BytesIO(data))
                else:
                    item = copy.copy(item)
                    item.name = item.name.replace("skills/productivity/beta", "skills/productivity/alpha")
                    item.pax_headers = {}
                    replacement.addfile(item)
    return output.getvalue()


def test_build_refuses_skills_with_same_flattened_name():
    from release_builder import build

    source = duplicate_name_archive()
    with tarfile.open(fileobj=io.BytesIO(source), mode="r:gz") as archive:
        names = set(archive.getnames())
        root = "mattpocock-skills-" + REVISION
        assert root + "/skills/engineering/alpha/agents/openai.yaml" in names
        assert root + "/skills/productivity/alpha/agents/openai.yaml" in names
    with pytest.raises(ValueError):
        build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.1-1")
