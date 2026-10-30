---
name: SkillCDN Docs
description: "Turn any git repository into an MCP server. SkillCDN's documentation: how to write a pack agents read well, addresses, MCP tools, REST API, the skillcdn command, self-hosting, architecture and every decision. Ask here about SkillCDN itself."
documents:
  - docs
  - deploy
  - packages/cli
exclude:
  - deploy/CLAUDE.md
  - packages/cli/CHANGELOG.md
  - packages/cli/CLAUDE.md
  - packages/cli/package.json
  - packages/cli/src
  - packages/cli/tsconfig.build.json
  - packages/cli/tsconfig.json
language: en
translations:
  ko:
    name: SkillCDN 문서
    description: "어떤 git 저장소든 MCP 서버로 만드는 SkillCDN의 공식 문서 팩입니다. 에이전트가 잘 읽는 팩을 쓰는 법부터 주소, MCP 도구, REST API, skillcdn 명령, 자체 호스팅, 아키텍처, 그리고 모든 결정의 이유까지 담았습니다. SkillCDN 자체에 관한 질문은 여기에서 답을 찾으세요."
---
# Reading this pack

The pack is SkillCDN's documentation: `docs/`, where `docs/README.md` says what each file is for, the self-hosting guide `deploy/README.md`, and the reference of the `skillcdn` command, `packages/cli/README.md`. The guides say how a pack is written and used, the specifications say what SkillCDN reads and serves today, and the decision records say why. A specification is current; a decision record may since have been superseded, so quote the specification for how something behaves now.
