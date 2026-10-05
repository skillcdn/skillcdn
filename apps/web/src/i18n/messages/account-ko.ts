import type { accountEn } from "./account-en.js";

/** 목록에 적는 날짜. */
const day = (iso: string): string =>
  new Date(iso).toLocaleDateString("ko", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export const accountKo: typeof accountEn = {
  auth: {
    signIn: "로그인",
    continueWith: "GitHub로 계속하기",
    agreement: {
      both: "계속하면 {terms}과 {privacy}에 동의하게 됩니다.",
      terms: "계속하면 {terms}에 동의하게 됩니다.",
      privacy: "계속하면 {privacy}에 동의하게 됩니다.",
      termsName: "이용약관",
      privacyName: "개인정보 처리방침",
    },
    dialog: {
      title: "SkillCDN에 오신 걸 환영해요",
      lead: "로그인하고 모든 기능을 활용해 보세요.",
      close: "닫기",
    },
    accountSignedOut: "로그인하면 내 계정을 볼 수 있어요.",
    signOut: "로그아웃",
    menu: (login: string) => `${login} 계정 메뉴`,
    profile: "내 프로필",
    account: "내 계정",
    repositories: "비공개 저장소",
    apps: "연결된 앱",
    tokens: "토큰",
    privateSignedOut:
      "비공개 저장소인가요? GitHub로 로그인하면 접근 권한이 있는 저장소를 열 수 있어요.",
    privateSignedIn:
      "비공개 저장소는 SkillCDN GitHub 앱이 설치되어 있고 내 계정으로 볼 수 있을 때 열립니다.",
    privateManage: "내 저장소 보기",
    failures: {
      expired: {
        title: "로그인 시간이 지났어요",
        body: "처음부터 다시 시작해서 10분 안에 GitHub에서 마쳐 주세요.",
      },
      failed: {
        title: "로그인을 마치지 못했어요",
        body: "GitHub에서 로그인을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      },
    },
  },

  owner: {
    metaTitle: (login: string) => `${login} | SkillCDN`,
    metaDescription: (login: string) =>
      `${login}의 GitHub 공개 저장소와, 그 안에서 SkillCDN이 AI 에이전트에 제공하는 스킬입니다.`,
    kinds: { organization: "조직", user: "개인" },
    viewOnHost: "GitHub에서 보기",
    you: "내 프로필이에요",
    manage: "내 계정",
    publicCount: (count: number) => `공개 저장소 ${count.toLocaleString("ko")}개`,
    indexed: "스킬",
    indexedLead: "이미 색인된 저장소예요. 하나를 열어 내 AI에 연결해 보세요.",
    repositories: "공개 저장소",
    repositoriesAfterIndexed: "그 밖의 공개 저장소",
    repositoriesLead:
      "GitHub의 목록 그대로, 최근에 바뀐 순서예요. 열어 보면 스킬이 있는지 알 수 있어요.",
    fork: "포크",
    archived: "보관됨",
    stars: (count: number) => `스타 ${count.toLocaleString("ko")}개`,
    updated: (iso: string) => `${day(iso)} 업데이트`,
    more: "더 보기",
    empty: {
      title: "공개 저장소가 없어요",
      body: "이 계정은 아직 GitHub에 공개한 것이 없어요.",
    },
    notFound: {
      title: "계정을 찾을 수 없습니다",
      body: "GitHub에 그런 이름의 계정이 없습니다.",
    },
  },

  account: {
    metaTitle: "내 계정 | SkillCDN",
    title: "내 계정",
    navigation: "계정 메뉴",
    sections: {
      overview: "한눈에 보기",
      repositories: "비공개 저장소",
      apps: "연결된 앱",
      tokens: "토큰",
    },
    overview: {
      lead: "GitHub로 로그인되어 있어요. SkillCDN은 내가 무엇을 볼 수 있는지만 GitHub에 물어보고, 거기서 아무것도 바꾸지 못해요.",
      profile: "공개 프로필",
      profileBody: "누구에게나 보이는 내용이에요. GitHub의 내 공개 저장소와 그 안의 스킬입니다.",
      profileAction: "내 프로필 보기",
      repositoriesBody: "비공개 저장소를 내 AI 앱과 이 사이트에서 사용해 보세요.",
      repositoriesAction: "비공개 저장소 설정하기",
      appsBody: "내 이름으로 비공개 저장소를 읽도록 허용한 AI 앱이에요.",
      appsAction: "연결된 앱 보기",
      tokensBody: "예약 작업이나 서버처럼 로그인할 수 없는 에이전트에 쓰는 토큰이에요.",
      tokensAction: "토큰 관리하기",
      signOutBody:
        "로그아웃하면 이 브라우저의 로그인만 끝나요. 연결한 앱은 직접 삭제하기 전까지 계속 동작해요.",
    },
    repositories: {
      lead: "비공개 저장소는 GitHub에서 볼 수 있는 사람에게만 제공돼요. 저장소를 읽으려면 그 저장소에 SkillCDN GitHub 앱이 설치되어 있어야 해요.",
      steps: [
        "GitHub에서 저장소에 SkillCDN 앱을 추가하세요. 앱은 저장소를 읽기만 할 수 있어요.",
        "여기서 저장소를 여세요. 나와, GitHub에서 그 저장소를 볼 수 있는 사람만 들어올 수 있어요.",
        "저장소 페이지에서 AI 앱을 연결하세요. 앱이 내 이름으로 한 번 로그인해요.",
      ],
      install: "GitHub에서 저장소 추가하기",
      installHint: "GitHub가 어느 계정의 어떤 저장소인지 물어봐요. 마치면 여기로 돌아오세요.",
      refresh: "새로 고침",
      none: {
        title: "아직 저장소가 없어요",
        body: "내가 볼 수 있는 저장소에 GitHub 앱이 설치되면 여기에 나타나요.",
      },
      selection: { all: "모든 저장소", selected: "선택한 저장소" },
      manage: "GitHub에서 변경",
      private: "비공개",
      public: "공개",
      truncated: "앞부분만 표시했어요. 나머지는 주소로 직접 열 수 있어요.",
      moreInstallations: "앞의 계정만 표시했어요.",
    },
    apps: {
      lead: "이 앱들은 각각 비공개 주소 하나를 내 이름으로 읽을 수 있어요. 삭제하면 그 앱은 바로 로그아웃돼요.",
      none: {
        title: "연결된 앱이 없어요",
        body: "AI 앱이 내 비공개 저장소에 연결을 요청하고 내가 허용하면 여기에 나타나요.",
      },
      connected: (iso: string) => `${day(iso)} 연결`,
      lastUsed: (iso: string) => `${day(iso)} 마지막 사용`,
      neverUsed: "아직 사용한 적 없음",
      remove: "삭제",
      removeLabel: (client: string, address: string) => `${address}에서 ${client} 삭제`,
      removed: "삭제했어요. 앱이 다시 요청해야 해요.",
    },
    tokens: {
      lead: "토큰이 있으면 예약 작업이나 서버처럼 로그인할 사람이 없는 에이전트도 비공개 저장소 하나를 내 이름으로 읽을 수 있어요. 토큰을 가진 사람은 누구나 그 저장소를 읽을 수 있으니 비밀번호처럼 보관하세요. 직접 쓰는 AI 앱에는 토큰이 필요 없어요. 앱이 로그인하니까요.",
      form: {
        title: "토큰 만들기",
        repository: "저장소",
        name: "이름",
        namePlaceholder: "야간 작업",
        nameHint: "이름은 나만 볼 수 있어요. 토큰을 쓸 곳의 이름을 붙여 두세요.",
        expires: "만료",
        lifetime: (days: number) => (days === 365 ? "1년 뒤" : `${days}일 뒤`),
        make: "토큰 만들기",
        making: "만드는 중…",
      },
      noRepositories: {
        title: "아직 비공개 저장소가 없어요",
        body: "토큰은 SkillCDN GitHub 앱이 설치된 비공개 저장소에 만들어요. 공개 저장소에는 토큰이 필요 없어요.",
        action: "비공개 저장소 설정하기",
      },
      made: {
        title: "지금 토큰을 복사하세요",
        body: "이번 한 번만 보여 드려요. 이 페이지도 다시 보여 줄 수 없으니, 잃어버렸다면 삭제하고 새로 만드세요.",
        token: "토큰",
        give: "에이전트에 넣기",
        giveBody: (repository: string) =>
          `에이전트는 저장소 주소에 연결하고 요청마다 토큰을 보내요. ${repository}의 모든 브랜치, 태그, 폴더를 읽을 수 있고 다른 것은 읽지 못해요.`,
        claudeCode: "Claude Code",
        codex: "Codex",
        other: "헤더",
        otherHint: "그 밖의 클라이언트는 이 주소에 연결하고, 요청마다 이 헤더를 보내면 돼요.",
        address: "주소",
        done: "복사했어요",
      },
      list: "내 토큰",
      none: {
        title: "토큰이 없어요",
        body: "만든 토큰이 여기에 나타나요. 비밀 값은 다시 보이지 않아요.",
      },
      madeAt: (iso: string) => `${day(iso)} 만듦`,
      expiresAt: (iso: string) => `${day(iso)} 만료`,
      lastUsed: (iso: string) => `${day(iso)} 마지막 사용`,
      neverUsed: "아직 사용한 적 없음",
      remove: "삭제",
      removeLabel: (label: string, address: string) => `${address}의 토큰 ${label} 삭제`,
      removed: "삭제했어요. 이 토큰은 더 이상 쓸 수 없어요.",
    },
  },

  authorize: {
    metaTitle: "앱 허용 | SkillCDN",
    title: (client: string) => `${client} 앱에 이 저장소 읽기를 허용할까요?`,
    labels: { app: "앱", address: "읽는 주소", account: "로그인 계정" },
    what: "이 주소의 스킬과 문서를 내 이름으로 읽을 수 있어요. 아무것도 바꿀 수 없고, 내 다른 저장소는 읽지 못해요.",
    returns: (host: string) => `답과 함께 ${host} 주소로 돌아갑니다.`,
    loopback: "이 컴퓨터에 있는 앱이에요.",
    selfNamed: "이름은 앱이 스스로 밝힌 것이에요. 실제로 권한을 받는 곳은 돌아가는 주소입니다.",
    refused: {
      title: (client: string) => `${client} 앱을 아직 연결할 수 없어요`,
      recheck: "다시 확인",
      back: "앱으로 돌아가기",
      backHint: (host: string) => `돌아가면 ${host}에는 허용되지 않았다는 것만 알려요.`,
    },
    notVisible: {
      title: "이 계정으로는 저장소를 열 수 없어요",
      body: "그런 저장소가 없거나, 이 계정으로는 GitHub에서 볼 수 없거나, SkillCDN GitHub 앱이 저장소에 설치되어 있지 않아요. 앱에는 아무것도 넘기지 않았어요.",
      fix: "앱에 넣은 주소를 확인하거나, 저장소를 볼 수 있는 계정으로 로그인하거나, GitHub에서 저장소에 SkillCDN 앱을 추가하세요. 방금 추가했다면 잠시 뒤에 다시 확인해 보세요.",
      install: "GitHub에서 저장소 추가하기",
    },
    unknown: {
      title: "지금은 GitHub에 확인할 수 없어요",
      body: "이 계정이 저장소를 열 수 있는지 확인하지 못해서 아직 허용할 것이 없어요. 잠시 뒤에 다시 확인해 주세요.",
    },
    allow: "허용",
    deny: "취소",
    working: "앱으로 돌아가는 중…",
    signIn: {
      title: (client: string) => `${client} 앱이 연결하려고 해요`,
      body: "계속하려면 GitHub로 로그인하세요. 앱에 무엇이든 넘기기 전에 먼저 물어봐요.",
    },
    notYou: "내 계정이 아닌가요? 로그아웃",
    errors: {
      invalid_client: {
        title: "어떤 앱인지 확인할 수 없어요",
        body: "여기로 보낸 앱을 이 사이트가 알지 못해요. 앱으로 돌아가 다시 연결해 주세요.",
      },
      invalid_redirect_uri: {
        title: "신뢰할 수 없는 요청이에요",
        body: "앱이 등록한 적 없는 곳으로 돌려보내 달라고 했어요. 넘긴 것은 없어요.",
      },
      invalid_request: {
        title: "사용할 수 없는 요청이에요",
        body: "앱이 보낸 요청을 이 사이트에서 처리할 수 없어요. 넘긴 것은 없어요. 앱으로 돌아가 다시 연결해 보세요. 계속 반복되면 앱을 만든 곳에 알려 주세요.",
      },
      expired: {
        title: "요청이 만료됐어요",
        body: "앱으로 돌아가 다시 연결해 주세요.",
      },
      missing: {
        title: "확인할 것이 없어요",
        body: "이 페이지는 AI 앱이 비공개 저장소에 연결할 때 열려요.",
      },
    },
  },
};
