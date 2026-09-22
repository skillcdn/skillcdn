import type { Messages } from "./en.js";

// Korean pack. Language packs are the one place where committed text is not English.
// Keep technical terms that readers search for in their original form: MCP, SKILL.md, find, get.

export const ko: Messages = {
  meta: {
    siteName: "SkillCDN",
    landing: {
      title: "SkillCDN: 어떤 git 저장소든 MCP 서버로",
      description:
        "에이전트를 URL 하나에 연결하면 git 저장소의 스킬과 문서를 검색하고, 불러오고, 읽을 수 있습니다. 설치할 것도, 업로드할 것도 없습니다.",
    },
    explore: {
      title: "저장소 살펴보기 | SkillCDN",
      description:
        "저장소 주소를 붙여 넣으면 에이전트가 무엇을 받게 되는지 볼 수 있습니다. 스킬, 문서, 그리고 제외된 항목과 그 이유까지.",
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
    ogImageAlt: "SkillCDN: 어떤 git 저장소든 MCP 서버로",
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

  connect: {
    title: "에이전트 연결하기",
    endpoint: "MCP 엔드포인트",
    lead: "Streamable HTTP 전송을 지원하는 MCP 클라이언트라면 어디든 이 URL을 추가하면 됩니다.",
    claudeCode: "Claude Code",
    json: "JSON 설정",
    jsonHint:
      "대부분의 클라이언트가 이런 형태의 설정을 읽습니다. 키는 원하는 이름으로 정하면 됩니다.",
  },

  landing: {
    eyebrow: "어떤 git 저장소든 MCP 서버로",
    title: "git 저장소를 그대로 MCP 서버로 만드세요.",
    lead: "에이전트를 URL 하나에 연결하면 그 저장소의 스킬과 문서를 검색하고, 불러오고, 읽을 수 있습니다. 설치할 것도, 업로드할 것도 없습니다. 원본은 언제나 git입니다.",
    tryLabel: "공개 GitHub 저장소로 바로 확인해 보세요",
    how: {
      title: "동작 방식",
      steps: [
        {
          title: "스킬을 git에 둡니다",
          body: "스킬은 SKILL.md가 들어 있는 디렉터리입니다. 이름과 설명, 그리고 Markdown으로 쓴 지침이 전부입니다. 저장소 하나에 스킬을 하나든 여러 개든, 참조하는 문서와 함께 두면 됩니다.",
        },
        {
          title: "URL 하나를 연결합니다",
          body: "주소가 곧 저장소입니다. /gh/owner/repo 뒤에 브랜치, 태그 또는 커밋과 하위 경로를 붙일 수 있습니다. Streamable HTTP를 지원하는 MCP 클라이언트에 추가하세요.",
        },
        {
          title: "에이전트가 필요한 것만 가져갑니다",
          body: "스킬이 몇 개든 도구는 세 개입니다. find는 이름, 설명, 문서를 검색하고, get은 스킬 하나를 불러오고, read_file은 스킬이 가리키는 파일을 읽습니다.",
        },
      ],
    },
    addresses: {
      title: "주소 체계는 하나입니다",
      lead: "주소는 저장소를 가리키고, 필요하면 ref와 디렉터리까지 가리킵니다. 설정은 이것이 전부입니다.",
      rows: [
        { address: "/gh/owner/repo", meaning: "기본 브랜치의 최신 커밋." },
        { address: "/gh/owner/repo@v1.2.0", meaning: "태그 또는 브랜치." },
        {
          address: "/gh/owner/repo@<40자리 커밋>",
          meaning: "고정: 언제나 검토를 마친 바로 그 내용만 제공합니다.",
        },
        { address: "/gh/owner/repo@main/skills/ads", meaning: "디렉터리 하나만." },
        {
          address: "/gh/owner/repo@release/1.2:skills",
          meaning: "슬래시가 들어간 ref는 콜론으로 끝냅니다.",
        },
      ],
      addressHeader: "주소",
      meaningHeader: "제공되는 내용",
    },
    principles: {
      title: "믿고 쓸 수 있는 원칙",
      items: [
        {
          title: "원본은 git입니다",
          body: "SkillCDN은 색인하고 제공할 뿐, 콘텐츠를 호스팅하지 않습니다. 커밋을 고정하면 에이전트는 검토를 마친 바로 그 내용만 받습니다.",
        },
        {
          title: "저장소는 선언할 뿐, 실행하지 않습니다",
          body: "스킬은 텍스트입니다. 저장소에서 온 어떤 것도 서버에서 실행되지 않고, 사용자의 컴퓨터에서 실행되도록 전달되지도 않습니다.",
        },
        {
          title: "작고 고정된 도구 세트",
          body: "에이전트에는 스킬마다 도구가 하나씩 보이는 것이 아니라 세 개만 보입니다. 스킬이 수백 개인 저장소도 세 개인 저장소와 같은 컨텍스트만 차지합니다.",
        },
        {
          title: "직접 호스팅할 수 있습니다",
          body: "서비스 전체가 컨테이너 이미지 하나와 PostgreSQL입니다. 소스가 공개되어 있고, 같은 이미지를 자체 인프라에서 그대로 실행할 수 있습니다.",
        },
      ],
    },
    authors: {
      title: "스킬 저장소 만들기",
      body: "Agent Skills 구조를 따르면 됩니다. SKILL.md가 있는 디렉터리는 모두 스킬이고, 그 옆의 파일은 그 스킬에 속합니다. 살펴보기 화면에서 내 저장소가 어떻게 읽히는지 확인할 수 있습니다. 어떤 스킬이 인식되었고, 어떤 것이 왜 제외되었는지까지.",
      convention: "규칙 읽어 보기",
      check: "내 저장소 확인하기",
    },
    faq: {
      title: "자주 묻는 질문",
      items: [
        {
          question: "SkillCDN은 무엇인가요?",
          answer:
            "SkillCDN은 git 저장소를 MCP 서버로 바꿔 주는 서비스입니다. 에이전트는 서비스의 /gh/owner/repo 같은 URL에 연결해서 find, get, read_file 세 가지 도구로 그 저장소의 스킬과 문서를 검색하고 읽습니다.",
        },
        {
          question: "스킬이란 무엇인가요?",
          answer:
            "스킬은 SKILL.md 파일이 있는 디렉터리입니다. 이름과 설명을 담은 YAML 프런트매터 뒤에 Markdown으로 쓴 지침이 이어지고, 보조 파일은 같은 디렉터리에 둡니다. Agent Skills 형식 그대로입니다.",
        },
        {
          question: "어떤 에이전트에서 쓸 수 있나요?",
          answer:
            "Streamable HTTP 전송을 지원하는 MCP 클라이언트라면 모두 쓸 수 있습니다. 예를 들어 Claude Code에서는 claude mcp add --transport http <이름> <url> 명령으로 연결합니다.",
        },
        {
          question: "무언가를 업로드하거나 등록해야 하나요?",
          answer:
            "아니요. 에이전트가 처음 요청할 때 SkillCDN이 git 호스트에서 저장소를 읽어 그 커밋을 한 번 색인하고, 이후에는 색인에서 응답합니다.",
        },
        {
          question: "변경 사항은 에이전트에 어떻게 반영되나요?",
          answer:
            "커밋을 지정하지 않은 주소는 브랜치나 태그를 따라가며, 새 커밋이 푸시되면 곧 반영됩니다. 전체 커밋 해시를 지정한 주소는 절대 바뀌지 않습니다.",
        },
        {
          question: "SkillCDN이 저장소의 코드를 실행하나요?",
          answer:
            "아니요. 저장소 콘텐츠는 데이터로 파싱되어 텍스트로만 반환됩니다. 저장소에서 온 어떤 것도 실행되지 않습니다.",
        },
        {
          question: "비공개 저장소도 쓸 수 있나요?",
          answer:
            "아직은 아닙니다. 지금은 공개 GitHub 저장소를 지원하며, GitHub App을 통한 비공개 저장소 지원은 로드맵에 있습니다.",
        },
        {
          question: "직접 호스팅할 수 있나요?",
          answer:
            "네. 서비스는 컨테이너 이미지 하나와 PostgreSQL로 구성됩니다. 소스는 Functional Source License(FSL-1.1-ALv2)로 공개되어 있으며, 각 릴리스는 2년 뒤 Apache 2.0으로 전환됩니다.",
        },
      ],
    },
  },

  explore: {
    title: "저장소 살펴보기",
    lead: "주소를 붙여 넣으면 에이전트가 무엇을 받게 되는지 볼 수 있습니다. 스킬, 문서, 그리고 제외된 항목과 그 이유까지.",
    featured: "추천 저장소",
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
    directory: "디렉터리",
    license: "라이선스",
    compatibility: "호환성",
    allowedTools: "허용된 도구",
    metadata: "메타데이터",
    files: "이 스킬의 파일",
    filesTruncated: "앞쪽 파일만 표시됩니다.",
    noFiles: "이 스킬에는 보조 파일이 없습니다.",
    warnings: "작성자를 위한 경고",
    root: "(저장소 루트)",
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
    tagline: "어떤 git 저장소든 MCP로 에이전트에 제공합니다.",
    source: "GitHub의 소스",
    license: "라이선스",
    trademarks: "상표",
    security: "보안",
    sourceAvailable: "FSL-1.1-ALv2로 소스가 공개되어 있습니다.",
  },
};
