import { describe, expect, it } from "vitest";
import { readTar, TarError } from "./tar.js";
import { chunked, tarArchive } from "./testing/tar-writer.js";

async function filesOf(
  archive: Uint8Array,
  wants: (path: string, size: number) => boolean = () => true,
  chunkSize = 700,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for await (const file of readTar(chunked(archive, chunkSize), wants)) {
    files[file.path] = new TextDecoder().decode(file.bytes);
  }
  return files;
}

describe("readTar", () => {
  it("reads regular files and ignores directories, links and global headers", async () => {
    const archive = tarArchive([
      {
        type: "g",
        path: "pax_global_header",
        data: "52 comment=0123456789abcdef0123456789abcdef01234567\n",
      },
      { type: "5", path: "repo-abc/" },
      { path: "repo-abc/README.md", data: "# Readme\n" },
      { type: "2", path: "repo-abc/link.md", linkName: "README.md" },
      { path: "repo-abc/skills/ads/SKILL.md", data: "---\nname: ads\n---\n" },
      { path: "repo-abc/empty.md", data: "" },
    ]);
    expect(await filesOf(archive)).toEqual({
      "repo-abc/README.md": "# Readme\n",
      "repo-abc/skills/ads/SKILL.md": "---\nname: ads\n---\n",
      "repo-abc/empty.md": "",
    });
  });

  it("gives the same result however the stream is chunked", async () => {
    const archive = tarArchive([
      { path: "a.md", data: "a".repeat(1000) },
      { path: "b.md", data: "b".repeat(513) },
    ]);
    const expected = await filesOf(archive, undefined, archive.byteLength);
    for (const chunkSize of [1, 7, 511, 512, 513, 4096]) {
      expect(await filesOf(archive, undefined, chunkSize)).toEqual(expected);
    }
  });

  it("only buffers what the caller wants", async () => {
    const archive = tarArchive([
      { path: "big.bin", data: "x".repeat(100_000) },
      { path: "small.md", data: "wanted" },
    ]);
    const asked: [string, number][] = [];
    const files = await filesOf(archive, (path, size) => {
      asked.push([path, size]);
      return path.endsWith(".md");
    });
    expect(files).toEqual({ "small.md": "wanted" });
    expect(asked).toEqual([
      ["big.bin", 100_000],
      ["small.md", 6],
    ]);
  });

  it("joins the ustar prefix and honors pax and GNU long paths", async () => {
    const long = `${"deep/".repeat(40)}file.md`;
    const archive = tarArchive([
      { path: "name.md", prefix: "some/prefix", data: "prefixed" },
      { type: "x", path: "PaxHeader", data: paxRecord("path", long) },
      { path: "truncated-name", data: "pax" },
      { type: "L", path: "././@LongLink", data: `gnu/${long}\0` },
      { path: "truncated-name", data: "gnu" },
      { path: "after.md", data: "plain again" },
    ]);
    expect(await filesOf(archive)).toEqual({
      "some/prefix/name.md": "prefixed",
      [long]: "pax",
      [`gnu/${long}`]: "gnu",
      "after.md": "plain again",
    });
  });

  it("decodes non-ASCII paths", async () => {
    const archive = tarArchive([
      { type: "x", path: "PaxHeader", data: paxRecord("path", "문서/가이드.md") },
      { path: "fallback", data: "한글" },
    ]);
    expect(await filesOf(archive)).toEqual({ "문서/가이드.md": "한글" });
  });
});

describe("readTar with hostile input", () => {
  it("ends quietly when the stream is cut off", async () => {
    const archive = tarArchive([
      { path: "a.md", data: "complete" },
      { path: "b.md", data: "b".repeat(2000) },
    ]);
    expect(await filesOf(archive.subarray(0, 1024 + 700))).toEqual({ "a.md": "complete" });
    expect(await filesOf(archive.subarray(0, 100))).toEqual({});
    expect(await filesOf(new Uint8Array())).toEqual({});
  });

  it("rejects a header whose checksum does not match", async () => {
    const archive = tarArchive([{ path: "a.md", data: "data" }]);
    archive[0] = (archive[0] ?? 0) ^ 0xff;
    await expect(filesOf(archive)).rejects.toBeInstanceOf(TarError);
  });

  it("rejects sizes it cannot represent and oversized extended headers", async () => {
    const binarySize = tarArchive([
      { path: "huge.bin", data: "", rawSize: [0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] },
    ]);
    await expect(filesOf(binarySize)).rejects.toThrow("too large");

    const hugeHeader = tarArchive([{ type: "x", path: "PaxHeader", data: "x".repeat(70_000) }]);
    await expect(filesOf(hugeHeader)).rejects.toThrow("extended header is too large");

    const badRecord = tarArchive([{ type: "x", path: "PaxHeader", data: "999 path=nope\n" }]);
    await expect(filesOf(badRecord)).rejects.toThrow("malformed extended header");
  });

  it("hands traversal paths to the caller untouched, to be judged there", async () => {
    const archive = tarArchive([{ path: "../../etc/passwd", data: "root" }]);
    const asked: string[] = [];
    await filesOf(archive, (path) => {
      asked.push(path);
      return false;
    });
    expect(asked).toEqual(["../../etc/passwd"]);
  });
});

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  const bodyLength = new TextEncoder().encode(body).byteLength;
  let length = bodyLength + 1;
  while (String(length).length + bodyLength !== length) {
    length = String(length).length + bodyLength;
  }
  return `${length}${body}`;
}
