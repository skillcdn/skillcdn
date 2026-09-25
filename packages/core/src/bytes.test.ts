import { describe, expect, it } from "vitest";
import { decodeText } from "./bytes.js";

describe("decodeText", () => {
  it("decodes UTF-8 and drops a leading byte order mark", () => {
    expect(decodeText(new Uint8Array([0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f]))).toBe("héllo");
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    expect(decodeText(new Uint8Array())).toBe("");
  });

  it("refuses what is not text", () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41]))).toBeUndefined();
    expect(decodeText(new Uint8Array([0x41, 0x00, 0x42]))).toBeUndefined();
    expect(decodeText(new Uint8Array([0xc3]))).toBeUndefined();
  });
});
