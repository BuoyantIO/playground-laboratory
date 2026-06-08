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
    'A standalone generator calls a Go backend through the mesh; this dashboard streams every call live. Change the rate, target, or headers and watch the mesh respond.',

  'section.live': 'Live traffic',
  'section.latency': 'Latency timeline',
  'section.counters': 'Counters',
  'section.samples': 'Recent samples',

  'config.title': 'Generator controls',
  'config.description':
    'Tune the live traffic the playground-client generator sends. Changes are applied by the generator within a couple of seconds.',

  'polling.label': 'Polling interval',
  'polling.paused': 'Paused',
  'polling.hintPaused': 'Paused; no requests in flight',
  'polling.hintActive': 'Next request in ≤ {ms} ms',

  'concurrency.label': 'Concurrency',
  'concurrency.hint': '{n} parallel request lane(s)',

  'target.label': 'Target',
  'target.hint': 'Which service the generator calls',
  'target.apex': 'apex (round-robin v1/v2)',
  'target.primary': 'primary (v1)',
  'target.canary': 'canary (v2)',
  'target.custom': 'custom URL',
  'target.pathLabel': 'Path',
  'target.urlLabel': 'Custom URL',
  'target.urlHint': 'e.g. http://host:port',

  'headers.label': 'Request headers',
  'headers.hint': 'Sent on every generated request',
  'headers.name': 'header',
  'headers.value': 'value',
  'headers.add': '+ add header',
  'headers.remove': 'remove header',
  'headers.empty': 'no custom headers',

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

  'code.apply': 'Apply',
  'code.copy': 'Copy command',
  'code.copied': 'Copied!',

  'panel.title': 'Tutorial',
  'panel.select': 'Select tutorial',
  'panel.collapse': 'Collapse panel',
  'panel.open': 'Tutorials',
  'panel.loading': 'Loading…',
  'panel.failed': 'Failed to load tutorial.',

  'controls.open': 'Controls',
  'controls.collapse': 'Collapse controls',

  'topology.client': 'Next.js client',
  'topology.thisBrowser': 'this browser',
  'topology.generator': 'Traffic generator',
  'topology.generatorSub': 'always-on',
  'topology.genLabel': 'generator',
  'topology.genLive': '{n}s ago',
  'topology.genStale': 'stale {n}s',
  'topology.genNone': 'no samples',
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
    '독립 생성기가 메시를 통해 Go 백엔드를 호출하고, 이 대시보드가 모든 호출을 실시간으로 스트리밍합니다. 속도, 대상, 헤더를 바꿔 메시가 어떻게 응답하는지 확인하세요.',

  'section.live': '실시간 트래픽',
  'section.latency': '지연 시간 타임라인',
  'section.counters': '카운터',
  'section.samples': '최근 샘플',

  'config.title': '생성기 설정',
  'config.description':
    'playground-client 생성기가 보내는 실시간 트래픽을 조정합니다. 변경 사항은 몇 초 안에 생성기에 적용됩니다.',

  'polling.label': '폴링 간격',
  'polling.paused': '일시정지',
  'polling.hintPaused': '일시정지됨; 진행 중인 요청 없음',
  'polling.hintActive': '다음 요청까지 ≤ {ms} ms',

  'concurrency.label': '동시성',
  'concurrency.hint': '{n}개의 병렬 요청 레인',

  'target.label': '대상',
  'target.hint': '생성기가 호출할 서비스',
  'target.apex': 'apex (v1/v2 라운드로빈)',
  'target.primary': 'primary (v1)',
  'target.canary': 'canary (v2)',
  'target.custom': '커스텀 URL',
  'target.pathLabel': '경로',
  'target.urlLabel': '커스텀 URL',
  'target.urlHint': '예: http://host:port',

  'headers.label': '요청 헤더',
  'headers.hint': '모든 생성 요청에 전송됨',
  'headers.name': '헤더',
  'headers.value': '값',
  'headers.add': '+ 헤더 추가',
  'headers.remove': '헤더 제거',
  'headers.empty': '커스텀 헤더 없음',

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

  'code.apply': '적용',
  'code.copy': '명령 복사',
  'code.copied': '복사됨!',

  'panel.title': '튜토리얼',
  'panel.select': '튜토리얼 선택',
  'panel.collapse': '패널 접기',
  'panel.open': '튜토리얼',
  'panel.loading': '불러오는 중…',
  'panel.failed': '튜토리얼을 불러오지 못했습니다.',

  'controls.open': '컨트롤',
  'controls.collapse': '컨트롤 접기',

  'topology.client': 'Next.js 클라이언트',
  'topology.thisBrowser': '이 브라우저',
  'topology.generator': '트래픽 생성기',
  'topology.generatorSub': '상시 실행',
  'topology.genLabel': '생성기',
  'topology.genLive': '{n}초 전',
  'topology.genStale': '{n}초 지연',
  'topology.genNone': '샘플 없음',
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
