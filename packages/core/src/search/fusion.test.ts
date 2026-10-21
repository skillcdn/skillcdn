import { describe, expect, it } from "vitest";
import { fuseRanks, RRF_K } from "./fusion.js";

describe("fuseRanks", () => {
  it("puts a key both lists hold above one that only one holds first", () => {
    expect(
      fuseRanks([
        ["a", "b", "c"],
        ["b", "d"],
      ]),
    ).toEqual(["b", "a", "d", "c"]);
  });

  it("counts a key once per list, at its first rank there", () => {
    expect(fuseRanks([["a", "a", "b"], ["b"]])).toEqual(["b", "a"]);
  });

  it("keeps the order keys were first seen in among equals, unless told how to compare", () => {
    expect(fuseRanks([["x"], ["y"]])).toEqual(["x", "y"]);
    expect(fuseRanks([["x"], ["y"]], { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) })).toEqual([
      "x",
      "y",
    ]);
    expect(fuseRanks([["y"], ["x"]], { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) })).toEqual([
      "x",
      "y",
    ]);
  });

  it("applies a boost to a key's fused score", () => {
    const boost = (key: string) => (key === "skill" ? 1.5 : 1);
    expect(fuseRanks([["doc", "skill"]], { boost })).toEqual(["skill", "doc"]);
    expect(fuseRanks([["doc", "skill"]])).toEqual(["doc", "skill"]);
  });

  it("uses the constant of the literature, and takes another", () => {
    expect(RRF_K).toBe(60);
    // With k at 0 a first place in one list weighs as much as second places in two, and the
    // order the keys were first seen in decides; with the constant, the two places win.
    expect(
      fuseRanks(
        [
          ["a", "b"],
          ["c", "b"],
        ],
        { k: 0 },
      ),
    ).toEqual(["a", "b", "c"]);
    expect(
      fuseRanks([
        ["a", "b"],
        ["c", "b"],
      ]),
    ).toEqual(["b", "a", "c"]);
  });

  it("answers nothing for no lists and for empty ones", () => {
    expect(fuseRanks([])).toEqual([]);
    expect(fuseRanks([[], []])).toEqual([]);
  });
});
