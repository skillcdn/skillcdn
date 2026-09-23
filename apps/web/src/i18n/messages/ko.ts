import { connectKo } from "./connect-ko.js";
import type { Messages } from "./en.js";
import { landingKo } from "./landing-ko.js";

// Korean pack. Language packs are the one place where committed text is not English.
// Keep technical terms that readers search for in their original form: MCP, SKILL.md, find, get.

export const ko: Messages = {
  meta: {
    siteName: "SkillCDN",
    landing: {
      title: "SkillCDN: 쓰던 AI에 더하는 스킬",
      description:
        "ChatGPT, Claude 등 MCP로 연결되는 AI 앱에 스킬을 더하세요. 프롬프트를 몰라도, 내 말로 이야기하면 전문가의 손길이 닿은 결과물이 완성됩니다.",
      about:
        "SkillCDN은 GitHub 저장소를 MCP 서버로 만들어, ChatGPT나 Claude 같은 AI 앱이 그 안의 스킬을 불러와 대화 속에서 따르게 합니다.",
    },
    explore: {
      title: "만들고 싶은 것 찾기 | SkillCDN",
      description:
        "AI와의 대화를 완성된 결과물로 바꾸는 스킬을 만나보세요. 늘 쓰던 AI로, 좋아하는 영상과 사진 한 장으로 만드는 짧은 광고 영상부터 만들어 볼까요?",
    },
    mount: {
      title: (repository: string) => `${repository} | SkillCDN`,
      description: (repository: string) =>
        `${repository} 저장소가 SkillCDN을 통해 에이전트에 제공하는 스킬과 문서입니다.`,
      summary: (repository: string, skills: number, documents: number, names: readonly string[]) =>
        names.length === 0
          ? `${repository} 저장소가 SkillCDN을 통해 MCP로 AI 에이전트에 제공하는 스킬 ${skills}개와 문서 ${documents}개입니다.`
          : `${repository} 저장소가 SkillCDN을 통해 MCP로 AI 에이전트에 제공하는 스킬 ${skills}개와 문서 ${documents}개: ${names.join(", ")}.`,
      skillTitle: (skill: string, repository: string) => `${skill} · ${repository} | SkillCDN`,
      skillDescription: (skill: string, repository: string, description: string) =>
        `${repository} 저장소의 AI 에이전트용 스킬 ${skill}: ${description}`,
      fileTitle: (path: string, repository: string) => `${path} · ${repository} | SkillCDN`,
    },
    notFound: {
      title: "페이지를 찾을 수 없습니다 | SkillCDN",
      description: "이 주소에는 아무것도 없습니다.",
    },
    ogImageAlt: "SkillCDN: 늘 쓰던 AI로, 한 차원 다른 결과물을",
  },

  nav: {
    home: "SkillCDN 홈",
    explore: "살펴보기",
    docs: "문서",
    github: "GitHub",
    skipToContent: "본문으로 건너뛰기",
    main: "주 메뉴",
  },

  language: {
    label: "언어",
  },

  common: {
    copy: "복사",
    copied: "복사됨",
    loading: "불러오는 중…",
    retry: "다시 시도",
    back: "뒤로",
  },

  address: {
    label: "저장소 주소",
    prefixHint: "GitHub",
    placeholder: "owner/repo",
    submit: "살펴보기",
    hint: "선택 사항: @브랜치, @태그 또는 @커밋, 그 뒤에 /하위/경로.",
    examples: "예시",
    invalid: "올바른 주소가 아닙니다.",
    errors: {
      missing_repo: "owner/repo 형식으로 입력하세요.",
      invalid_owner: "GitHub에서 쓸 수 없는 소유자 이름입니다.",
      invalid_repo: "GitHub에서 쓸 수 없는 저장소 이름입니다. 끝의 .git은 빼 주세요.",
      empty_ref: "@ 뒤에 브랜치, 태그 또는 커밋이 빠졌습니다.",
      invalid_ref: "올바른 브랜치, 태그 또는 커밋 이름이 아닙니다.",
      invalid_path: "경로에는 . 또는 .. 세그먼트, 역슬래시, 빈 세그먼트를 쓸 수 없습니다.",
      dot_segment: "경로에는 . 또는 .. 세그먼트를 쓸 수 없습니다.",
      empty_segment: "주소에 빈 세그먼트가 있습니다. 중복되거나 끝에 붙은 슬래시를 지워 주세요.",
      unknown_host: "지금은 GitHub 저장소(gh)만 지원합니다.",
      too_long: "주소가 너무 깁니다.",
      bad_encoding: "주소에 잘못되었거나 허용되지 않는 퍼센트 이스케이프가 있습니다.",
      forbidden_character: "주소에 제어 문자 또는 보이지 않는 문자가 있습니다.",
      not_absolute: "owner/repo 형식으로 입력하세요.",
    },
  },

  connect: connectKo,

  landing: landingKo,

  explore: {
    title: "다음엔 무엇을 만들어 볼까요?",
    lead: "작은 영감 하나, 유용한 스킬 하나. 다음 아이디어가 여기서 시작돼요.",
    featured: "더 둘러보기",
    featuredSkills: (count: number) => `스킬 ${count}개`,
    featuredIndexing: "색인 중…",
    featuredFailed: "색인하지 못했습니다",
  },

  mount: {
    repository: "저장소",
    defaultBranch: "기본 브랜치",
    pinned: "고정됨",
    commit: "커밋",
    path: "경로",
    unverified: "미확인",
    unverifiedHint:
      "이 콘텐츠는 저장소에서 그대로 가져온 것이며, 저장소 소유자가 SkillCDN에서 확인 절차를 거치지 않았습니다. 신뢰하기 전에 직접 검토하세요.",
    viewOnHost: "GitHub에서 보기",
    indexing: {
      title: "이 커밋을 색인하는 중…",
      body: "보통 몇 초면 끝납니다. 페이지는 자동으로 갱신됩니다.",
      slow: "아직 색인 중입니다. 큰 저장소는 더 오래 걸립니다. 나중에 이 페이지로 돌아오셔도 됩니다.",
    },
    failed: {
      title: "이 커밋을 색인하지 못했습니다",
      body: (code: string) => `사유: ${code}. 자동으로 다시 시도하니 잠시 후 다시 확인해 주세요.`,
    },
    truncated: "저장소가 색인 한도보다 커서 일부 파일이 색인에서 빠졌습니다.",
    tabs: {
      skills: (count: number) => `스킬 (${count})`,
      documents: (count: number) => `문서 (${count})`,
      diagnostics: (count: number) => `제외됨 (${count})`,
    },
    listLimited: (shown: number, total: number) =>
      `전체 ${total}개 중 처음 ${shown}개만 표시합니다.`,
    noSkills: {
      title: "스킬이 없습니다",
      body: "이 마운트에는 올바른 SKILL.md가 있는 디렉터리가 없습니다. 문서는 그대로 검색하고 읽을 수 있습니다.",
    },
    noDocuments: "이 마운트에는 문서가 없습니다.",
    empty: {
      title: "제공할 내용이 없습니다",
      body: "이 마운트에는 스킬도, Markdown이나 JSON 문서도 없습니다.",
    },
    diagnostics: {
      lead: "아래 매니페스트는 제공되지 않았습니다. 수정해서 푸시하면 다음 커밋부터 다시 색인됩니다.",
    },
    warnings: (count: number) => `경고 ${count}개`,
    search: {
      label: "이 마운트에서 검색",
      placeholder: "스킬과 문서 검색…",
      submit: "검색",
      clear: "지우기",
      resultsFor: (query: string) => `“${query}”에 대해 find가 반환하는 결과`,
      none: "일치하는 항목이 없습니다. find는 검색어의 단어 중 하나라도 일치하면 결과로 돌려줍니다.",
    },
    kinds: { skill: "스킬", document: "문서" },
    partOfSkill: (directory: string) => `${directory} 스킬에 속한 파일`,
  },

  skill: {
    all: "전체 스킬과 문서",
    name: "이름",
    directory: "디렉터리",
    license: "라이선스",
    compatibility: "호환성",
    allowedTools: "허용된 도구",
    metadata: "메타데이터",
    files: "이 스킬의 파일",
    filesTruncated: "앞쪽 파일만 표시됩니다.",
    noFiles: "이 스킬에는 보조 파일이 없습니다.",
    included: "스킬과 함께 전달됨",
    warnings: "작성자를 위한 경고",
    root: "(저장소 루트)",
    rules: "이 저장소의 모든 스킬에 적용되는 규칙",
    rulesSource: (path: string) =>
      `${path}에서 가져왔습니다. 에이전트는 스킬을 불러올 때마다 이 규칙을 함께 받습니다.`,
    rulesAbove:
      "마운트된 디렉터리 위에 있는 저장소 매니페스트에서 가져왔습니다. 에이전트는 스킬을 불러올 때마다 이 규칙을 함께 받습니다.",
    rulesTruncated: "앞부분만 표시됩니다. 전체 내용은 매니페스트에 있습니다.",
  },

  file: {
    rendered: "렌더링",
    source: "원문",
    showing: (from: number, to: number, total: number) =>
      `전체 ${total.toLocaleString("ko")}자 중 ${from.toLocaleString("ko")}~${to.toLocaleString("ko")}자`,
    more: "더 불러오기",
    imageOmitted: "이미지는 불러오지 않습니다",
    directory: "디렉터리",
    bytes: (count: number) => `${count.toLocaleString("ko")}바이트`,
    directoryTruncated: "앞쪽 항목만 표시됩니다.",
  },

  errors: {
    title: "문제가 발생했습니다",
    generic: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    network: "서버에 연결하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.",
    codes: {
      "mount.repo_not_found": {
        title: "저장소를 찾을 수 없습니다",
        body: "존재하지 않거나 공개 저장소가 아닙니다. 비공개 저장소는 아직 지원하지 않습니다.",
      },
      "mount.ref_not_found": {
        title: "ref를 찾을 수 없습니다",
        body: "이 저장소에는 그런 브랜치, 태그 또는 커밋이 없습니다. ref에 슬래시가 들어 있다면 콜론으로 끝내세요. 예: @release/1.2:",
      },
      "mount.not_allowed": {
        title: "여기서는 제공하지 않습니다",
        body: "이 배포에서는 이 저장소를 제공하지 않습니다.",
      },
      "mount.rate_limited": {
        title: "git 호스트가 요청을 제한하고 있습니다",
        body: "잠시 후 다시 시도해 주세요.",
      },
      "mount.unavailable": {
        title: "git 호스트에 연결하지 못했습니다",
        body: "잠시 후 다시 시도해 주세요.",
      },
      "skill.not_found": {
        title: "스킬을 찾을 수 없습니다",
        body: "이 마운트에는 그런 이름의 스킬이 없습니다.",
      },
      "skill.ambiguous": {
        title: "같은 이름의 스킬이 여러 개입니다",
        body: "디렉터리를 골라서 열어 주세요.",
      },
      "skill.unavailable": {
        title: "지금은 스킬을 읽을 수 없습니다",
        body: "색인은 되어 있지만 내용을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
      "file.not_found": {
        title: "파일을 찾을 수 없습니다",
        body: "이 마운트의 해당 경로에는 파일이 없습니다.",
      },
      "file.too_large": {
        title: "파일이 너무 큽니다",
        body: "읽을 수 있는 크기 한도를 넘는 파일입니다.",
      },
      "file.not_text": {
        title: "텍스트 파일이 아닙니다",
        body: "여기서는 UTF-8 텍스트 파일만 읽을 수 있습니다.",
      },
    },
  },

  notFound: {
    title: "페이지를 찾을 수 없습니다",
    body: "이 주소에는 아무것도 없습니다.",
    home: "첫 페이지로 가기",
  },

  footer: {
    tagline: "쓰던 AI에 더하는 스킬.",
    source: "GitHub의 소스",
    license: "라이선스",
    trademarks: "상표",
    security: "보안",
  },
};
