import { describe, expect, it } from "vitest";
import { KEY_NAME, passwordFieldsOf, pdfEncryption } from "./originals.js";
import { parseRepoManifest } from "./repo-manifest.js";

/** The bytes of a text of one-byte characters, as a PDF's own syntax is. */
const bytes = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));
const EMPTY = new Uint8Array();

describe("pdfEncryption", () => {
  const body = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";

  it("finds the encryption dictionary a trailer names, at either end", () => {
    const trailer =
      "trailer\n<< /Size 6 /Root 1 0 R /Encrypt 5 0 R /ID [<00><00>] >>\nstartxref\n9\n%%EOF\n";
    expect(pdfEncryption(bytes(`%PDF-1.6\n${body}`), bytes(trailer))).toBe(true);
    // A linearized file says so near its start; a small file is its own two ends.
    expect(pdfEncryption(bytes(`%PDF-1.7\n${body}${trailer}`), EMPTY)).toBe(true);
    // A cross-reference stream carries the name in its dictionary, and a dictionary may be written out.
    expect(
      pdfEncryption(
        bytes("%PDF-1.5\n"),
        bytes("9 0 obj\n<< /Type /XRef /Encrypt 7 0 R /Size 10 >>\nstream"),
      ),
    ).toBe(true);
    expect(
      pdfEncryption(bytes("%PDF-1.4\n"), bytes("trailer << /Encrypt << /Filter /Standard >> >>")),
    ).toBe(true);
    expect(pdfEncryption(bytes("%PDF-1.4\n"), bytes("trailer << /Encrypt\r\n12 0 R >>"))).toBe(
      true,
    );
  });

  it("answers false for a PDF that names none, and for a name that only begins the same", () => {
    const trailer = "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n9\n%%EOF\n";
    expect(pdfEncryption(bytes(`%PDF-1.6\n${body}`), bytes(trailer))).toBe(false);
    expect(
      pdfEncryption(bytes("%PDF-1.6\n"), bytes("<< /EncryptMetadata false /Encryption /None >>")),
    ).toBe(false);
    // The name with nothing after it that could be a dictionary.
    expect(pdfEncryption(bytes("%PDF-1.6\n"), bytes("the text says /Encrypt (as a word)"))).toBe(
      false,
    );
    expect(pdfEncryption(bytes("%PDF-1.6\n"), bytes("/Encrypt"))).toBe(false);
  });

  it("answers nothing for bytes that are not a PDF, whatever they hold", () => {
    expect(pdfEncryption(EMPTY, EMPTY)).toBeUndefined();
    expect(pdfEncryption(bytes("PK\u0003\u0004 /Encrypt 5 0 R"), EMPTY)).toBeUndefined();
    expect(
      pdfEncryption(bytes(`${" ".repeat(2000)}%PDF-1.6 /Encrypt 5 0 R`), EMPTY),
    ).toBeUndefined();
  });

  it("reads a megabyte of anything in time that grows with its length", () => {
    const hostile = new Uint8Array(1_048_576).fill(0x2f);
    expect(pdfEncryption(bytes("%PDF-1.6\n"), hostile)).toBe(false);
    const nearly = bytes(`%PDF-1.6\n${"/Encryp".repeat(100_000)}`);
    expect(pdfEncryption(nearly, EMPTY)).toBe(false);
  }, 60_000);
});

describe("passwordFieldsOf", () => {
  it("names the keys written to hold a password, at the top and one mapping down", () => {
    expect(passwordFieldsOf("---\ntitle: Manual\npassword: hunter2\n---\n")).toEqual(["password"]);
    expect(
      passwordFieldsOf(
        "---\ndescription: x\nPDF-Password: a\nowner_password: b\noriginals:\n  passphrase: c\n  key-name: ops\npwd: d\n---\n",
      ),
    ).toEqual(["PDF-Password", "owner_password", "originals.passphrase", "pwd"]);
  });

  it("names nothing in a front-matter without one, or one that cannot be read", () => {
    for (const text of [
      "# No front-matter\n\npassword: in the body is the author's own text\n",
      "---\ntitle: Passwords and how to reset them\nkey-name: ops\nsecret: false\n---\n",
      "---\npassword: {unclosed\n---\n",
      "---\nnotes:\n  deeper:\n    password: two mappings down is not looked at\n---\n",
      "",
    ]) {
      expect(passwordFieldsOf(text), JSON.stringify(text)).toEqual([]);
    }
  });
});

describe("the originals of a manifest", () => {
  const manifest = (originals: string): string =>
    `---\ndescription: The manuals of the workshop.\n${originals}---\n`;
  const read = (originals: string) => {
    const parsed = parseRepoManifest(manifest(originals));
    if (!parsed.ok) throw new Error(parsed.error.message);
    return parsed.value;
  };

  it("says that the originals are kept encrypted, and by which key's name", () => {
    expect(
      read("originals:\n  encrypted: true\n  key-name: workshop-manuals-2026\n").manifest.originals,
    ).toEqual({
      encrypted: true,
      keyName: "workshop-manuals-2026",
    });
    expect(read("originals:\n  encrypted: true\n").manifest.originals).toEqual({ encrypted: true });
    expect(read("").manifest.originals).toBeUndefined();
    expect(read("originals:\n  encrypted: false\n").manifest.originals).toBeUndefined();
  });

  it("takes a name for a name, and never repeats what is no name", () => {
    for (const name of ["ops 2026 key", "p@ss:word!", "a".repeat(65), "-leading"]) {
      expect(KEY_NAME.test(name), name).toBe(false);
    }
    const sentence = read(
      'originals:\n  encrypted: true\n  key-name: "correct horse battery staple"\n',
    );
    expect(sentence.manifest.originals).toEqual({ encrypted: true });
    expect(sentence.warnings).toHaveLength(1);
    expect(sentence.warnings[0]?.message).toContain('"originals.key-name" is ignored');
    expect(JSON.stringify(sentence.warnings)).not.toContain("horse");
    // A name without originals that are encrypted names nothing.
    const alone = read("originals:\n  key-name: ops\n");
    expect(alone.manifest.originals).toBeUndefined();
    expect(alone.warnings[0]?.message).toContain(
      "it names the key of originals that are encrypted",
    );
    expect(read("originals: yes\n").warnings[0]?.message).toContain('"originals" is ignored');
    expect(read("originals:\n  encrypted: sometimes\n").warnings[0]?.message).toContain(
      '"originals.encrypted" is ignored',
    );
  });
});
