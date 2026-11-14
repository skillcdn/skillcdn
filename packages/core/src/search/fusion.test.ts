import { describe, expect, it } from "vitest";
import { fuseRanks, RRF_K } from "./fusion.js";
import { SKILL_RANK_BOOST } from "./vector.js";

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

  it("lets a skill pass the documents up to three places ahead of it, and no more", () => {
    const boost = (key: string) => (key === "skill" ? SKILL_RANK_BOOST : 1);
    // One list, as the words answering alone, and two that agree, as words and meaning.
    const behind = (places: number) => [
      ...Array.from({ length: places }, (_, at) => `doc-${at + 1}`),
      "skill",
    ];
    expect(fuseRanks([behind(3)], { boost })[0]).toBe("skill");
    expect(fuseRanks([behind(4)], { boost }).slice(0, 2)).toEqual(["doc-1", "skill"]);
    expect(fuseRanks([behind(3), behind(3)], { boost })[0]).toBe("skill");
    expect(fuseRanks([behind(4), behind(4)], { boost }).slice(0, 2)).toEqual(["doc-1", "skill"]);
    // A skill and a document with the same places between them: the skill.
    expect(
      fuseRanks(
        [
          ["doc", "skill"],
          ["skill", "doc"],
        ],
        { boost },
      ),
    ).toEqual(["skill", "doc"]);
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
