import hashlib
import io
import tarfile

import pytest

from test_release_builder import REVISION, source_archive


def archive_with_link(target):
    source = source_archive()
    output = io.BytesIO()
    with tarfile.open(fileobj=io.BytesIO(source), mode="r:gz") as original:
        with tarfile.open(fileobj=output, mode="w:gz") as replacement:
            for item in original:
                if item.isfile():
                    data = original.extractfile(item).read()
                    if item.name.endswith("/skills/engineering/alpha/SKILL.md"):
                        data += f"\n[helper]({target})\n".encode()
                        item.size = len(data)
                    replacement.addfile(item, io.BytesIO(data))
                else:
                    replacement.addfile(item)
    return output.getvalue()


def test_build_rejects_broken_relocated_skill_link():
    from release_builder import build

    valid = archive_with_link("scripts/run.sh")
    build(valid, hashlib.sha256(valid).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1")

    broken = archive_with_link("scripts/missing.sh")
    with pytest.raises(ValueError, match="missing.sh"):
        build(broken, hashlib.sha256(broken).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1")


def test_build_rejects_link_broken_only_after_flattening():
    from release_builder import build

    source = archive_with_link("../../productivity/beta/SKILL.md")
    with pytest.raises(ValueError, match="unresolved relocated link"):
        build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1")
