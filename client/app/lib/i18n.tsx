'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Lang = 'en' | 'kr';

const STORAGE_KEY = 'sma.lang';

type Dict = Record<string, string>;

const en: Dict = {
  'nav.demo': 'playground demo',
  'nav.academy': 'academy ↗',
  'nav.tutorials': 'tutorials',
  'nav.dashboard': 'dashboard',

  'tutorials.section': 'Service Mesh Academy',
  'tutorials.listTitle': 'Tutorials',
  'tutorials.listSubtitle':
    'Hands-on runbooks for the playground. Each one walks through a single failure mode; what it looks like in the UI, why it happens, how to diagnose, and how to fix.',
  'tutorials.runbook': 'Runbook',
  'tutorials.backToList': 'Back to tutorials',
  'tutorials.previous': 'Previous',
  'tutorials.next': 'Next',
  'tutorials.slides': 'Presentation slides ↗',

  'announcement.title': 'Get Service Mesh Certified with Buoyant.',
  'announcement.cta': 'Enroll now!',

  'hero.badge': 'Service Mesh Academy',
  'hero.demo': 'demo',
  'hero.titleA': 'Watch the mesh',
  'hero.titleB': 'in real time.',
  'hero.subtitle':
    'A Next.js client polls a Go backend once a second. Inject latency, flip error rates, or crash the server, and see exactly how the mesh responds.',

  'section.live': 'Live traffic',
  'section.latency': 'Latency timeline',
  'section.counters': 'Counters',
  'section.samples': 'Recent samples',

  'config.title': 'Client controls',
  'config.description':
    'Tune the live polling behaviour. Defaults come from POLL_INTERVAL_MS / POLL_ENABLED env vars on the playground-client pod.',

  'polling.label': 'Polling interval',
  'polling.paused': 'Paused',
  'polling.hintPaused': 'Paused; no requests in flight',
  'polling.hintActive': 'Next request in ≤ {ms} ms',

  'counters.lastResponse': 'Last response',
  'counters.lastLatency': 'Last latency',
  'counters.successRate': 'Success rate',
  'counters.avgLatency': 'Avg latency',
  'counters.max': 'max {ms} ms',

  'table.time': 'Time',
  'table.status': 'Status',
  'table.latency': 'Latency',
  'table.version': 'Version',
  'table.mtls': 'mTLS',
  'table.servedBy': 'Served by',
  'table.body': 'Body',
  'table.waiting': 'waiting for first response…',

  'chart.collecting': 'collecting samples…',
  'chart.now': 'now',
  'chart.ago': '−{n}s',

  'pills.plain.title':
    'no l5d-client-id header on response; proxy bypassed',

  'topology.client': 'Next.js client',
  'topology.thisBrowser': 'this browser',
  'topology.serverV1': 'Go server v1',
  'topology.serverV2': 'Go server v2',
  'topology.hits': '{n} hits',
  'topology.pod': 'pod · {name}',
  'topology.waiting': 'waiting…',
  'topology.verified': 'verified',
  'topology.absent': 'absent',

  'footer.brand': 'Service Mesh Academy',
  'footer.paused': 'polling paused',
  'footer.intervalSec': 'client polls server every {sec}s',
  'footer.intervalMs': 'client polls server every {ms}ms',

  'lang.en': 'EN',
  'lang.kr': 'KR',
};

const kr: Dict = {
  'nav.demo': '플레이그라운드 데모',
  'nav.academy': '아카데미 ↗',
  'nav.tutorials': '튜토리얼',
  'nav.dashboard': '대시보드',

  'tutorials.section': 'Service Mesh Academy',
  'tutorials.listTitle': '튜토리얼',
  'tutorials.listSubtitle':
    '플레이그라운드를 위한 실전 런북입니다. 각 런북은 하나의 장애 시나리오를 다룹니다; UI에서 어떻게 보이는지, 왜 발생하는지, 어떻게 진단하고 어떻게 고치는지.',
  'tutorials.runbook': '런북',
  'tutorials.backToList': '튜토리얼 목록으로',
  'tutorials.previous': '이전',
  'tutorials.next': '다음',
  'tutorials.slides': '발표 슬라이드 ↗',

  'announcement.title': 'Buoyant과 함께 서비스 메시 인증을 받으세요.',
  'announcement.cta': '지금 등록하세요!',

  'hero.badge': 'Service Mesh Academy',
  'hero.demo': '데모',
  'hero.titleA': '메시를 관찰하세요',
  'hero.titleB': '실시간으로.',
  'hero.subtitle':
    'Next.js 클라이언트가 1초마다 Go 백엔드를 폴링합니다. 지연을 주입하거나, 오류율을 변경하거나, 서버를 크래시시켜, 메시가 어떻게 응답하는지 정확히 확인하세요.',

  'section.live': '실시간 트래픽',
  'section.latency': '지연 시간 타임라인',
  'section.counters': '카운터',
  'section.samples': '최근 샘플',

  'config.title': '클라이언트 설정',
  'config.description':
    '실시간 폴링 동작을 조정합니다. 기본값은 playground-client 파드의 POLL_INTERVAL_MS / POLL_ENABLED 환경변수에서 가져옵니다.',

  'polling.label': '폴링 간격',
  'polling.paused': '일시정지',
  'polling.hintPaused': '일시정지됨; 진행 중인 요청 없음',
  'polling.hintActive': '다음 요청까지 ≤ {ms} ms',

  'counters.lastResponse': '마지막 응답',
  'counters.lastLatency': '마지막 지연',
  'counters.successRate': '성공률',
  'counters.avgLatency': '평균 지연',
  'counters.max': '최대 {ms} ms',

  'table.time': '시간',
  'table.status': '상태',
  'table.latency': '지연',
  'table.version': '버전',
  'table.mtls': 'mTLS',
  'table.servedBy': '처리한 노드',
  'table.body': '본문',
  'table.waiting': '첫 응답을 기다리는 중…',

  'chart.collecting': '샘플을 수집하는 중…',
  'chart.now': '현재',
  'chart.ago': '−{n}초',

  'pills.plain.title':
    '응답에 l5d-client-id 헤더 없음; 프록시 우회됨',

  'topology.client': 'Next.js 클라이언트',
  'topology.thisBrowser': '이 브라우저',
  'topology.serverV1': 'Go 서버 v1',
  'topology.serverV2': 'Go 서버 v2',
  'topology.hits': '{n}회 요청',
  'topology.pod': '파드 · {name}',
  'topology.waiting': '대기 중…',
  'topology.verified': '검증됨',
  'topology.absent': '없음',

  'footer.brand': 'Service Mesh Academy',
  'footer.paused': '폴링 일시정지됨',
  'footer.intervalSec': '클라이언트가 {sec}초마다 서버를 폴링합니다',
  'footer.intervalMs': '클라이언트가 {ms}ms마다 서버를 폴링합니다',

  'lang.en': 'EN',
  'lang.kr': 'KR',
};

const dictionaries: Record<Lang, Dict> = { en, kr };

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('kr');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'en' || stored === 'kr') setLangState(stored);
    } catch {
      // localStorage may be unavailable (SSR, sandboxed iframe)
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // see above
    }
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const raw = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
      if (!params) return raw;
      return raw.replace(/\{(\w+)\}/g, (_m, k) =>
        params[k] !== undefined ? String(params[k]) : `{${k}}`,
      );
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider');
  return ctx;
}
