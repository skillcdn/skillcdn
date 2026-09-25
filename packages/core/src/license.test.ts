import { describe, expect, it } from "vitest";
import {
  classifyLicenseField,
  classifyLicenseFile,
  classifyLicenseText,
  describeLicense,
  isLicenseFileName,
  MAX_LICENSE_TEXT_LENGTH,
  NO_LICENSE,
  preferredLicenseFile,
  resolveLicense,
  servesInFull,
  sourceFileUrl,
} from "./license.js";
import { parseRepoPath, type RepoPath } from "./repo-path.js";

const path = (value: string): RepoPath => {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error("invalid test path");
  return parsed.value;
};

const MIT =
  'MIT License\n\nCopyright (c) 2026 Acme\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction...';
const BSD3 =
  "Copyright (c) 2026, Acme\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n3. Neither the name of the copyright holder nor the names of its contributors may be used...";

describe("license files", () => {
  it("are recognized by name, whatever the spelling", () => {
    for (const name of [
      "LICENSE",
      "license",
      "LICENSE.md",
      "LICENSE.txt",
      "LICENSE-MIT",
      "LICENSE-2.0.txt",
      "LICENCE",
      "COPYING",
      "COPYING.LESSER",
      "UNLICENSE",
    ]) {
      expect(isLicenseFileName(name), name).toBe(true);
    }
    for (const name of ["LICENSES", "licenses.md", "README.md", "LICENSE_PLATE.jpg", "SKILL.md"]) {
      expect(isLicenseFileName(name), name).toBe(false);
    }
  });

  it("prefer the plainest name when a directory has several", () => {
    expect(
      preferredLicenseFile([
        path("COPYING"),
        path("LICENSE.md"),
        path("LICENSE"),
        path("LICENSE-APACHE"),
      ]),
    ).toBe("LICENSE");
    expect(preferredLicenseFile([path("skills/x/COPYING"), path("skills/x/LICENCE")])).toBe(
      "skills/x/LICENCE",
    );
    expect(preferredLicenseFile([path("README.md")])).toBeUndefined();
  });
});

describe("classifyLicenseText", () => {
  it.each([
    ["Apache-2.0", "Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/"],
    ["MIT", MIT],
    [
      "ISC",
      "ISC License\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.",
    ],
    [
      "0BSD",
      "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.",
    ],
    ["BSD-3-Clause", BSD3],
    [
      "BSD-2-Clause",
      "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: 1. ... 2. ...",
    ],
    ["Unlicense", "This is free and unencumbered software released into the public domain."],
    ["CC0-1.0", "CC0 1.0 Universal\n\nStatement of Purpose"],
    ["MPL-2.0", "Mozilla Public License Version 2.0\n\n1. Definitions"],
    ["GPL-3.0", "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007"],
    ["GPL-2.0", "GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991"],
    ["LGPL-3.0", "GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007"],
    ["AGPL-3.0", "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007"],
    [
      "CC-BY-4.0",
      "Attribution 4.0 International\n\nCreative Commons Corporation is not a law firm",
    ],
    ["CC-BY-SA-4.0", "Attribution-ShareAlike 4.0 International"],
    [
      "Zlib",
      "This software is provided 'as-is'... Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.",
    ],
    ["BSL-1.0", "Boost Software License - Version 1.0 - August 17th, 2003"],
    ["OFL-1.1", "This Font Software is licensed under the SIL Open Font License, Version 1.1."],
  ])("recognizes %s as one that allows copies to be passed on", (name, text) => {
    expect(classifyLicenseText(text)).toEqual({ kind: "permissive", name });
  });

  it.each([
    ["CC-BY-NC-4.0", "Attribution-NonCommercial 4.0 International"],
    ["CC-BY-ND-4.0", "Attribution-NoDerivatives 4.0 International"],
    ["PolyForm-Noncommercial-1.0.0", "PolyForm Noncommercial License 1.0.0"],
    ["BUSL-1.1", "Business Source License 1.1"],
    ["SSPL-1.0", "Server Side Public License (SSPL) VERSION 1, OCTOBER 16, 2018"],
    ["Commons-Clause", '"Commons Clause" License Condition v1.0'],
    ["All rights reserved", "Copyright (c) 2026 Acme. All rights reserved."],
  ])("recognizes %s as one that keeps copies at the source", (name, text) => {
    expect(classifyLicenseText(text)).toEqual({ kind: "restrictive", name });
  });

  it("treats what it does not recognize as restrictive, and looks at a bounded prefix", () => {
    expect(classifyLicenseText("You may look but not touch.")).toEqual({
      kind: "restrictive",
      name: undefined,
    });
    expect(classifyLicenseText("")).toEqual({ kind: "restrictive", name: undefined });
    const late = `${"x ".repeat(MAX_LICENSE_TEXT_LENGTH)}${MIT}`;
    expect(classifyLicenseText(late).kind).toBe("restrictive");
    expect(classifyLicenseText(`${MIT}\n${"y".repeat(MAX_LICENSE_TEXT_LENGTH)}`).name).toBe("MIT");
  });

  it("does not take the copyright line of a permissive license for a reservation", () => {
    expect(classifyLicenseText(BSD3).name).toBe("BSD-3-Clause");
  });

  it("names the file it read, and calls an unreadable file unrecognized", () => {
    expect(classifyLicenseFile(path("LICENSE"), MIT)).toEqual({
      kind: "permissive",
      name: "MIT",
      source: "LICENSE",
    });
    expect(classifyLicenseFile(path("skills/x/LICENSE"), undefined)).toEqual({
      kind: "restrictive",
      name: undefined,
      source: "skills/x/LICENSE",
    });
  });
});

describe("classifyLicenseField", () => {
  const at = path("skills/x/SKILL.md");
  it.each([
    ["MIT", "MIT"],
    ["mit", "MIT"],
    ["MIT License", "MIT"],
    ["The MIT License", "MIT"],
    ["Apache-2.0", "Apache-2.0"],
    ["Apache License 2.0", "Apache-2.0"],
    ["Apache 2.0", "Apache-2.0"],
    ["BSD-3-Clause", "BSD-3-Clause"],
    ["GPL-3.0-or-later", "GPL-3.0"],
    ["GPLv3", "GPL-3.0"],
    ["CC-BY-4.0", "CC-BY-4.0"],
    ["CC BY-SA 4.0", "CC-BY-SA-4.0"],
    ["CC0-1.0", "CC0-1.0"],
    ["Public domain", "CC0-1.0"],
    ["MIT OR Apache-2.0", "MIT / Apache-2.0"],
  ])("reads %s as permissive %s", (value, name) => {
    expect(classifyLicenseField(at, value)).toEqual({ kind: "permissive", name, source: at });
  });

  it.each([
    ["Proprietary", "Proprietary"],
    ["All rights reserved", "All rights reserved"],
    ["UNLICENSED", "All rights reserved"],
    ["CC-BY-NC-4.0", "CC-BY-NC-4.0"],
    ["CC BY-NC-SA 4.0", "CC-BY-NC-SA-4.0"],
    ["BUSL-1.1", "BUSL-1.1"],
    ["MIT AND Commons-Clause", "MIT / Commons-Clause"],
    ["Ask Acme first", "Ask Acme first"],
  ])("reads %s as restrictive %s", (value, name) => {
    expect(classifyLicenseField(at, value)).toEqual({ kind: "restrictive", name, source: at });
  });

  it("defers to the next source when the field only points at a file", () => {
    for (const value of [
      "",
      "  ",
      "See LICENSE",
      "see the LICENSE file",
      "LICENSE",
      "LICENSE.md",
      "license.txt",
    ]) {
      expect(classifyLicenseField(at, value), value).toBeUndefined();
    }
  });

  it("bounds what it keeps of an unrecognized text, and reads a pasted license text", () => {
    const long = "z".repeat(100);
    expect(classifyLicenseField(at, long)?.name).toHaveLength(80);
    expect(classifyLicenseField(at, `${MIT}${" more".repeat(20)}`)).toMatchObject({
      kind: "permissive",
      name: "MIT",
    });
  });
});

describe("resolveLicense", () => {
  const skillFile = classifyLicenseFile(path("skills/x/LICENSE"), "All rights reserved.");
  const rootFile = classifyLicenseFile(path("LICENSE"), MIT);
  const skillField = { path: path("skills/x/SKILL.md"), value: "CC-BY-4.0" };
  const nested = { path: path("skills/SKILLCDN.md"), value: "Proprietary" };
  const root = { path: path("SKILLCDN.md"), value: "Apache-2.0" };

  it("lets the nearest source speak: file, field, manifests, root file, root manifest", () => {
    expect(
      resolveLicense({ skillFile, skillField, manifestFields: [nested, root], rootFile }),
    ).toBe(skillFile);
    expect(resolveLicense({ skillField, manifestFields: [nested, root], rootFile })).toMatchObject({
      name: "CC-BY-4.0",
      source: "skills/x/SKILL.md",
    });
    expect(resolveLicense({ manifestFields: [nested, root], rootFile })).toMatchObject({
      kind: "restrictive",
      name: "Proprietary",
      source: "skills/SKILLCDN.md",
    });
    expect(resolveLicense({ manifestFields: [root], rootFile })).toBe(rootFile);
    expect(resolveLicense({ manifestFields: [root] })).toMatchObject({
      name: "Apache-2.0",
      source: "SKILLCDN.md",
    });
    expect(resolveLicense({ manifestFields: [] })).toBe(NO_LICENSE);
  });

  it("skips a field that only points at a file", () => {
    expect(
      resolveLicense({
        skillField: { path: path("skills/x/SKILL.md"), value: "See LICENSE" },
        manifestFields: [],
        rootFile,
      }),
    ).toBe(rootFile);
  });
});

describe("what a license means for serving", () => {
  it("describes the fact and where it came from", () => {
    expect(describeLicense(NO_LICENSE)).toBe("none declared");
    expect(describeLicense(classifyLicenseFile(path("LICENSE"), MIT))).toBe("MIT (LICENSE)");
    expect(describeLicense(classifyLicenseFile(path("LICENSE"), "?"))).toBe(
      "unrecognized (LICENSE)",
    );
    expect(describeLicense({ kind: "permissive", name: "MIT", source: undefined })).toBe("MIT");
  });

  it("serves restrictive content only where the repository is verified", () => {
    const reserved = classifyLicenseFile(path("LICENSE"), "All rights reserved.");
    expect(servesInFull(reserved, false)).toBe(false);
    expect(servesInFull(reserved, true)).toBe(true);
    expect(servesInFull(NO_LICENSE, false)).toBe(true);
    expect(servesInFull(classifyLicenseFile(path("LICENSE"), MIT), false)).toBe(true);
  });

  it("points at the file in its commit at the host", () => {
    expect(
      sourceFileUrl(
        { host: "gh", owner: "Acme", name: "skills" },
        "a".repeat(40),
        path("skills/écrire/SKILL.md"),
      ),
    ).toBe(`https://github.com/Acme/skills/blob/${"a".repeat(40)}/skills/%C3%A9crire/SKILL.md`);
  });
});
