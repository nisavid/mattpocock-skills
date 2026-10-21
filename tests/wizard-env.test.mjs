import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, chownSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(repo, "skills/engineering/wizard/template.sh"), "utf8");
const marker = template.indexOf("\n# STAGES:");
assert.notEqual(marker, -1, "the wizard template must expose its library before STAGES");
const library = template.slice(0, marker);
const python = spawnSync("bash", ["-c", "command -v python3"], { encoding: "utf8" }).stdout.trim();
const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "wizard-env-test-")));
  const root = join(base, "project");
  mkdirSync(root);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const put = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  const run = (body, options = {}) => spawnSync("bash", ["-c", library + "\n" + body], {
    cwd: root,
    env: { ...process.env, ENV_FILE: options.envFile ?? ".env", ...options.env },
    input: options.input ?? "",
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  return { base, root, put, run };
}

function snapshot(root) {
  const entries = {};
  function visit(path) {
    const fullPath = join(root, path);
    const info = lstatSync(fullPath);
    entries[path] = {
      mode: info.mode, inode: info.ino,
      bytes: info.isFile() ? readFileSync(fullPath) : null,
      link: info.isSymbolicLink() ? readlinkSync(fullPath) : null,
    };
    if (info.isDirectory()) for (const name of readdirSync(fullPath).sort()) visit(join(path, name));
  }
  visit("");
  return entries;
}

function noStagingFiles(root) {
  for (const name of readdirSync(root)) {
    assert.ok(!name.startsWith(".wizard-env-"), `unexpected staging entry: ${name}`);
    const path = join(root, name);
    if (lstatSync(path).isDirectory()) noStagingFiles(path);
  }
}

const guardedWrite = `
if write_env TOKEN 'synthetic-new-value'; then rc=0; else rc=$?; fi
printf 'RESULT:%s WRITTEN:%s\\n' "$rc" "\${#WRITTEN_ENV[@]}"
`;

function assertRejectedWrite(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESULT:2 WRITTEN:0/);
  assert.doesNotMatch(result.stdout, /✓ wrote/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-new-value/);
  assert.match(result.stderr, /unsafe ENV_FILE|failed environment access/);
}

test("startup and write_env reject symlinked, outside, traversing, and non-file destinations", async (t) => {
  const cases = {
    "existing leaf symlink to an outside file": (f) => {
      symlinkSync(join(f.base, "outside.env"), join(f.root, ".env"));
      return ".env";
    },
    "dangling leaf symlink outside the project": (f) => {
      symlinkSync(join(f.base, "must-not-be-created.env"), join(f.root, ".env"));
      return ".env";
    },
    "dangling leaf symlink inside the project": (f) => {
      symlinkSync("must-not-be-created.env", join(f.root, ".env"));
      return ".env";
    },
    "leaf symlink to a directory": (f) => {
      symlinkSync(f.base, join(f.root, ".env"));
      return ".env";
    },
    "symlinked parent leading outside": (f) => {
      symlinkSync(f.base, join(f.root, "config"));
      return "config/outside.env";
    },
    "symlinked parent leading inside": (f) => {
      f.put("actual/.env", "TOKEN='synthetic-internal-sentinel'\n");
      symlinkSync("actual", join(f.root, "config"));
      return "config/.env";
    },
    "absolute outside path": (f) => join(f.base, "outside.env"),
    "absolute path with a project-prefix lookalike": (f) => {
      mkdirSync(f.root + "-other");
      writeFileSync(join(f.root + "-other", ".env"), "synthetic-prefix-sentinel\n");
      return join(f.root + "-other", ".env");
    },
    "relative parent traversal": () => "../outside.env",
    "parent traversal that resolves inside": (f) => {
      mkdirSync(join(f.root, "config"));
      return "config/../.env";
    },
    "directory leaf": (f) => {
      mkdirSync(join(f.root, ".env"));
      return ".env";
    },
    "FIFO leaf": (f) => {
      const made = spawnSync("mkfifo", [join(f.root, ".env")], { encoding: "utf8" });
      assert.equal(made.status, 0, made.stderr);
      return ".env";
    },
  };
  for (const [name, setup] of Object.entries(cases)) await t.test(name, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.base, "outside.env"), "TOKEN='synthetic-outside-sentinel'\n");
    const destination = setup(f);
    const before = snapshot(f.base);
    const startup = f.run("printf 'LIBRARY_LOADED\\n'", { envFile: destination });
    assert.equal(startup.error, undefined);
    assert.equal(startup.status, 2, startup.stderr);
    assert.doesNotMatch(startup.stdout, /LIBRARY_LOADED/);
    assert.deepEqual(snapshot(f.base), before);

    // Start from a safe filename so this also exercises the per-call boundary.
    const result = f.run(`ENV_FILE=${quote(destination)}\n${guardedWrite}`, { envFile: "safe-start.env" });
    assertRejectedWrite(result);
    assert.deepEqual(snapshot(f.base), before);
  });
});

test("unsafe defaults propagate through _existing, ask, and ask_secret before reading input", async (t) => {
  for (const operation of ["_existing", "ask", "ask_secret"]) await t.test(operation, (t) => {
    const f = fixture(t);
    const saved = "synthetic-must-not-read-or-print";
    writeFileSync(join(f.base, "outside.env"), `TOKEN='${saved}'\n`);
    symlinkSync(join(f.base, "outside.env"), join(f.root, "unsafe.env"));
    const before = snapshot(f.base);
    const call = operation === "_existing" ? 'current=$(_existing TOKEN)' : `${operation} TOKEN 'Synthetic prompt:'`;
    const result = f.run(`
ENV_FILE=unsafe.env
TOKEN=unchanged
if ${call}; then rc=0; else rc=$?; fi
IFS= read -r remaining
printf 'RESULT:%s VALUE:%s NEXT:%s\\n' "$rc" "$TOKEN" "$remaining"
`, { input: "synthetic-prompt-input\n" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /RESULT:2 VALUE:unchanged NEXT:synthetic-prompt-input/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(saved));
    assert.deepEqual(snapshot(f.base), before);
  });
});

test("missing saved files and keys return 1 and prompts still accept input", async (t) => {
  const f = fixture(t);
  let result = f.run('if _existing TOKEN; then rc=0; else rc=$?; fi; printf "RESULT:%s\\n" "$rc"');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESULT:1/);
  assert.equal(result.stderr, "");
  f.put(".env", "OTHER='synthetic-other'\n");
  result = f.run('if _existing TOKEN; then rc=0; else rc=$?; fi; printf "RESULT:%s\\n" "$rc"');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESULT:1/);
  assert.equal(result.stderr, "");
  for (const operation of ["ask", "ask_secret"]) await t.test(operation, () => {
    const accepted = f.run(`${operation} TOKEN 'Synthetic prompt:'\n[[ "$TOKEN" == synthetic-input ]]\nprintf 'ACCEPTED\\n'`, { input: "synthetic-input\n" });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /ACCEPTED/);
    const eof = f.run(`if ${operation} TOKEN 'Synthetic prompt:'; then rc=0; else rc=$?; fi\nprintf 'RESULT:%s\\n' "$rc"`);
    assert.equal(eof.status, 0, eof.stderr);
    assert.match(eof.stdout, /RESULT:1/);
  });
});

test("new files are private, quote values, remove duplicate keys, and retain unrelated bytes", (t) => {
  const f = fixture(t);
  const value = "synthetic quote ' slash \\ dollar $(not-run) `not-run` \"double\"  ";
  const result = f.run(`umask 000\nwrite_env TOKEN ${quote(value)}\nwrite_env TOKEN ${quote(value)}\nprintf 'WRITTEN:%s\\n' "\${#WRITTEN_ENV[@]}"`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WRITTEN:2/);
  assert.ok(!result.stdout.includes(value));
  assert.equal(statSync(join(f.root, ".env")).mode & 0o777, 0o600);
  const assignment = `TOKEN='${value.replaceAll("'", "'\\''")}'\n`;
  assert.equal(readFileSync(join(f.root, ".env"), "utf8"), assignment);

  const untouched = Buffer.from("# synthetic bytes \xff\r\nOTHER='unchanged'\nTOKEN_EXTRA=unchanged\nexport TOKEN=unchanged\n", "latin1");
  f.put(".env", Buffer.concat([
    Buffer.from("TOKEN='synthetic-old-first'\n"), untouched,
    Buffer.from("TOKEN='synthetic-old-last'\n"),
  ]));
  const updated = f.run(`write_env TOKEN ${quote(value)}\n[[ "$(_existing TOKEN)" == ${quote(value)} ]]`);
  assert.equal(updated.status, 0, updated.stderr);
  assert.deepEqual(readFileSync(join(f.root, ".env")), Buffer.concat([untouched, Buffer.from(assignment)]));
  noStagingFiles(f.root);
});

test("defaults use the last assignment and undo write_env's apostrophe quoting", async (t) => {
  const f = fixture(t);
  const value = "synthetic last 'quoted' value";
  f.put(".env", "TOKEN='synthetic-first'\nTOKEN='synthetic last '\\''quoted'\\'' value'\n");
  const existing = f.run('current=$(_existing TOKEN)\nprintf "%s" "$current"');
  assert.equal(existing.status, 0, existing.stderr);
  assert.equal(existing.stdout, value);
  for (const operation of ["ask", "ask_secret"]) await t.test(operation, () => {
    const result = f.run(`${operation} TOKEN 'Synthetic prompt:'\n[[ "$TOKEN" == ${quote(value)} ]]\nprintf 'KEPT_DEFAULT\\n'`, { input: "\n" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /KEPT_DEFAULT/);
    assert.ok(!result.stdout.includes(value), "a prompt must not print the saved value");
  });
});

test("nested paths with spaces and absolute paths inside the launch project are accepted", async (t) => {
  for (const absolute of [false, true]) await t.test(absolute ? "absolute" : "relative", (t) => {
    const f = fixture(t);
    mkdirSync(join(f.root, "config with spaces"));
    const relative = "config with spaces/values.env";
    const destination = absolute ? join(f.root, relative) : relative;
    const result = f.run("write_env TOKEN 'synthetic-inside'", { envFile: destination });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(f.root, relative), "utf8"), "TOKEN='synthetic-inside'\n");
    assert.equal(statSync(join(f.root, relative)).mode & 0o777, 0o600);
    noStagingFiles(f.root);
  });
});

test("changing cwd still reads and updates the launch project's environment file", (t) => {
  const f = fixture(t);
  f.put(".env", "TOKEN='synthetic-launch'\n");
  f.put("elsewhere/.env", "TOKEN='synthetic-cwd-sentinel'\n");
  const result = f.run(`cd elsewhere\n[[ "$(_existing TOKEN)" == synthetic-launch ]]\nwrite_env TOKEN 'synthetic-updated'`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.root, ".env"), "utf8"), "TOKEN='synthetic-updated'\n");
  assert.equal(readFileSync(join(f.root, "elsewhere/.env"), "utf8"), "TOKEN='synthetic-cwd-sentinel'\n");
});

test("the pinned launch directory survives renaming and replacement of its old pathname", (t) => {
  const f = fixture(t);
  f.put(".env", "TOKEN='synthetic-original-root'\n");
  const result = f.run(`
mv ${quote(f.root)} ${quote(f.root + ".moved")}
mkdir ${quote(f.root)}
printf "TOKEN='synthetic-decoy'\\n" > ${quote(join(f.root, ".env"))}
[[ "$(_existing TOKEN)" == synthetic-original-root ]]
write_env TOKEN 'synthetic-pinned-update'
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.root + ".moved", ".env"), "utf8"), "TOKEN='synthetic-pinned-update'\n");
  assert.equal(readFileSync(join(f.root, ".env"), "utf8"), "TOKEN='synthetic-decoy'\n");
});

test("atomic replacement preserves mode and ownership, changes inode, and breaks hard links", (t) => {
  const f = fixture(t);
  const original = "TOKEN='synthetic-before'\nOTHER=unchanged\n";
  f.put(".env", original);
  const owner = statSync(join(f.root, ".env"));
  const group = process.getgroups?.().find((gid) => gid !== owner.gid);
  if (group !== undefined) chownSync(join(f.root, ".env"), owner.uid, group);
  chmodSync(join(f.root, ".env"), 0o640);
  linkSync(join(f.root, ".env"), join(f.base, "hardlink.env"));
  const before = statSync(join(f.root, ".env"));
  const result = f.run("write_env TOKEN 'synthetic-after'");
  assert.equal(result.status, 0, result.stderr);
  const after = statSync(join(f.root, ".env"));
  assert.equal(after.mode & 0o7777, before.mode & 0o7777);
  assert.equal(after.uid, before.uid);
  assert.equal(after.gid, before.gid);
  assert.notEqual(after.ino, before.ino);
  assert.equal(after.nlink, 1);
  assert.equal(statSync(join(f.base, "hardlink.env")).ino, before.ino);
  assert.equal(readFileSync(join(f.base, "hardlink.env"), "utf8"), original);
  assert.equal(readFileSync(join(f.root, ".env"), "utf8"), "OTHER=unchanged\nTOKEN='synthetic-after'\n");
  noStagingFiles(f.root);
});

test("workspace modules and PYTHONPATH cannot replace the helper's standard-library imports", (t) => {
  const f = fixture(t);
  const marker = join(f.base, "poison-imported");
  const poison = `open(${JSON.stringify(marker)}, 'w').write('synthetic poison imported')\nraise RuntimeError('synthetic poisoned import')\n`;
  for (const name of ["secrets.py", "subprocess.py"]) {
    f.put(name, poison);
    f.put("injected-pythonpath/" + name, poison);
  }
  const result = f.run("write_env TOKEN 'synthetic-isolated'\n[[ \"$(_existing TOKEN)\" == synthetic-isolated ]]", {
    env: { PYTHONPATH: join(f.root, "injected-pythonpath") },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.root, ".env"), "utf8"), "TOKEN='synthetic-isolated'\n");
  assert.throws(() => lstatSync(marker), { code: "ENOENT" });
});

test("existing extended attributes survive atomic replacement", (t) => {
  const f = fixture(t);
  f.put(".env", "TOKEN='synthetic-before'\n");
  const destination = join(f.root, ".env");
  const attribute = process.platform === "darwin" ? "com.example.wizard-test" : "user.wizard_test";
  const setup = spawnSync(python, ["-I", "-c", `
import errno, os, sys
try:
    os.setxattr(sys.argv[1], sys.argv[2], b'synthetic-xattr-bytes\\x00\\xff')
except OSError as error:
    if error.errno in (errno.ENOTSUP, errno.EOPNOTSUPP):
        sys.exit(77)
    raise
`, destination, attribute], { encoding: "utf8" });
  if (setup.status === 77) return t.skip("fixture filesystem does not support extended attributes");
  assert.equal(setup.status, 0, setup.stderr);
  const result = f.run("write_env TOKEN 'synthetic-after'");
  assert.equal(result.status, 0, result.stderr);
  const check = spawnSync(python, ["-I", "-c", "import os, sys; assert os.getxattr(sys.argv[1], sys.argv[2]) == b'synthetic-xattr-bytes\\x00\\xff'", destination, attribute], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("existing Linux POSIX ACL entries survive atomic replacement", { skip: process.platform !== "linux" && "Linux POSIX ACL format" }, (t) => {
  const f = fixture(t);
  f.put(".env", "TOKEN='synthetic-before'\n");
  const destination = join(f.root, ".env");
  const setup = spawnSync(python, ["-I", "-c", `
import errno, os, struct, sys
# Use a mapped ID even in a single-UID container. This verifies ACL metadata
# roundtripping; it does not claim to test access by a different principal.
entries = [(1, 6, 0xffffffff), (2, 4, os.getuid()),
           (4, 0, 0xffffffff), (16, 4, 0xffffffff), (32, 0, 0xffffffff)]
acl = struct.pack('<I', 2) + b''.join(struct.pack('<HHI', *entry) for entry in entries)
try:
    os.setxattr(sys.argv[1], 'system.posix_acl_access', acl)
except OSError as error:
    if error.errno in (errno.ENOTSUP, errno.EOPNOTSUPP):
        sys.exit(77)
    raise
sys.stdout.buffer.write(os.getxattr(sys.argv[1], 'system.posix_acl_access'))
`, destination]);
  if (setup.status === 77) return t.skip("fixture filesystem does not support POSIX ACLs");
  assert.equal(setup.status, 0, setup.stderr?.toString());
  const before = statSync(destination);
  const result = f.run("write_env TOKEN 'synthetic-after'");
  assert.equal(result.status, 0, result.stderr);
  const check = spawnSync(python, ["-I", "-c", "import os, sys; sys.stdout.buffer.write(os.getxattr(sys.argv[1], 'system.posix_acl_access'))", destination]);
  assert.equal(check.status, 0, check.stderr?.toString());
  assert.deepEqual(check.stdout, setup.stdout);
  assert.equal(statSync(destination).mode & 0o7777, before.mode & 0o7777);
  assert.equal(readFileSync(destination, "utf8"), "TOKEN='synthetic-after'\n");
});

test("macOS preserves an existing ACL while removing inherited access from staging and new files", { skip: process.platform !== "darwin" && "native macOS ACL API" }, (t) => {
  const f = fixture(t);
  f.put(".env", "TOKEN='synthetic-before'\n");
  chmodSync(join(f.root, ".env"), 0o600);
  // Inspect the native ACL, including an empty ACL, without parsing ls output.
  const nativeAcl = `
import ctypes, errno, os, stat
acl_lib = ctypes.CDLL(None, use_errno=True)
acl_lib.acl_init.argtypes = [ctypes.c_int]
acl_lib.acl_init.restype = ctypes.c_void_p
acl_lib.acl_set_fd.argtypes = [ctypes.c_int, ctypes.c_void_p]
acl_lib.acl_get_fd.argtypes = [ctypes.c_int]
acl_lib.acl_get_fd.restype = ctypes.c_void_p
acl_lib.acl_to_text.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ssize_t)]
acl_lib.acl_to_text.restype = ctypes.c_void_p
acl_lib.acl_free.argtypes = [ctypes.c_void_p]

def acl_error():
    number = ctypes.get_errno()
    return OSError(number, os.strerror(number))

def acl_text(fd):
    acl = acl_lib.acl_get_fd(fd)
    if not acl:
        raise acl_error()
    text = None
    try:
        text = acl_lib.acl_to_text(acl, None)
        if not text:
            raise acl_error()
        return ctypes.string_at(text).decode('utf-8')
    finally:
        if text:
            acl_lib.acl_free(text)
        acl_lib.acl_free(acl)

def acl_entries(fd):
    return [line for line in acl_text(fd).splitlines() if line and not line.startswith('!#')]
`;
  const capability = spawnSync(python, ["-I", "-c", nativeAcl + `
import sys
fd = os.open(sys.argv[1], os.O_RDWR)
empty = acl_lib.acl_init(0)
if not empty:
    raise acl_error()
try:
    try:
        if acl_lib.acl_set_fd(fd, empty) != 0:
            raise acl_error()
        assert acl_entries(fd) == []
    except OSError as error:
        if error.errno in (errno.ENOTSUP, errno.EOPNOTSUPP):
            sys.exit(77)
        raise
finally:
    acl_lib.acl_free(empty)
    os.close(fd)
`, join(f.root, ".env")], { encoding: "utf8" });
  if (capability.status === 77) return t.skip("fixture filesystem reports native ACLs unsupported");
  assert.equal(capability.status, 0, capability.stderr);

  const setAcl = (entry, path) => {
    const result = spawnSync("/bin/chmod", ["+a", entry, path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  // Create the existing file's explicit ACL before adding parent inheritance.
  setAcl("everyone deny write", join(f.root, ".env"));
  setAcl("everyone allow read,execute,file_inherit,directory_inherit", f.root);
  mkdirSync(join(f.root, "inheritance-probe"));
  f.put("inheritance-probe/value", "synthetic-inheritance-probe\n");
  const before = spawnSync(python, ["-I", "-c", nativeAcl + `
import sys
for path in sys.argv[2:]:
    fd = os.open(path, os.O_RDONLY)
    try:
        assert any('inherited' in entry for entry in acl_entries(fd)), path
    finally:
        os.close(fd)
fd = os.open(sys.argv[1], os.O_RDONLY)
try:
    assert acl_entries(fd), 'existing fixture must have a real ACL'
    sys.stdout.write(acl_text(fd))
finally:
    os.close(fd)
`, join(f.root, ".env"), join(f.root, "inheritance-probe"), join(f.root, "inheritance-probe/value")], { encoding: "utf8" });
  assert.equal(before.status, 0, before.stderr);

  const log = join(f.base, "darwin-staging-inspections.jsonl");
  const env = pythonHarness(f, nativeAcl + `
if sys.argv[3] == 'write':
    real_open = os.open
    def inspect_replacement(path, flags, *args, **kwargs):
        fd = real_open(path, flags, *args, **kwargs)
        if path == 'value' and 'dir_fd' in kwargs:
            parent = kwargs['dir_fd']
            # This runs immediately after creation, before helper writes data.
            assert stat.S_IMODE(os.fstat(parent).st_mode) == 0o700
            assert acl_entries(parent) == [], 'staging retained inherited ACL access'
            assert stat.S_IMODE(os.fstat(fd).st_mode) == 0o600
            assert acl_entries(fd) == [], 'replacement inherited ACL access'
            with open(${JSON.stringify(log)}, 'a') as output:
                output.write(json.dumps(sys.argv[2]) + '\\n')
        return fd
    os.open = inspect_replacement
`);
  const existing = f.run("umask 000\nwrite_env TOKEN 'synthetic-existing-after'", { env });
  assert.equal(existing.status, 0, existing.stderr);
  const created = f.run("umask 000\nwrite_env TOKEN 'synthetic-new-after'", { env, envFile: "new.env" });
  assert.equal(created.status, 0, created.stderr);
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)), [".env", "new.env"]);

  const after = spawnSync(python, ["-I", "-c", nativeAcl + `
import sys
fd = os.open(sys.argv[2], os.O_RDONLY)
try:
    assert stat.S_IMODE(os.fstat(fd).st_mode) == 0o600
    assert acl_entries(fd) == [], 'new final file gained inherited ACL access'
finally:
    os.close(fd)
fd = os.open(sys.argv[1], os.O_RDONLY)
try:
    sys.stdout.write(acl_text(fd))
finally:
    os.close(fd)
`, join(f.root, ".env"), join(f.root, "new.env")], { encoding: "utf8" });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, before.stdout, "the existing explicit ACL must survive replacement");
  assert.equal(readFileSync(join(f.root, ".env"), "utf8"), "TOKEN='synthetic-existing-after'\n");
  assert.equal(readFileSync(join(f.root, "new.env"), "utf8"), "TOKEN='synthetic-new-after'\n");
  noStagingFiles(f.root);
});

// Run the actual embedded Python unchanged, adding deterministic failures at
// standard-library boundaries. Production code needs no testing switch.
function pythonHarness(f, patch) {
  assert.ok(python, "python3 is required by the wizard");
  const bin = join(f.base, "bin");
  mkdirSync(bin);
  const path = join(bin, "python3");
  writeFileSync(path, `#!${python}\nimport json\nimport os\nimport sys\nsource = sys.stdin.read()\nsys.argv = sys.argv[1:]\nif sys.argv[0] == '-I':\n    sys.argv = sys.argv[1:]\n${patch}\nexec(compile(source, '<actual wizard helper>', 'exec'), {'__name__': '__main__'})\n`);
  chmodSync(path, 0o755);
  return { PATH: bin + ":" + process.env.PATH };
}

test("Python receives values through its input descriptor, without values in its argv", (t) => {
  const f = fixture(t);
  const log = join(f.base, "python-arguments.jsonl");
  const env = pythonHarness(f, `with open(${JSON.stringify(log)}, 'a') as log:\n    log.write(json.dumps(sys.argv) + '\\n')`);
  const value = "synthetic-fd3-value ' apostrophe \\ slash $dollar";
  const result = f.run(`write_env TOKEN ${quote(value)}\n[[ "$(_existing TOKEN)" == ${quote(value)} ]]`, { env });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(calls.map((args) => args[3]), ["check", "write", "read"]);
  assert.ok(calls.every((args) => !args.some((arg) => arg.includes(value))));
  assert.ok(!result.stdout.includes(value));
});

test("a failed atomic replace leaves the old file intact, cleans staging, and records no success", (t) => {
  const f = fixture(t);
  f.put(".env", "TOKEN='synthetic-existing-sentinel'\n");
  chmodSync(join(f.root, ".env"), 0o640);
  const before = snapshot(f.root);
  const env = pythonHarness(f, `if sys.argv[3] == 'write':\n    def fail_replace(*args, **kwargs):\n        raise OSError('synthetic injected replace failure')\n    os.replace = fail_replace`);
  const result = f.run(guardedWrite, { env });
  assertRejectedWrite(result);
  assert.deepEqual(snapshot(f.root), before);
  noStagingFiles(f.root);
});

test("a permission failure retaining ownership leaves the old file intact and records no success", (t) => {
  const f = fixture(t);
  f.put(".env", "TOKEN='synthetic-ownership-sentinel'\n");
  chmodSync(join(f.root, ".env"), 0o640);
  const before = snapshot(f.root);
  const env = pythonHarness(f, `if sys.argv[3] == 'write':\n    def deny_ownership(*args, **kwargs):\n        raise PermissionError('synthetic denied ownership preservation')\n    os.fchown = deny_ownership`);
  const result = f.run(guardedWrite, { env });
  assertRejectedWrite(result);
  assert.deepEqual(snapshot(f.root), before);
  noStagingFiles(f.root);
});

test("a leaf swapped to an outside symlink during preparation is refused without following it", (t) => {
  const f = fixture(t);
  const old = "TOKEN='synthetic-original-sentinel'\n";
  const outside = join(f.base, "outside.env");
  f.put(".env", old);
  linkSync(join(f.root, ".env"), join(f.base, "original-hardlink.env"));
  writeFileSync(outside, "TOKEN='synthetic-outside-sentinel'\n");
  const env = pythonHarness(f, `if sys.argv[3] == 'write':\n    real_fsync = os.fsync\n    def swap_after_fsync(fd):\n        real_fsync(fd)\n        os.unlink('.env', dir_fd=9)\n        os.symlink(${JSON.stringify(outside)}, '.env', dir_fd=9)\n    os.fsync = swap_after_fsync`);
  const result = f.run(guardedWrite, { env });
  assertRejectedWrite(result);
  assert.ok(lstatSync(join(f.root, ".env")).isSymbolicLink());
  assert.equal(readlinkSync(join(f.root, ".env")), outside);
  assert.equal(readFileSync(outside, "utf8"), "TOKEN='synthetic-outside-sentinel'\n");
  assert.equal(readFileSync(join(f.base, "original-hardlink.env"), "utf8"), old);
  noStagingFiles(f.root);
});
