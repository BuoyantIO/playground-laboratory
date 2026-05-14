import type { Lang } from './i18n';

export const SLIDES_URL =
  'https://docs.google.com/presentation/d/18M_pz79prdza_aU2LWUq8bgpTqr9Fir3QIpadUCLiRk/edit?usp=sharing';

export interface TutorialMeta {
  slug: string;
  order: string;
  title: Record<Lang, string>;
  blurb: Record<Lang, string>;
}

export const tutorials: TutorialMeta[] = [
  {
    slug: '00-setup',
    order: '00',
    title: {
      en: 'Cluster + Linkerd Enterprise setup',
      kr: '클러스터 + Linkerd Enterprise 설치',
    },
    blurb: {
      en: 'Bring up a fresh k3d cluster with Linkerd Enterprise and the playground app. Start here.',
      kr: '새 k3d 클러스터에 Linkerd Enterprise와 플레이그라운드 앱을 설치합니다. 여기서 시작하세요.',
    },
  },
  {
    slug: '01-networkpolicy-blocks-proxy',
    order: '01',
    title: {
      en: 'NetworkPolicy blocks the inbound proxy port',
      kr: 'NetworkPolicy가 인바운드 프록시 포트를 차단하는 경우',
    },
    blurb: {
      en: 'A policy that allows :8080 but forgets :4143 silently kills all meshed inbound traffic.',
      kr: ':8080은 허용하지만 :4143을 빠뜨린 정책이 메시 인바운드 트래픽을 조용히 차단합니다.',
    },
  },
  {
    slug: '02-protocol-detection-timeout',
    order: '02',
    title: {
      en: 'Outbound protocol-detection timeout (10 s hang)',
      kr: '아웃바운드 프로토콜 감지 타임아웃 (10초 지연)',
    },
    blurb: {
      en: 'Server-speaks-first protocols stall for 10 s while the proxy waits for client bytes.',
      kr: '서버가 먼저 말하는 프로토콜은 프록시가 클라이언트 바이트를 기다리는 동안 10초간 멈춥니다.',
    },
  },
  {
    slug: '04-failfast-no-endpoints',
    order: '04',
    title: {
      en: '504 failfast: no ready endpoints',
      kr: '504 failfast: 준비된 엔드포인트 없음',
    },
    blurb: {
      en: 'Zero ready endpoints sends the outbound balancer into failfast and synthesises a 504.',
      kr: '준비된 엔드포인트가 0이면 아웃바운드 밸런서가 failfast 상태로 진입해 504를 합성합니다.',
    },
  },
  {
    slug: '05-app-injected-503',
    order: '05',
    title: {
      en: 'App-injected 503 (not a mesh problem)',
      kr: '앱이 주입한 503 (메시 문제가 아님)',
    },
    blurb: {
      en: 'How to tell that a 5xx came from the application, not from a proxy-synthesised error.',
      kr: '5xx가 프록시 합성 오류가 아닌 애플리케이션에서 왔는지 구별하는 방법.',
    },
  },
  {
    slug: '06-crashloop-failfast',
    order: '06',
    title: {
      en: 'Persistent failfast from a CrashLoopBackOff',
      kr: 'CrashLoopBackOff로 인한 지속적 failfast',
    },
    blurb: {
      en: 'Same mesh symptom as runbook 04, but the workload is broken so endpoints stay empty forever.',
      kr: '04번과 같은 메시 증상이지만, 워크로드가 망가져 엔드포인트가 영원히 비어 있습니다.',
    },
  },
  {
    slug: '08-serviceprofile-vs-httproute',
    order: '08',
    title: {
      en: 'ServiceProfile overrides HTTPRoute (silent)',
      kr: 'ServiceProfile이 HTTPRoute를 덮어씁니다 (조용히)',
    },
    blurb: {
      en: 'When both attach to a Service, the proxy uses ServiceProfile and ignores HTTPRoute, silently.',
      kr: '둘 다 Service에 연결되면 프록시는 ServiceProfile을 사용하고 HTTPRoute를 조용히 무시합니다.',
    },
  },
];

export function findTutorial(slug: string): TutorialMeta | undefined {
  return tutorials.find(t => t.slug === slug);
}
