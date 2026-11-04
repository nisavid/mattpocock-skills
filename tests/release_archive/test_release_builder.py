import hashlib
import io
import json
import stat
import tarfile
import zipfile


REVISION = "0123456789abcdef0123456789abcdef01234567"
ALPHA_SKILL = (
    b"---\nname: alpha\ndescription: Alpha fixture skill\n---\n"
    b"Keep these literal skill bytes.\n"
)
ALPHA_AGENT = (
    b"interface:\n  display_name: Alpha\n"
    b"  short_description: Alpha fixture skill\n"
)
ALPHA_SCRIPT = b"#!/bin/sh\nprintf 'fixture only\\n'\n"
BETA_SKILL = (
    b"---\nname: beta\ndescription: Beta fixture skill\n"
    b"disable-model-invocation: true\n---\n"
    b"Keep these different literal skill bytes.\n"
)
BETA_AGENT = (
    b"interface:\n  display_name: Beta\n"
    b"  short_description: Beta fixture skill\n"
    b"policy:\n  allow_implicit_invocation: false\n"
)
BETA_DATA = b"\x00\xffliteral support bytes\r\n"
LICENSE = b"MIT fixture license\nCopyright (c) 2026 Fixture Author\n"


def source_archive(source_version="1.3.1", native_version=None):
    roots = ["./skills/engineering/alpha", "./skills/productivity/beta"]
    manifest = {
        "name": "mattpocock-skills",
        "version": source_version,
        "description": "Synthetic release fixture",
        "author": {"name": "Fixture Author"},
        "license": "MIT",
        "skills": roots,
    }
    native = dict(manifest, interface={
        "displayName": "Fixture Skills",
        "shortDescription": "Fixture skills",
        "developerName": "Fixture Author",
        "category": "Developer Tools",
    })
    if native_version is not None:
        native["version"] = native_version
    files = {
        ".claude-plugin/plugin.json": (json.dumps(manifest).encode(), 0o644),
        ".codex-plugin/plugin.json": (json.dumps(native).encode(), 0o644),
        "package.json": (json.dumps({"version": source_version}).encode(), 0o644),
        "LICENSE": (LICENSE, 0o644),
        "skills/engineering/alpha/SKILL.md": (ALPHA_SKILL, 0o644),
        "skills/engineering/alpha/agents/openai.yaml": (ALPHA_AGENT, 0o644),
        "skills/engineering/alpha/scripts/run.sh": (ALPHA_SCRIPT, 0o755),
        "skills/productivity/beta/SKILL.md": (BETA_SKILL, 0o644),
        "skills/productivity/beta/agents/openai.yaml": (BETA_AGENT, 0o644),
        "skills/productivity/beta/assets/data.bin": (BETA_DATA, 0o644),
    }
    root = "mattpocock-skills-" + REVISION
    directories = {root}
    for path in files:
        parts = (root + "/" + path).split("/")
        directories.update("/".join(parts[:n]) for n in range(1, len(parts)))
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for directory in sorted(directories):
            info = tarfile.TarInfo(directory)
            info.type = tarfile.DIRTYPE
            info.mode = 0o755
            archive.addfile(info)
        for path, (data, mode) in sorted(files.items()):
            info = tarfile.TarInfo(root + "/" + path)
            info.size = len(data)
            info.mode = mode
            archive.addfile(info, io.BytesIO(data))
    return output.getvalue()


def test_build_separates_source_version_from_upstream_base():
    from release_builder import build

    source = source_archive(source_version="1.3.2")
    archives, _report = build(
        source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.3+from.1.3.1"
    )
    for fmt, manifest_path in (
        ("agent-plugins", "plugin.json"),
        ("claude", ".claude-plugin/plugin.json"),
    ):
        with zipfile.ZipFile(io.BytesIO(archives[f"skills-for-real-engineers-1.3.3+from.1.3.1-{fmt}.zip"])) as archive:
            assert json.loads(archive.read(manifest_path))["version"] == "1.3.3+from.1.3.1"
            provenance = json.loads(archive.read("RELEASE.json"))
            assert provenance["base_version"] == "1.3.1"
            assert provenance["source_version"] == "1.3.2"


def test_build_release_versions_in_both_manifests():
    from release_builder import build

    source = source_archive()
    archives, _report = build(
        source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1"
    )
    for fmt, manifest_path in (
        ("agent-plugins", "plugin.json"),
        ("claude", ".claude-plugin/plugin.json"),
    ):
        with zipfile.ZipFile(io.BytesIO(archives[f"skills-for-real-engineers-1.3.2+from.1.3.1-{fmt}.zip"])) as archive:
            assert json.loads(archive.read(manifest_path))["version"] == "1.3.2+from.1.3.1"


def test_build_preserves_selected_files_in_both_release_layouts():
    from release_builder import build

    source = source_archive()
    archives, _report = build(
        source, hashlib.sha256(source).hexdigest(), REVISION, "1.3.1", "1.3.2+from.1.3.1"
    )
    expected_archives = {
        "skills-for-real-engineers-1.3.2+from.1.3.1-agent-plugins.zip": (
            "plugin.json",
            {
                "skills/alpha/SKILL.md": (ALPHA_SKILL, 0o644),
                "skills/alpha/agents/openai.yaml": (ALPHA_AGENT, 0o644),
                "skills/alpha/scripts/run.sh": (ALPHA_SCRIPT, 0o755),
                "skills/beta/SKILL.md": (BETA_SKILL, 0o644),
                "skills/beta/agents/openai.yaml": (BETA_AGENT, 0o644),
                "skills/beta/assets/data.bin": (BETA_DATA, 0o644),
            },
        ),
        "skills-for-real-engineers-1.3.2+from.1.3.1-claude.zip": (
            ".claude-plugin/plugin.json",
            {
                "skills/engineering/alpha/SKILL.md": (ALPHA_SKILL, 0o644),
                "skills/engineering/alpha/agents/openai.yaml": (ALPHA_AGENT, 0o644),
                "skills/engineering/alpha/scripts/run.sh": (ALPHA_SCRIPT, 0o755),
                "skills/productivity/beta/SKILL.md": (BETA_SKILL, 0o644),
                "skills/productivity/beta/agents/openai.yaml": (BETA_AGENT, 0o644),
                "skills/productivity/beta/assets/data.bin": (BETA_DATA, 0o644),
            },
        ),
    }
    assert set(archives) == set(expected_archives)
    for filename, (manifest_path, selected) in expected_archives.items():
        with zipfile.ZipFile(io.BytesIO(archives[filename])) as archive:
            expected_members = set(selected) | {manifest_path, "LICENSE", "RELEASE.json"}
            assert set(archive.namelist()) == expected_members
            assert len(archive.infolist()) == len(expected_members)
            for path, (data, mode) in {**selected, "LICENSE": (LICENSE, 0o644)}.items():
                info = archive.getinfo(path)
                assert archive.read(path) == data, path
                assert info.create_system == 3, path
                assert stat.S_ISREG(info.external_attr >> 16), path
                assert stat.S_IMODE(info.external_attr >> 16) == mode, path
            manifest = json.loads(archive.read(manifest_path))
            assert manifest["version"] == "1.3.2+from.1.3.1"
            assert manifest["author"] == {"name": "Fixture Author"}
            if manifest_path == ".claude-plugin/plugin.json":
                assert manifest["displayName"] == "Fixture Skills"
                assert manifest["skills"] == [
                    "./skills/engineering/alpha", "./skills/productivity/beta"
                ]
