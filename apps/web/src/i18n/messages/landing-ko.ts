import type { LandingMessages } from "./landing-en.js";

export const landingKo: LandingMessages = {
  eyebrow: "AI 에이전트로 운영하는 1인 회사",
  title: "혼자 시작하세요.",
  titleAccent: "팀은 이미 있습니다.",
  lead: "전문가의 방식을 스킬로 받으세요.\n늘 쓰던 AI가 마케터, 디자이너, 개발자가 됩니다. 혼자서, 회사 하나를.",
  search: {
    label: "무엇을 만들까요?",
    placeholder: "무엇을 만들까요? 카드뉴스, 쇼츠 광고, 결제 되는 웹사이트…",
    submit: "검색",
    chips: [
      "인스타 카드뉴스",
      "쇼츠 광고",
      "회의 자료 덱",
      "웹앱 만들고 배포",
      "우리 문서에 질문",
      "경쟁사 광고 조사",
    ],
  },
  clients: "늘 쓰던 AI에서 그대로",
  organizations: {
    title: "함께하는 조직",
    join: "빌더에 합류하세요",
    more: "+ 수많은 개인 빌더",
  },
  showcase: {
    eyebrow: "쇼케이스",
    title: "오늘 AI 팀이 끝낸 일",
    lead: "한 문장을 시켰고, 이렇게 돌아왔습니다. 전부 진짜 결과물입니다.",
    origins: { pack: "스킬 팩", builder: "빌더" },
    skill: "스킬 보기",
    entries: {
      cards: {
        title: "“이번 주 이슈로 인스타 카드뉴스 만들어줘”",
        body: "뉴스에서 고른 이야기가 출처 붙은 브리프가 되고, 8장 캐러셀로 돌아왔습니다. 폰 크기 검토와 게시 전 체크리스트까지.",
        tags: ["8장 캐러셀", "출처 표기"],
        action: "결과 보기",
        credit: "skillcdn/skills · 디자인",
        poster:
          "카드뉴스 캐러셀의 첫 세 장이 부채꼴로 펼쳐져 있습니다. 표지에는 “반복 업무 맡길 AI, 값이 절반으로 내렸다”라고 적혀 있습니다.",
      },
      deck: {
        title: "“이 메모로 소개 덱 만들어줘”",
        body: "한 페이지 메모가 열두 장의 덱이 되었습니다. HTML과 PDF로, 디자이너가 다듬을 수 있는 구조 그대로.",
        tags: ["12장", "HTML + PDF"],
        action: "PDF 보기",
        credit: "skillcdn/skills · 디자인",
        poster:
          "열두 장의 슬라이드가 한 장의 시트에 모여 있습니다. 어두운 바탕에 큰 제목과 도표가 있습니다.",
      },
      looks: {
        title: "“이 첫 화면, 네 가지 룩으로 보여줘”",
        body: "같은 카피, 네 가지 디자인. 브라우저에서 렌더링한 비교 시트로 돌아와 그중 하나를 추천했습니다.",
        tags: ["룩 4개", "비교 시트"],
        action: "시트 보기",
        credit: "skillcdn/skills · 디자인",
        poster:
          "한 랜딩 페이지의 첫 화면이 네 가지 룩으로 2×2 시트에 놓여 있습니다. 어두운 글래스, 종이 같은 밝은 판, 포스터, 조용한 타이포그래피.",
      },
    },
  },
  console: {
    eyebrow: "콘솔",
    title: "일은 보드에 올리고, 결정만 하세요.",
    lead: "에이전트가 일합니다. 당신은 결정합니다. 보드 하나로 회사가 돌아갑니다.",
    window: {
      name: "내 회사",
      tabs: ["보드", "로드맵", "캘린더", "문서", "결정", "피드", "스킬"],
      live: "실시간",
      columns: {
        idea: "아이디어",
        ready: "준비됨",
        in_progress: "진행 중",
        in_review: "검토 중",
        done: "완료",
      },
      categories: {
        marketing: "마케팅",
        design: "디자인",
        engineering: "개발",
        product: "프로덕트",
        operations: "운영",
      },
      priorities: { urgent: "긴급", high: "높음", normal: "보통", low: "낮음" },
      decisions: (count: number) => `결정 ${count}건`,
      worker: "AI",
      tasks: [
        {
          number: 31,
          title: "뉴스레터 첫 호 기획",
          category: "marketing",
          priority: "normal",
          state: "idea",
        },
        {
          number: 29,
          title: "결제를 테스트 모드에서 라이브로",
          category: "engineering",
          priority: "low",
          state: "idea",
        },
        {
          number: 27,
          title: "이번 주 카드뉴스 2건",
          category: "marketing",
          priority: "high",
          due: "금요일",
          state: "ready",
        },
        {
          number: 26,
          title: "랜딩 첫 화면 네 가지 룩",
          category: "design",
          priority: "normal",
          state: "ready",
        },
        {
          number: 25,
          title: "경쟁사 광고 조사: 키워드 3개",
          category: "product",
          priority: "normal",
          state: "ready",
        },
        {
          number: 24,
          title: "쇼츠 광고 15초 v2",
          category: "marketing",
          priority: "high",
          decisions: 1,
          state: "in_progress",
          working: true,
        },
        {
          number: 23,
          title: "결제 붙이기",
          category: "engineering",
          priority: "urgent",
          due: "내일",
          state: "in_progress",
          working: true,
        },
        {
          number: 22,
          title: "소개 덱 초안",
          category: "design",
          priority: "normal",
          state: "in_progress",
          working: true,
        },
        {
          number: 21,
          title: "웹사이트 v1 배포",
          category: "engineering",
          priority: "high",
          state: "in_review",
          working: true,
        },
        {
          number: 20,
          title: "매뉴얼을 문서 팩으로",
          category: "engineering",
          priority: "normal",
          state: "in_review",
          working: true,
        },
      ],
      done: 12,
      decision: {
        title: "내 답을 기다리는 결정",
        question: "#24 쇼츠 광고 15초 v2 · 두 훅 중 어느 쪽으로 갈까요?",
        options: [
          "A. 문제를 먼저 보여주고 제품으로 푼다",
          "B. 결과를 먼저 보여주고 과정을 되감는다",
        ],
        answer: "답하기",
      },
      feed: {
        title: "피드",
        /** When a line the board adds as it plays happened. */
        now: "방금",
        items: [
          { when: "방금", text: "에이전트가 #23 결제 붙이기 를 가져갔습니다." },
          {
            when: "3분 전",
            text: "#24 보고: 첫 장면과 예상 크레딧을 올렸습니다. 확인을 기다립니다.",
          },
          { when: "11분 전", text: "#21 웹사이트 v1 배포 가 검토 중으로 옮겨졌습니다." },
          { when: "1시간 전", text: "#27 이번 주 카드뉴스 2건 이 올라왔습니다." },
        ],
      },
      /** What happens on the board as it comes into view, one moment after another. */
      play: [
        {
          kind: "move",
          task: 27,
          to: "in_progress",
          feed: "에이전트가 #27 이번 주 카드뉴스 2건 을 가져갔습니다.",
        },
        {
          kind: "add",
          task: {
            number: 32,
            title: "제품 소개 영상 30초",
            category: "marketing",
            priority: "normal",
            state: "idea",
          },
          feed: "#32 제품 소개 영상 30초 가 올라왔습니다.",
        },
        {
          kind: "move",
          task: 22,
          to: "in_review",
          feed: "#22 소개 덱 초안 이 검토 중으로 옮겨졌습니다.",
        },
      ],
      caption: "카드를 끌어 다른 열에 놓아 보세요.",
      description:
        "콘솔의 보드: 아이디어, 준비됨, 진행 중, 검토 중, 완료 열에 작업 카드가 놓여 있고, 에이전트가 가져간 카드에는 담당 표시가 있습니다. 옆에는 내 답을 기다리는 결정 하나와, 누가 무엇을 했는지 쌓이는 피드가 있습니다.",
    },
    points: [
      {
        title: "올리면 가져갑니다.",
        body: "작업 하나 올리면 에이전트가 가져가고, 끝나면 검토로 돌아옵니다.",
      },
      {
        title: "물어볼 건 결정뿐.",
        body: "보고, 결정, 결과물이 한 줄씩 쌓입니다. 누가 무엇을 하는지 실시간으로 보입니다.",
      },
      {
        title: "쓰던 AI, 쓰던 구독.",
        body: "콘솔에 연결한 에이전트는 프로젝트의 스킬도 함께 받습니다. 셸이 있는 어떤 에이전트든.",
      },
    ],
    pack: {
      lead: "콘솔은 그 자체로 스킬 팩입니다. 팩을 연결하면 에이전트가 설치부터 운영까지 안내하고, 콘솔에 연결한 에이전트는 프로젝트의 스킬도 함께 받습니다.",
      open: "콘솔 팩 열기",
      guide: "설치 안내",
    },
  },
  steps: {
    eyebrow: "세 단어면 됩니다",
    title: "팩을 포크하고, 콘솔에 올리고, 에이전트에 맡기세요.",
    items: [
      {
        title: "팩",
        body: "skillcdn/skills를 포크하면 마케팅, 디자인, 개발, 프로덕트, 미디어의 스킬이 내 회사의 것이 됩니다.",
        message: (host: string) => `${host}/gh/skillcdn/skills 를 연결해줘`,
        link: "팩 열기",
      },
      {
        title: "콘솔",
        body: "작업 보드. 혼자여도 조직처럼 돌아갑니다. 콘솔 팩을 연결하면 에이전트가 설치부터 안내합니다.",
        message: (host: string) => `${host}/gh/skillcdn/console 을 연결해줘`,
        link: "콘솔 팩 열기",
      },
      {
        title: "에이전트",
        body: "쓰던 AI를 콘솔에 연결하면 팩의 스킬은 따라옵니다. ChatGPT, Claude, Cursor, Codex, Gemini CLI.",
        message: () => "앱별 연결 안내 보기",
        link: "연결 안내",
      },
    ],
    copy: "메시지 복사",
  },
  packs: {
    eyebrow: "팩",
    title: "유명한 팩도, 내 저장소도, 주소 하나로.",
    lead: "주소 하나면 내 저장소도 팩이 됩니다. 검증된 팩부터 둘러보세요.",
    all: "모든 추천 팩 둘러보기",
    skills: (count: number) => `스킬 ${count}개`,
  },
  builders: {
    eyebrow: "SkillCDN Builders",
    title: "2027년, 1인 창업자 100명.",
    lead: "AI 에이전트로 회사를 운영하는 1인 창업자 100명을 2027년에 세웁니다. AI 에이전트 기반의 1인 유니콘은 반드시 나옵니다. 그 주인공이 되세요.",
    features: [
      { title: "공용 콘솔의 내 자리", body: "프로젝트마다 보드와 팩이 하나씩." },
      { title: "스킬 팩과 셋업", body: "회사의 스킬로 시작하고, 내 스킬을 더합니다." },
      { title: "매주 리뷰", body: "진행은 기록되고, 과정은 공개됩니다." },
      { title: "선정된 빌더에게", body: "도구와 마일스톤 지원." },
    ],
    many: "수많은 개인 빌더들이 각자의 회사를 만들고 있습니다. GitHub 조직에서 함께하세요.",
    join: "빌더에 합류하세요",
    organization: "조직 보기",
  },
  faq: {
    title: "시작하기 전, 궁금한 것들.",
    items: [
      {
        question: "창업이 처음인데, 저도 할 수 있나요?",
        answer:
          "네. 회사가 하는 일은 스킬이 알고 있습니다. 만들고 싶은 것을 말하면 스킬이 무엇을 물어야 하는지, 완성까지 무엇이 필요한지 안내합니다.",
      },
      {
        question: "어떤 AI를 써야 하나요?",
        answer:
          "ChatGPT, Claude, Cursor, Codex, Gemini CLI 등 MCP로 연결되는 앱이면 됩니다. 쓰던 구독 그대로 씁니다.",
      },
      {
        question: "비용이 드나요?",
        answer:
          "공개 팩은 누구나 연결할 수 있습니다. AI 앱의 구독은 본인의 것이고, 영상 생성처럼 다른 도구를 쓰는 스킬은 만들기 전에 예상 비용을 확인받습니다.",
      },
      {
        question: "내 데이터는 어디에 있나요?",
        answer:
          "원본은 내 git 저장소입니다. SkillCDN은 색인해서 서빙할 뿐 내용을 소유하지 않고, 비공개 저장소는 로그인한 사람에게만 열립니다.",
      },
      {
        question: "회사 안이나 폐쇄망에서도 되나요?",
        answer:
          "같은 이미지를 직접 띄울 수 있습니다. 이미지 하나와 PostgreSQL이면 되고, 인터넷이 없는 곳에서도 돌아갑니다.",
      },
      {
        question: "빌더스에는 어떻게 들어가나요?",
        answer:
          "GitHub 조직 SkillCDN Builders에 합류 신청을 하면 됩니다. 아이템 한 페이지면 시작할 수 있습니다.",
      },
    ],
  },
  cta: {
    title: "오늘, 당신의 AI 조직을 시작하세요.",
    search: "만들고 싶은 것 검색",
    join: "빌더에 합류하세요",
    share: "직접 만든 팩 공유하기",
  },
  authors: {
    title: "내 저장소도 주소 하나면 팩입니다.",
    body: "공개 저장소는 바로 열립니다. 비공개 저장소는 로그인 뒤 내 계정이 볼 수 있는 것만.",
    convention: "직접 만든 팩 공유하기",
    check: "저장소 열기",
  },
};
