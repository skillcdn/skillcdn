import { describe, expect, it } from "vitest";
import { rasterImageType } from "./pictures.js";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe("rasterImageType", () => {
  it("names a raster image by its first bytes alone", () => {
    expect(rasterImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      "image/png",
    );
    expect(rasterImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe("image/jpeg");
    expect(rasterImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    expect(
      rasterImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56)),
    ).toBe("image/webp");
  });

  it("names nothing else: an SVG, a truncated header, an empty body, a RIFF that is not WebP", () => {
    expect(
      rasterImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")),
    ).toBe(undefined);
    expect(rasterImageType(bytes(0x89, 0x50, 0x4e))).toBe(undefined);
    expect(rasterImageType(bytes())).toBe(undefined);
    expect(rasterImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBe(
      undefined,
    );
  });
});
