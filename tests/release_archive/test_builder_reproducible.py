import hashlib

from test_release_builder import REVISION, source_archive


def test_build_reproduces_identical_archives_for_identical_source():
    from release_builder import build

    source = source_archive()
    digest = hashlib.sha256(source).hexdigest()
    first, _ = build(source, digest, REVISION, "1.3.1", "1.3.1-1")
    second, _ = build(source, digest, REVISION, "1.3.1", "1.3.1-1")
    assert first == second
