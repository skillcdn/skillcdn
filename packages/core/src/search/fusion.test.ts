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

  it("counts a key a list could not have held at the place the other list gave it (ADR-0126)", () => {
    // Words first, meaning second: `new` has no vector yet, so the meaning could not place it.
    const words = ["new", "a", "b", "c"];
    const meaning = ["a", "b", "c"];
    // Left out of one list, it comes after everything both lists hold, though the words put it first.
    expect(fuseRanks([words, meaning])).toEqual(["a", "b", "c", "new"]);
    const unplaced = (key: string, list: number) => list === 1 && key === "new";
    expect(fuseRanks([words, meaning], { unplaced })).toEqual(["new", "a", "b", "c"]);
    // Its place among the words is what counts twice: fourth there, it is not first.
    expect(fuseRanks([["a", "b", "c", "new"], meaning], { unplaced })).toEqual([
      "a",
      "b",
      "c",
      "new",
    ]);
    // A list that held it keeps the place it gave, and a list that could have held it counts nothing.
    expect(
      fuseRanks(
        [
          ["x", "new"],
          ["new", "x"],
        ],
        { unplaced },
      ),
    ).toEqual(
      fuseRanks([
        ["x", "new"],
        ["new", "x"],
      ]),
    );
    expect(
      fuseRanks([words, meaning], { unplaced: (key, list) => list === 0 && key === "new" }),
    ).toEqual(["a", "b", "c", "new"]);
    // The words, asked alone, are the one list there is.
    expect(fuseRanks([words], { unplaced })).toEqual(words);
  });

  it("answers nothing for no lists and for empty ones", () => {
    expect(fuseRanks([])).toEqual([]);
    expect(fuseRanks([[], []])).toEqual([]);
  });
});
