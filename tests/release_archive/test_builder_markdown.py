import hashlib
import io
import tarfile

import pytest

from test_release_builder import REVISION, source_archive


def replace_skill(path, transform):
    output = io.BytesIO()
    with tarfile.open(fileobj=io.BytesIO(source_archive()), mode="r:gz") as original:
        with tarfile.open(fileobj=output, mode="w:gz") as replacement:
            for item in original:
                if item.isfile():
                    data = original.extractfile(item).read()
                    if item.name.endswith(path):
                        data = transform(data)
                        item.size = len(data)
                    replacement.addfile(item, io.BytesIO(data))
                else:
                    replacement.addfile(item)
    return output.getvalue()


def test_build_reads_invocation_control_after_separator_in_description():
    from release_builder import build

    source = replace_skill(
        "/skills/productivity/beta/SKILL.md",
        lambda data: data.replace(b"description: Beta fixture skill\n", b"description: A separator ---\n"),
    )
    build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1")


def test_build_ignores_nested_short_fences_in_example():
    from release_builder import build

    source = replace_skill(
        "/skills/engineering/alpha/SKILL.md",
        lambda data: data + (
            b"\n````markdown\n```\n[example](missing.md)\n```\n"
            b"````not-a-close\n[example](also-missing.md)\n````\n"
        ),
    )
    build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1")


def test_build_scans_link_after_four_space_indented_fence_marker():
    from release_builder import build

    source = replace_skill(
        "/skills/engineering/alpha/SKILL.md",
        lambda data: data + b"\n    ```\n[example](missing.md)\n    ```\n",
    )
    with pytest.raises(ValueError, match="unresolved relocated link"):
        build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1")


@pytest.mark.parametrize("indent", range(4))
def test_build_ignores_fenced_links_with_up_to_three_spaces(indent):
    from release_builder import build

    padding = b" " * indent
    source = replace_skill(
        "/skills/engineering/alpha/SKILL.md",
        lambda data: data + b"\n" + padding + b"```\n[example](missing.md)\n" + padding + b"```\n",
    )
    build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1")


def test_build_ignores_four_space_marker_within_fence():
    from release_builder import build

    source = replace_skill(
        "/skills/engineering/alpha/SKILL.md",
        lambda data: data + b"\n```\n    ```\n[example](missing.md)\n```\n",
    )
    build(source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1")
