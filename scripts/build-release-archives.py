import copy
import hashlib
import io
import json
import posixpath
import re
import stat
import tarfile
import urllib.parse
import zipfile

import yaml


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    ).encode("utf-8")


class UniqueLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        require(key not in result, f"duplicate YAML key: {key!r}")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping
)


def unique_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f"duplicate JSON key: {key}")
            result[key] = value
        return result

    return json.loads(data, object_pairs_hook=pairs)


def safe_path(path):
    require(isinstance(path, str) and path, "empty path")
    require("\\" not in path and ":" not in path
            and not any(ord(c) < 32 for c in path), f"unsafe path: {path}")
    require(not path.startswith("/"), f"absolute path: {path}")
    require(
        all(part not in ("", ".", "..") for part in path.split("/")),
        f"noncanonical path: {path}",
    )
    return path


def read_source(raw, expected_sha256, revision):
    require(digest(raw) == expected_sha256, "source archive hash mismatch")
    require(re.fullmatch(r"[0-9a-f]{40}", revision), "invalid source revision")
    expected_root = "mattpocock-skills-" + revision
    source = {}
    types = {}
    seen = set()

    # No tar extraction: read members strictly as data.
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        for member in archive:
            name = member.name.rstrip("/")
            safe_path(name)
            require(name not in seen, f"duplicate tar member: {name}")
            seen.add(name)
            parts = name.split("/")
            require(parts[0] == expected_root, "unexpected source root")
            if len(parts) == 1:
                require(member.isdir(), "source root is not a directory")
                continue
            relative = "/".join(parts[1:])
            types[relative] = member.type
            if member.isfile():
                require(
                    member.mode in (0o644, 0o755),
                    f"unsupported source mode: {relative}",
                )
                source[relative] = (
                    archive.extractfile(member).read(),
                    member.mode,
                )
    return source, types


def metadata(skill):
    require(skill.startswith(b"---\n"), "missing skill frontmatter")
    contents = skill.decode("utf-8")[4:]
    closing = re.search(r"^---[ \t]*$", contents, re.MULTILINE)
    require(closing is not None, "unterminated skill frontmatter")
    front = yaml.load(contents[:closing.start()], Loader=UniqueLoader)
    require(isinstance(front, dict), "frontmatter is not a mapping")
    return front


def markdown_targets(data):
    # Preserve the existing export's bounded inline-link scanner.
    fence = ""
    for line_number, line in enumerate(data.decode("utf-8").splitlines(), 1):
        match = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence:
            if (match and match[1][0] == fence[0] and len(match[1]) >= len(fence)
                    and not match[2].strip()):
                fence = ""
            continue
        if match:
            fence = match[1]
            continue
        pattern = r'(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)'
        for raw_target in re.findall(pattern, line):
            yield line_number, raw_target.strip("<>")


def verify_links(files):
    links = []
    for path, (data, mode) in sorted(files.items()):
        if not path.endswith(".md"):
            continue
        for line, raw_target in markdown_targets(data):
            target = resolve_relative(path, raw_target, files)
            if target is not None:
                links.append({"file": path, "line": line,
                              "target": raw_target, "resolved": target})
    return links


def resolve_relative(origin, raw_target, files):
    url = urllib.parse.urlsplit(raw_target)
    if url.scheme or url.netloc:
        return None
    if not url.path:
        return None
    path = urllib.parse.unquote(url.path)
    require(not path.startswith("/"), f"root-relative asset: {origin}: {path}")
    require("\\" not in path and "\0" not in path, "unsafe link target")
    target = posixpath.normpath(posixpath.join(posixpath.dirname(origin), path))
    require(
        target != ".." and not target.startswith("../"),
        f"link escapes archive: {origin}: {raw_target}",
    )
    require(
        target in files or any(p.startswith(target.rstrip("/") + "/") for p in files),
        f"unresolved relocated link: {origin}: {raw_target} -> {target}",
    )
    return target


def encode_zip(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for path, (data, mode) in sorted(files.items()):
            safe_path(path)
            info = zipfile.ZipInfo(path, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.create_version = 20
            info.extract_version = 20
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.internal_attr = 0
            info.extra = b""
            info.comment = b""
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, data)
    return output.getvalue()


def verify_zip(raw, files):
    actual = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(archive.testzip() is None, "ZIP integrity failure")
        infos = archive.infolist()
        require(
            len(infos) == len(files) == len({i.filename for i in infos}),
            "duplicate or missing archive members",
        )
        require(set(archive.namelist()) == set(files), "archive inventory mismatch")
        for info in infos:
            safe_path(info.filename)
            require(
                not any(info.filename.startswith(p + "/")
                        for p in files if p != info.filename),
                f"file/directory collision: {info.filename}",
            )
            data, mode = files[info.filename]
            require(stat.S_ISREG(info.external_attr >> 16), "nonregular ZIP member")
            require(archive.read(info) == data, f"byte mismatch: {info.filename}")
            require(
                stat.S_IMODE(info.external_attr >> 16) == mode,
                f"mode mismatch: {info.filename}",
            )
            actual[info.filename] = (archive.read(info), mode)
    return actual


def build(raw, expected_sha256, revision, base, release):
    """Return two release ZIPs and their verification report as data.

    raw is one immutable source tarball; expected_sha256 and revision bind
    the caller-selected input. No filesystem writes or network access occur.
    """
    numeric = r"(?:0|[1-9][0-9]*)"
    base_match = re.fullmatch(rf"({numeric})\.({numeric})\.({numeric})", base)
    require(base_match, "invalid base version")
    release_match = re.fullmatch(
        rf"({numeric})\.({numeric})\.({numeric})\+from\.{re.escape(base)}", release
    )
    require(release_match, "invalid release version")
    require(
        release_match.group(1, 2) == base_match.group(1, 2)
        and int(release_match.group(3)) > int(base_match.group(3)),
        "release must retain upstream major and minor and advance its patch",
    )
    source, types = read_source(raw, expected_sha256, revision)
    claude = unique_json(source[".claude-plugin/plugin.json"][0])
    native = unique_json(source[".codex-plugin/plugin.json"][0])
    package = unique_json(source["package.json"][0])
    require(
        claude.get("name") == native.get("name") == "mattpocock-skills",
        "source plugin name mismatch",
    )
    source_version = package["version"]
    require(
        isinstance(source_version, str)
        and source_version == release
        and claude["version"] == native["version"] == source_version,
        "source version mismatch",
    )

    roots = claude["skills"]
    require(isinstance(roots, list) and roots, "missing promoted selection")
    require(all(isinstance(p, str) for p in roots), "invalid manifest path")
    require(len(roots) == len(set(roots)), "duplicate manifest roots")
    require(native["skills"] == roots, "native inventories disagree")
    roots = [p[2:] if p.startswith("./") else p for p in roots]
    require(len(roots) == len(set(roots)), "normalized root collision")
    require(
        all(re.fullmatch(r"skills/(engineering|productivity)/[a-z0-9]+"
                         r"(?:-[a-z0-9]+)*", p) for p in roots),
        "selection outside promoted skill roots",
    )
    promoted = {
        p.rsplit("/", 1)[0]
        for p in source
        if re.fullmatch(r"skills/(engineering|productivity)/[^/]+/SKILL.md", p)
    }
    require(set(roots) == promoted, "incomplete or extra promoted membership")
    names = [p.rsplit("/", 1)[1] for p in roots]
    require(len(names) == len(set(names)), "duplicate destination skill names")

    selected = {
        p: entry for p, entry in source.items()
        if any(p.startswith(root + "/") for root in roots)
    }
    for root in roots:
        parts = root.split("/")
        for length in range(1, len(parts) + 1):
            ancestor = "/".join(parts[:length])
            require(types.get(ancestor) == tarfile.DIRTYPE,
                    f"selected ancestor is not a directory: {ancestor}")
    for path, member_type in types.items():
        if any(path.startswith(root + "/") for root in roots):
            require(
                member_type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE),
                f"selected symlink or special member: {path}",
            )

    for root, name in zip(roots, names):
        require(root + "/SKILL.md" in selected, f"missing skill: {name}")
        require(root + "/agents/openai.yaml" in selected, f"missing controls: {name}")
        require(
            not any(p.endswith("/SKILL.md") and p != root + "/SKILL.md"
                    for p in selected if p.startswith(root + "/")),
            f"nested skill: {name}",
        )
        front = metadata(selected[root + "/SKILL.md"][0])
        require(front.get("name") == name, f"skill name mismatch: {name}")
        require(
            isinstance(front.get("description"), str) and front["description"].strip(),
            f"missing description: {name}",
        )
        flag = front.get("disable-model-invocation")
        require(flag is None or type(flag) is bool, "invalid invocation flag")
        agent = yaml.load(
            selected[root + "/agents/openai.yaml"][0], Loader=UniqueLoader
        )
        require(isinstance(agent, dict), "invalid invocation metadata")
        policy = agent.get("policy", {})
        require(isinstance(policy, dict), "invalid invocation policy")
        implicit = policy.get("allow_implicit_invocation")
        require(implicit is None or type(implicit) is bool, "invalid policy flag")
        require((implicit is False) == (flag is True), f"unpaired controls: {name}")

    allowed = {
        "name", "version", "description", "author", "homepage",
        "repository", "license", "keywords", "skills",
    }
    require(set(claude) <= allowed, "new manifest fields need projection review")
    portable = {k: copy.deepcopy(v) for k, v in claude.items() if k != "skills"}
    portable["$schema"] = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
    portable["extensions"] = {"com.openai": {"interface": copy.deepcopy(native["interface"])}}
    projected_claude = copy.deepcopy(claude)
    projected_claude["displayName"] = native["interface"]["displayName"]
    for manifest in (portable, projected_claude):
        manifest["version"] = release
        manifest["repository"] = "https://github.com/nisavid/real-skills"

    outputs = {}
    report = {
        "source_revision": revision,
        "source_sha256": expected_sha256,
        "source_version": source_version,
        "base_version": base,
        "release_version": release,
        "archives": {},
        "limitations": [
            "Source hash and supplied revision identity checked; Git commit object not reconstructed",
            "Relative file paths checked; fragment anchors and external URLs not verified",
            "No installation, schema service, harness execution, or workflow execution performed",
        ],
    }

    for format_name, manifest_path, manifest in (
        ("agent-plugins", "plugin.json", portable),
        ("claude", ".claude-plugin/plugin.json", projected_claude),
    ):
        files = {}
        mapping = {}
        for root, name in zip(roots, names):
            for original, entry in selected.items():
                if not original.startswith(root + "/"):
                    continue
                destination = (
                    "skills/" + name + original[len(root):]
                    if format_name == "agent-plugins" else original
                )
                require(destination not in files, "destination collision")
                files[destination] = entry
                mapping[original] = destination
        require(set(mapping) == set(selected), "incomplete selected-file projection")

        files["LICENSE"] = source["LICENSE"]
        files[manifest_path] = (json_bytes(manifest), 0o644)
        provenance = {
            "source_revision": revision,
            "source_sha256": expected_sha256,
            "source_version": source_version,
            "base_version": base,
            "release_version": release,
            "format": format_name,
            "manifest_transform": {
                "source": ".claude-plugin/plugin.json",
                "before": claude,
                "after": manifest,
                "generated_mode": "0o644",
                "interface_source": (
                    {"path": ".codex-plugin/plugin.json",
                     "sha256": digest(source[".codex-plugin/plugin.json"][0]),
                     "field": "interface"}
                    if format_name == "agent-plugins" else None
                ),
                "skill_path_rule": (
                    "skills/<bucket>/<name>/<suffix> -> skills/<name>/<suffix>"
                    if format_name == "agent-plugins" else "identity"
                ),
                "skill_and_support_content": "identity",
                "license_content_and_mode": "identity",
            },
            "source_mapping": [
                {
                    "source": original,
                    "archive": destination,
                    "sha256": digest(source[original][0]),
                    "mode": oct(source[original][1]),
                }
                for original, destination in sorted(mapping.items())
            ],
            "license_sha256": digest(source["LICENSE"][0]),
        }
        files["RELEASE.json"] = (json_bytes(provenance), 0o644)

        archive_bytes = encode_zip(files)
        require(archive_bytes == encode_zip(files), "nondeterministic rebuild")
        actual = verify_zip(archive_bytes, files)
        links = verify_links(actual)
        filename = f"skills-for-real-engineers-{release}-{format_name}.zip"
        outputs[filename] = archive_bytes
        report["archives"][filename] = {
            "sha256": digest(archive_bytes),
            "bytes": len(archive_bytes),
            "members": len(files),
            "relative_links": links,
            "source_mapping": provenance["source_mapping"],
        }

    return outputs, report
