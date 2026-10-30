import { describe, expect, it } from "vitest";
import { parseLfsPointer } from "./lfs.js";

const OID = "4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393";

describe("parseLfsPointer", () => {
  it("reads the object and the size a pointer names", () => {
    expect(
      parseLfsPointer(
        `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize 12345\n`,
      ),
    ).toEqual({ oid: OID, size: 12345 });
    // The format before the project was renamed.
    expect(
      parseLfsPointer(`version https://hawser.github.com/spec/v1\noid sha256:${OID}\nsize 1\n`),
    ).toEqual({ oid: OID, size: 1 });
  });

  it("takes nothing else for a pointer", () => {
    expect(parseLfsPointer("# A document\n\nversion https://git-lfs.github.com/spec/v1\n")).toBe(
      undefined,
    );
    expect(
      parseLfsPointer(`version https://example.com/spec/v1\noid sha256:${OID}\nsize 1\n`),
    ).toBe(undefined);
    expect(parseLfsPointer(`version https://git-lfs.github.com/spec/v1\nsize 12345\n`)).toBe(
      undefined,
    );
    expect(
      parseLfsPointer(
        `version https://git-lfs.github.com/spec/v1\noid sha256:${OID.slice(1)}\nsize 1\n`,
      ),
    ).toBe(undefined);
    // A pointer is small by specification: a long file that starts like one is not one.
    expect(
      parseLfsPointer(
        `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize 1\n${"x".repeat(1100)}`,
      ),
    ).toBe(undefined);
  });
});
