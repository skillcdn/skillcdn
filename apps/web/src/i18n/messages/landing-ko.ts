import type { LandingMessages } from "./landing-en.js";

export const landingKo: LandingMessages = {
  eyebrow: "AI 에이전트로 운영하는 1인 회사",
  title: "혼자 시작하세요.",
  titleAccent: "팀은 이미 있습니다.",
  lead: "전문가가 일하는 방법을 스킬로 받아 쓰세요.\n지금 쓰는 AI가 마케터, 디자이너, 개발자처럼 일합니다.\n혼자서도 회사 하나를 꾸릴 수 있습니다.",
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
  clients: "지금 쓰는 AI 앱에서 바로",
  organizations: {
    title: "함께하는 조직",
    join: "빌더에 합류하세요",
    more: "+ 함께하는 1인 빌더들",
  },
  showcase: {
    eyebrow: "쇼케이스",
    title: "AI가 실제로 만든 결과물",
    lead: "모두 한 문장 요청에서 시작해, AI가 스킬대로 끝까지 만들었습니다.",
    origins: { pack: "스킬 팩", builder: "빌더" },
    skill: "스킬 보기",
    entries: {
      ad: {
        title: "“과일 롤리팝 쇼츠 광고 15초 만들어줘”",
        body: "광고 라이브러리에서 1년 넘게 돌고 있는 사탕 광고를 찾아보고, 일부러 다른 연출로 갔습니다. 과일이 떨어진 자리에 똑같이 생긴 롤리팝이 떨어지며 시작하고, 장면마다 자막과 현장음을 넣었습니다.",
        tags: ["15초 · 9:16", "장면 5개", "영어"],
        action: "영상 보기",
        credit: "skillcdn/skills · 마케팅",
        requirement: "이 스킬은 Higgsfield 계정 연결이 필요합니다.",
        poster:
          "15초 세로 광고, 필름 룩. 창가 부엌의 나무 도마에 젖은 딸기가 떨어지고, 같은 자리에 딸기 모양 롤리팝이 떨어집니다. 아침 과일 시장에서 손이 종이봉투에서 복숭아 롤리팝을 꺼내 햇빛에 비추고, 역광 속 딸기 롤리팝, 리넨 식탁의 과일 그릇 옆에 롤리팝을 놓는 손, 창가 유리병의 롤리팝 다발과 브랜드 이름으로 끝납니다. 장면마다 자막 한 줄.",
      },
      deck: {
        title: "“이 아이디어로 투자용 사업 기획안 만들어줘”",
        body: "러닝 크루 앱 아이디어 한 장이 투자용 기획안 12장이 됐습니다. 문제에서 시작해 투자 요청으로 끝나고, PDF로도 뽑았습니다. 영상은 이 기획안으로 발표하는 장면입니다.",
        tags: ["12장", "HTML + PDF", "발표 영상 18초"],
        action: "PDF 보기",
        credit: "skillcdn/skills · 디자인",
        requirement: null,
        poster:
          "발표자가 객석 앞에서 기획안을 발표하는 18초 영상. 뒤의 스크린에 흰 바탕의 슬라이드가 넘어갑니다.",
      },
      site: {
        title: "“우리 빵집 웹페이지 하나 만들어줘”",
        body: "목요일에만 문을 여는 빵집 ‘밀도’의 예약 페이지입니다. 빵 사진을 크게 깔고, 이번 주 빵과 남은 수량, 예약 방법을 한 페이지에 넣었습니다. 사진도 AI가 만들었습니다.",
        tags: ["한 페이지", "폰 + 데스크톱", "예약 안내"],
        action: "페이지 보기",
        credit: "skillcdn/skills · 엔지니어링",
        requirement: null,
        poster:
          "빵집 웹페이지를 데스크톱 폭으로 천천히 내려 봅니다. 화면 가득한 호밀빵 사진 위의 큰 세리프 제목, 호밀빵색 띠, 크기가 다른 빵 사진 네 장, 반죽하는 손 사진과 예약 세 단계, 새벽의 가게 사진과 목요일만 표시된 요일.",
      },
    },
  },
  console: {
    eyebrow: "콘솔",
    title: "할 일은 보드에 올리고, 결정만 하세요.",
    lead: "AI 에이전트가 일하고, 당신은 결정만 합니다. 회사 일이 보드 하나에서 돌아갑니다.",
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
        question: "#24 쇼츠 광고 15초 v2 · 두 가지 도입부 중 어느 쪽으로 갈까요?",
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
          { when: "방금", text: "에이전트가 #23 ‘결제 붙이기’를 가져갔습니다." },
          {
            when: "3분 전",
            text: "#24 보고: 첫 장면과 예상 크레딧을 올렸습니다. 확인을 기다립니다.",
          },
          { when: "11분 전", text: "#21 ‘웹사이트 v1 배포’가 검토 중으로 옮겨졌습니다." },
          { when: "1시간 전", text: "#27 ‘이번 주 카드뉴스 2건’이 올라왔습니다." },
        ],
      },
      /** What happens on the board as it comes into view, one moment after another. */
      play: [
        {
          kind: "move",
          task: 27,
          to: "in_progress",
          feed: "에이전트가 #27 ‘이번 주 카드뉴스 2건’을 가져갔습니다.",
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
          feed: "#32 ‘제품 소개 영상 30초’가 올라왔습니다.",
        },
        {
          kind: "move",
          task: 22,
          to: "in_review",
          feed: "#22 ‘소개 덱 초안’이 검토 중으로 옮겨졌습니다.",
        },
      ],
      description:
        "콘솔의 보드: 아이디어, 준비됨, 진행 중, 검토 중, 완료 열에 작업 카드가 놓여 있고, 에이전트가 가져간 카드에는 담당 표시가 있습니다. 옆에는 내 답을 기다리는 결정 하나와, 누가 무엇을 했는지 쌓이는 피드가 있습니다.",
    },
    points: [
      {
        title: "할 일을 올리면 AI가 합니다",
        body: "보드에 할 일을 카드로 올리세요. 연결된 AI가 가져가서 작업하고, 끝나면 검토 칸에 올려 둡니다.",
      },
      {
        title: "나는 확인하고 고르기만",
        body: "진행 보고와 결과물은 피드에 쌓입니다. 방향을 정해야 할 때만 질문이 오고, 답하면 이어서 합니다.",
      },
      {
        title: "지금 쓰는 AI 그대로",
        body: "Claude Code나 Codex처럼 이미 쓰는 AI를 연결하면 됩니다. 이 프로젝트에 맞는 스킬도 함께 받아 갑니다.",
      },
    ],
    pack: {
      lead: "콘솔도 스킬 팩으로 받습니다. AI 앱에 이 주소를 연결하면 설치부터 쓰는 법까지 AI가 안내합니다.",
      open: "콘솔 팩 열기",
      guide: "설치 안내",
    },
  },
  steps: {
    eyebrow: "시작하는 방법",
    title: "세 단계면 AI 팀이 일을 시작합니다.",
    items: [
      {
        title: "스킬 팩 가져오기",
        body: "skillcdn/skills를 내 GitHub로 복사(포크)하세요. 마케팅, 디자인, 개발, 기획, 영상 일을 하는 방법이 담긴 스킬이 내 회사 것이 됩니다.",
        link: "팩 열기",
      },
      {
        title: "콘솔 열기",
        body: "할 일을 올리고 진행을 지켜보는 작업 보드입니다. 콘솔 팩을 AI에 연결하면 설치를 처음부터 차근차근 안내합니다.",
        link: "콘솔 팩 열기",
      },
      {
        title: "AI 연결하기",
        body: "ChatGPT, Claude, Cursor, Codex, Gemini CLI처럼 쓰던 AI 앱에 팩 주소를 연결하세요. 그 AI가 팩의 스킬대로 일합니다.",
        link: "연결 안내",
      },
    ],
  },
  packs: {
    eyebrow: "스킬 팩",
    title: "남이 만든 스킬 팩도, 내 저장소도 주소 하나로 엽니다.",
    lead: "검증된 팩부터 둘러보세요. 내 GitHub 저장소는 주소를 넣으면 바로 팩으로 열립니다.",
    all: "추천 팩 모두 보기",
    skills: (count: number) => `스킬 ${count}개`,
  },
  builders: {
    eyebrow: "SkillCDN Builders",
    title: "2027년까지 1인 창업자 100명.",
    lead: "AI 에이전트로 회사를 운영하는 1인 창업자 100명을 2027년까지 모읍니다. AI 에이전트로 일하는 1인 유니콘은 반드시 나옵니다. 그 주인공이 되세요.",
    features: [
      { title: "공용 콘솔에 내 자리", body: "프로젝트마다 작업 보드와 스킬 팩을 하나씩 받습니다." },
      {
        title: "스킬 팩과 초기 설정",
        body: "준비된 스킬로 바로 시작하고, 필요한 스킬은 직접 더합니다.",
      },
      { title: "매주 리뷰", body: "매주 진행 상황을 기록하고, 만드는 과정을 공개합니다." },
      {
        title: "선정된 빌더에게",
        body: "도구를 지원하고, 단계별 목표를 이룰 때마다 함께 돕습니다.",
      },
    ],
    many: "많은 1인 빌더가 각자의 회사를 만들고 있습니다. GitHub 조직에 들어와 함께하세요.",
    join: "빌더에 합류하세요",
  },
  faq: {
    title: "시작하기 전에 많이 묻는 질문",
    items: [
      {
        question: "어떤 AI 앱이면 되나요?",
        answer:
          "ChatGPT, Claude, Cursor, Codex, Gemini CLI처럼 MCP(AI 앱에 외부 도구를 연결하는 표준)를 지원하는 앱이면 됩니다. 지금 쓰는 구독 그대로 쓰면 됩니다.",
      },
      {
        question: "어떻게 시작하나요?",
        answer:
          "만들고 싶은 것을 검색해 스킬을 고르고, 그 스킬이 든 팩의 주소를 AI 앱에 연결하세요. 앱별 연결 방법은 팩 페이지에 있습니다.",
      },
      {
        question: "무엇부터 시작하면 될까요?",
        answer:
          "지금 당장 필요한 일 하나부터 시작하세요. 카드뉴스나 소개 자료처럼 한 문장으로 맡길 수 있는 일을 검색해 결과를 받아 보세요. 맡길 일이 여러 개가 되면 콘솔 팩을 연결해 보드에서 관리하면 됩니다.",
      },
      {
        question: "빌더는 누구인가요?",
        answer:
          "AI 에이전트로 회사를 운영하는 1인 창업자들의 모임입니다. GitHub 조직 SkillCDN Builders에 들어오면 공용 콘솔의 내 자리와 스킬 팩으로 시작하고, 매주 리뷰로 진행을 기록합니다.",
      },
    ],
  },
  cta: {
    title: "오늘, 당신의 AI 팀을 시작하세요.",
    search: "만들고 싶은 것 검색하기",
    join: "빌더에 합류하세요",
    share: "내가 만든 팩 공유하기",
  },
  authors: {
    title: "내 저장소도 주소 하나면 팩입니다.",
    body: "공개 저장소는 바로 열립니다. 비공개 저장소는 로그인 뒤 내 계정이 볼 수 있는 것만.",
    convention: "직접 만든 팩 공유하기",
    check: "저장소 열기",
  },
};
