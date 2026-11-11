import { describe, expect, it } from "vitest";
import { dataOfMarkdown, MAX_TABLE_COLUMNS, toCsv } from "./markdown-data.js";

const lines = (...text: string[]): string => text.join("\n");

describe("dataOfMarkdown: tables", () => {
  it("reads a table as its columns and its rows, as written", () => {
    const text = lines(
      "# Codes",
      "",
      "| Code | Meaning | Note |",
      "|---|:---:|---:|",
      "| A1 | Lamp dim | **bold** and `code` |",
      "| A2 | Lamp out | |",
      "",
      "After the table.",
    );
    const { tables } = dataOfMarkdown(text);
    expect(tables).toEqual([
      {
        offset: text.indexOf("| Code"),
        columns: ["Code", "Meaning", "Note"],
        rows: [
          ["A1", "Lamp dim", "**bold** and `code`"],
          ["A2", "Lamp out", ""],
        ],
      },
    ]);
  });

  it("takes rows without the pipes at their ends, fills a short row and cuts a long one", () => {
    const { tables } = dataOfMarkdown(
      lines("Code | Meaning", "--- | ---", "A1 | Lamp dim", "A2", "A3 | Lamp out | extra | more"),
    );
    // A line without a pipe ends the table: `A2` is no row, and what follows it no table.
    expect(tables).toEqual([
      { offset: 0, columns: ["Code", "Meaning"], rows: [["A1", "Lamp dim"]] },
    ]);
    const filled = dataOfMarkdown(lines("| a | b | c |", "|-|-|-|", "| 1 |", "| 1 | 2 | 3 | 4 |"));
    expect(filled.tables[0]?.rows).toEqual([
      ["1", "", ""],
      ["1", "2", "3"],
    ]);
  });

  it("reads an escaped pipe as the pipe it stands for", () => {
    const { tables } = dataOfMarkdown(
      lines(
        "| Pattern | Means |",
        "|---|---|",
        "| a \\| b | either |",
        "| end \\| | pipe at the end |",
      ),
    );
    expect(tables[0]?.rows).toEqual([
      ["a | b", "either"],
      ["end |", "pipe at the end"],
    ]);
  });

  it("ends a table at a blank line, a heading, a quote, a list item or a rule", () => {
    for (const next of ["", "## Next", "> quoted | text", "- item | text", "---"]) {
      const { tables } = dataOfMarkdown(lines("| a |", "|---|", "| 1 |", next, "| 2 |"));
      expect(tables, JSON.stringify(next)).toHaveLength(1);
      expect(tables[0]?.rows, JSON.stringify(next)).toEqual([["1"]]);
    }
  });

  it("finds two tables one after another, and several in a document", () => {
    const text = lines("| a |", "|---|", "| 1 |", "", "| b | c |", "|---|---|", "| 2 | 3 |");
    expect(dataOfMarkdown(text).tables.map((table) => table.columns)).toEqual([["a"], ["b", "c"]]);
  });

  it("is not misled by what only looks like a table", () => {
    // No delimiter row, a delimiter of another width, a pipe in prose.
    expect(dataOfMarkdown(lines("| a | b |", "| 1 | 2 |")).tables).toEqual([]);
    expect(dataOfMarkdown(lines("| a | b |", "|---|", "| 1 | 2 |")).tables).toEqual([]);
    expect(dataOfMarkdown("Either this | or that.\n\nNothing else.").tables).toEqual([]);
    // Inside a fenced block, an HTML block, the front-matter, or indented as code.
    expect(dataOfMarkdown(lines("```", "| a |", "|---|", "| 1 |", "```")).tables).toEqual([]);
    expect(dataOfMarkdown(lines("<div>", "| a |", "|---|", "| 1 |", "</div>")).tables).toEqual([]);
    expect(
      dataOfMarkdown(lines("---", "title: x", "note: |", "  | a |", "---", "Body.")).tables,
    ).toEqual([]);
    expect(dataOfMarkdown(lines("    | a |", "    |---|", "    | 1 |")).tables).toEqual([]);
  });

  it("keeps the first columns of a table wider than a table may be", () => {
    const wide = `|${" x |".repeat(MAX_TABLE_COLUMNS + 10)}`;
    const rule = `|${"---|".repeat(MAX_TABLE_COLUMNS + 10)}`;
    const { tables } = dataOfMarkdown(lines(wide, rule, wide));
    expect(tables[0]?.columns).toHaveLength(MAX_TABLE_COLUMNS);
    expect(tables[0]?.rows[0]).toHaveLength(MAX_TABLE_COLUMNS);
  });

  it("reads a long document of anything in time that grows with its length", () => {
    const length = 200_000;
    expect(dataOfMarkdown("|".repeat(length)).tables).toEqual([]);
    expect(dataOfMarkdown(`${"-".repeat(length)}\n${"|-".repeat(length)}`).tables).toHaveLength(0);
    expect(
      dataOfMarkdown(`| a |\n|---|\n${"| 1 |\n".repeat(50_000)}`).tables[0]?.rows,
    ).toHaveLength(50_000);
    expect(
      dataOfMarkdown(`| a |${" ".repeat(length)}x\n|---|${" ".repeat(length)}x`).tables,
    ).toEqual([]);
    expect(dataOfMarkdown("\\|".repeat(length)).tables).toEqual([]);
  });
});

describe("dataOfMarkdown: code blocks", () => {
  it("reads a fenced block with what it says it is written in, without the fences", () => {
    const text = lines(
      "# Definitions",
      "",
      '```tln title="guard"',
      "ResumeGuardTimes ::= RECORD {",
      "    g21  Milliseconds",
      "}",
      "```",
      "",
      "~~~",
      "plain",
      "~~~",
    );
    expect(dataOfMarkdown(text).code).toEqual([
      {
        offset: text.indexOf("```tln"),
        language: "tln",
        text: "ResumeGuardTimes ::= RECORD {\n    g21  Milliseconds\n}",
      },
      { offset: text.indexOf("~~~"), language: "", text: "plain" },
    ]);
  });

  it("takes the indentation of the opening fence off every line, and no more", () => {
    const { code } = dataOfMarkdown(lines("  ```", "  two", "      six", " one", "  ```"));
    expect(code[0]?.text).toBe("two\n    six\none");
  });

  it("keeps a table inside a block as the text it is, and runs an open fence to the end", () => {
    const { code, tables } = dataOfMarkdown(lines("```", "| a |", "|---|", "", "still code"));
    expect(tables).toEqual([]);
    expect(code).toEqual([{ offset: 0, language: "", text: "| a |\n|---|\n\nstill code" }]);
  });

  it("answers nothing for a document with neither", () => {
    expect(dataOfMarkdown("")).toEqual({ tables: [], code: [] });
    expect(dataOfMarkdown("# Title\n\nProse only.\n")).toEqual({ tables: [], code: [] });
  });
});

describe("toCsv", () => {
  it("quotes a field that holds a comma, a quote or a line break, and ends every line", () => {
    expect(
      toCsv([
        ["Code", "Meaning"],
        ["A1", 'said "dim", then out'],
        ["A2", "two\nlines"],
        ["", ""],
      ]),
    ).toBe('Code,Meaning\r\nA1,"said ""dim"", then out"\r\nA2,"two\nlines"\r\n,\r\n');
    expect(toCsv([])).toBe("");
  });
});
