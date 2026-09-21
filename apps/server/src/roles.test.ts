import { describe, expect, it } from "vitest";
import { parseRole, ROLES } from "./roles.js";

describe("parseRole", () => {
  it("accepts every known role", () => {
    for (const role of ROLES) {
      expect(parseRole(role)).toBe(role);
    }
  });

  it("rejects unknown and missing values", () => {
    expect(parseRole("API")).toBeUndefined();
    expect(parseRole("")).toBeUndefined();
    expect(parseRole(undefined)).toBeUndefined();
  });
});
