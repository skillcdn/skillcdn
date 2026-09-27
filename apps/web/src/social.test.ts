import type { RestMount, RestSkill } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { messagesFor } from "./i18n/index.js";
import { socialCard } from "./social.js";

const MOUNT: RestMount = {
  address: "/gh/acme/skills",
  repository: {
    host: "gh",
    owner: "Acme",
    name: "skills",
    defaultBranch: "main",
    description: "Skills for the whole team.",
    avatar: "https://avatars.example/acme.png",
  },
  ref: null,
  pinned: false,
  commit: "a".repeat(40),
  path: "",
  verified: true,
  image: null,
  index: {
    status: "ready",
    truncated: false,
    manifest: {
      path: "SKILLCDN.md",
      name: "Acme skills",
      description: "The skills Acme's teams share.",
      language: "en",
      translations: { ko: { name: "Acme 스킬", description: "Acme 팀이 함께 쓰는 스킬." } },
    },
    skillCount: 6,
    documentCount: 1,
    skills: [],
    documents: [],
    diagnostics: [],
  },
};

const SKILL: RestSkill = {
  status: "ready",
  skill: {
    name: "review",
    directory: "review",
    description: "Reviews a change.",
    license: null,
    compatibility: null,
    allowedTools: null,
    metadata: {},
    body: "# Review",
    files: ["review/SKILL.md"],
    filesTruncated: false,
    included: [],
    warnings: [],
    rules: null,
    translations: { ko: { title: "리뷰", description: "변경을 검토합니다." } },
  },
};

describe("socialCard", () => {
  it("says what the repository is, in the language of the page, with its facts", () => {
    const en = socialCard("en", "https://skills.example", { mount: MOUNT });
    expect(en).toEqual({
      kicker: messagesFor("en").mount.repository,
      title: "Acme skills",
      subtitle: "Acme/skills · skills.example/gh/acme/skills",
      description: "The skills Acme's teams share.",
      badges: ["6 skills", "Verified"],
      verified: true,
      avatar: "https://avatars.example/acme.png",
      siteName: "SkillCDN",
    });
    const ko = socialCard("ko", "https://skills.example", { mount: MOUNT });
    expect(ko.title).toBe("Acme 스킬");
    expect(ko.description).toBe("Acme 팀이 함께 쓰는 스킬.");
    expect(ko.badges).toEqual(["스킬 6개", "인증됨"]);
  });

  it("falls back to the host's words while the index is not there, without facts", () => {
    const card = socialCard("en", "https://skills.example", {
      mount: { ...MOUNT, verified: false, index: { status: "indexing" } },
    });
    expect(card.title).toBe("Acme/skills");
    expect(card.subtitle).toBe("skills.example/gh/acme/skills");
    expect(card.description).toBe("Skills for the whole team.");
    expect(card.badges).toEqual([]);
  });

  it("writes a skill's card with the skill's words and the repository's name", () => {
    const card = socialCard("ko", "https://skills.example", { mount: MOUNT, skill: SKILL });
    expect(card.kicker).toBe(messagesFor("ko").mount.kinds.skill);
    expect(card.title).toBe("리뷰");
    expect(card.subtitle).toBe("Acme 스킬 · skills.example/gh/acme/skills");
    expect(card.description).toBe("변경을 검토합니다.");
    expect(card.badges).toEqual(["인증됨"]);
  });
});
