// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/package-source.mjs", import.meta.url));
let fixture: string;
let outside: string;
function write(name: string, content = "source\n") {
  mkdirSync(path.dirname(path.join(fixture, name)), { recursive: true });
  writeFileSync(path.join(fixture, name), content);
}
function run(command: string, args: string[]) {
  return spawnSync(command, args, { cwd: fixture, encoding: "utf8" });
}
function packageSource(...args: string[]) {
  return run("bun", ["scripts/package-source.mjs", ...args]);
}
beforeEach(() => {
  fixture = mkdtempSync(path.join(tmpdir(), "proxmox-package-test-"));
  outside = mkdtempSync(path.join(tmpdir(), "proxmox-package-outside-"));
  mkdirSync(path.join(fixture, "scripts"));
  copyFileSync(script, path.join(fixture, "scripts/package-source.mjs"));
  expect(run("git", ["init", "--quiet"]).status).toBe(0);
  write(".gitignore", "build/\n.env*\n!.env.local.example\nnode_modules/\n");
  write(".env.local.example", "SESSION_SECRET=\n");
  write("package.json", '{"name":"fixture"}\n');
  write("bun.lock", "fixture lock\n");
  write("app/page.tsx", "tracked content before edit\n");
  write("server/custom-server.js");
  write("deploy/install-lxc.sh");
  expect(run("git", ["add", "app/page.tsx"]).status).toBe(0);
});
afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("deployment source packaging", () => {
  it("packages current tracked and untracked source while excluding even tracked secrets and generated files", () => {
    write("app/page.tsx", "current working-tree content\n");
    write("scripts/untracked-install.sh");
    write("docs/a file $(touch leaked).md");
    const blocked = [".env", ".env.production", "nested/.env.local.example", "private.pem", "server.key", "root.crt", "certificate.p12", "id_ed25519", "deploy/certs/config.txt", "deploy/data/database", "data/backup", "node_modules/package/index.js", ".next/server.js", "build/previous.tar.gz", "test-results/session.json"];
    blocked.push("auto-update.json", "deploy/auto-update.json");
    for (const filename of blocked) write(filename, "SENSITIVE-CONTENT\n");
    expect(run("git", ["add", "--force", "--", ...blocked]).status).toBe(0);
    const result = packageSource();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const archive = path.join(fixture, "build/proxmox-cloudscape-ui-source.tar.gz");
    const list = run("tar", ["-tzf", archive]).stdout.trim().split("\n").map(name => name.replace(/^\.\//, ""));
    expect(list).toEqual(expect.arrayContaining(["app/page.tsx", "server/custom-server.js", "deploy/install-lxc.sh", ".env.local.example", "bun.lock", "scripts/package-source.mjs", "scripts/untracked-install.sh", "docs/a file $(touch leaked).md"]));
    expect(list.filter(name => blocked.includes(name) || name.startsWith(".git/"))).toEqual([]);
    expect(new Set(list).size).toBe(list.length);
    const extracted = path.join(outside, "extracted");
    mkdirSync(extracted);
    expect(run("tar", ["-xzf", archive, "-C", extracted]).status).toBe(0);
    expect(readFileSync(path.join(extracted, "app/page.tsx"), "utf8")).toBe("current working-tree content\n");
    expect(existsSync(path.join(fixture, "leaked"))).toBe(false);
    const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
    expect(readFileSync(`${archive}.sha256`, "utf8")).toBe(`${digest}  proxmox-cloudscape-ui-source.tar.gz\n`);
  });

  it("omits platform metadata and AppleDouble files without changing source metadata", () => {
    write("app/._page.tsx", "AppleDouble metadata\n");
    write("__MACOSX/metadata", "platform metadata\n");
    expect(run("git", ["add", "--force", "app/._page.tsx", "__MACOSX/metadata"]).status).toBe(0);
    if (process.platform === "darwin") {
      expect(run("xattr", ["-w", "com.example.proxmox-packaging", "retain-source-metadata", "app/page.tsx"]).status).toBe(0);
      expect(run("chmod", ["+a", "everyone allow read", "app/page.tsx"]).status).toBe(0);
    }
    expect(packageSource().status).toBe(0);
    const archive = path.join(fixture, "build/proxmox-cloudscape-ui-source.tar.gz");
    const archiveBytes = gunzipSync(readFileSync(archive));
    const extendedHeaders: string[] = [];
    for (let offset = 0; offset + 512 <= archiveBytes.length;) {
      const header = archiveBytes.subarray(offset, offset + 512);
      if (header.every(byte => byte === 0)) break;
      const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim(), 8) || 0;
      const type = header.subarray(156, 157).toString("ascii");
      if (type === "x" || type === "g") extendedHeaders.push(archiveBytes.subarray(offset + 512, offset + 512 + size).toString("utf8"));
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    expect(extendedHeaders.join("\n")).not.toMatch(/(?:LIBARCHIVE|SCHILY)\.(?:xattr|acl|fflags)/);
    const listing = run("tar", ["-tzf", archive]);
    expect(listing.stderr).toBe("");
    expect(listing.stdout).not.toMatch(/(?:\/\._|__MACOSX\/)/);
    if (process.platform === "darwin") {
      expect(run("xattr", ["-p", "com.example.proxmox-packaging", "app/page.tsx"]).stdout.trim()).toBe("retain-source-metadata");
      expect(run("ls", ["-le", "app/page.tsx"]).stdout).toContain("everyone allow read");
    }
  });

  it("rejects a symbolic link instead of including an external file", () => {
    const secret = path.join(outside, "secret.txt");
    writeFileSync(secret, "must stay outside\n");
    symlinkSync(secret, path.join(fixture, "app/linked-source.txt"));
    const result = packageSource();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("symbolic link");
    expect(existsSync(path.join(fixture, "build/proxmox-cloudscape-ui-source.tar.gz"))).toBe(false);
  });

  it("rejects an output directory symlink and arbitrary output overrides", () => {
    symlinkSync(outside, path.join(fixture, "build"));
    expect(packageSource().stderr).toContain("Unsafe output path");
    expect(packageSource("--output", path.join(outside, "archive.tar.gz")).status).not.toBe(0);
    expect(existsSync(path.join(outside, "proxmox-cloudscape-ui-source.tar.gz"))).toBe(false);
  });

  it("reports that an extracted source archive needs a Git checkout to be repackaged", () => {
    rmSync(path.join(fixture, ".git"), { recursive: true });
    const result = packageSource();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires a Git checkout");
  });
});
