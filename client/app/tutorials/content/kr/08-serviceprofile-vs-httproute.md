# 08 — ServiceProfile이 HTTPRoute를 덮어씀 (조용히, 그리고 끈질기게)

Linkerd는 동일한 Service에 대해 두 가지 라우팅 CRD를 지원합니다:

- `ServiceProfile` — 레거시 API. 라우트, 재시도 예산, 응답 분류,
  `dstOverrides`를 통한 트래픽 분할을 제공합니다.
- `HTTPRoute` (`policy.linkerd.io` 또는 상위 Gateway API) — 최신 API.
  라우트 매칭, 가중치를 가진 `backendRefs`, 타임아웃,
  `RequestHeaderModifier` 필터를 제공합니다.

**두 리소스가 같은 대상에 적용되어 있을 때, 프록시는 ServiceProfile을
사용하고 HTTPRoute를 무시합니다.** 에러도 발생하지 않고, 이벤트도
생성되지 않습니다. HTTPRoute는 그냥 아무 효과가 없습니다.

전형적인 마이그레이션 함정입니다: 운영자가 카나리 배포를 위해 HTTPRoute를
추가했지만, v1alpha2 시절부터 남아 있던 오래된 ServiceProfile이 여전히
자리잡고 있어서 트래픽은 옛 설정대로 계속 흘러갑니다.

**더 나쁜 점은 이 선택이 끈질기다는 것입니다.** 아웃바운드 프록시의
대상별 사이드카가 한번 ServiceProfile 경로를 선택하면 (사이드카가
처음 구성될 때 SP가 존재하고 routes/dstOverrides를 가지고 있었기
때문에), 나중에 ServiceProfile을 삭제해도 사이드카가 HTTPRoute
경로로 **전환되지 않습니다.** 사이드카는 기본(no-op) 라우트를 가진
프로파일 경로에 그대로 머무르며, 재구성되어야만 — 실질적으로는 프록시
재시작이 필요하다는 뜻입니다 — 상태가 바뀝니다.

이 런북은 정상 상태에서의 우선순위 동작과 삭제 이후의 끈질긴 동작을
모두 다룹니다. 차트가 배포하는 두 가지 서버 버전
(`playground-server-http-primary`의 v1, `playground-server-http-canary`의
v2)이 정점(apex) 서비스 `playground-server-http` 뒤에 위치한 구성을
사용합니다.

## Setup

[00-setup.md](00-setup.md)를 참조하여 새 클러스터, Linkerd Enterprise,
playground 앱을 준비하세요. 진행하기 전에 UI에서 `mTLS` 배지와 함께
초록색 `200` 응답이 보여야 합니다. apex 서비스 뒤에 있는 두 백엔드 사이를
kube-proxy가 라운드로빈으로 라우팅하기 때문에, UI의 Version 열은 `v1`
(primary)과 `v2` (canary) 사이를 번갈아 보여줘야 합니다.

## Symptom

서로 다른 두 가지 증상이 있지만, 둘 다 같은 근본 메커니즘에서
비롯됩니다.

### Symptom A: HTTPRoute가 처음부터 효과가 없는 것처럼 보임

- UI의 Version 열에 **v1만** (primary) 계속 표시됩니다.
- v1 카운터는 증가하지만 v2 카운터는 멈춰 있습니다.
- HTTPRoute는 canary 백엔드에 `weight: 100`이라고 *명시되어* 있지만
  완전히 무시됩니다.
- `kubectl describe httproute playground-server-canary`를 실행해도
  Linkerd 에러나 충돌 경고가 없습니다.

### Symptom B: HTTPRoute가 재시작 후에야 동작하기 시작함

- 운영자가 Symptom A를 알아차립니다.
- 트래픽이 HTTPRoute로 옮겨가길 기대하며 ServiceProfile을 삭제합니다.
- 아무것도 바뀌지 않습니다. UI는 여전히 v1만 표시합니다.
- 몇 시간이 지나도 개선되지 않습니다.
- 마침내 클라이언트 deployment를 재시작(또는 롤링)하고 나서야,
  *그제서야* v2가 나타나기 시작합니다.

## Recreate

이 시나리오는 두 증상을 순차적으로 재현합니다. 각 단계에는 다음 단계로
넘어가기 전에 프록시가 실제로 무엇을 하고 있는지 확인하는 검증이
포함되어 있습니다. UI는 한 탭에 열어두고, kubectl 명령을 위한 터미널을
준비하세요.

먼저 모든 트래픽을 v1에 고정하는 ServiceProfile을 적용합니다:

```sh
kubectl apply -f - <<'EOF'
apiVersion: linkerd.io/v1alpha2
kind: ServiceProfile
metadata:
  name: playground-server-http.playground.svc.cluster.local
  namespace: playground
spec:
  routes: []
  dstOverrides:
    - authority: playground-server-http-primary.playground.svc.cluster.local.:8080
      weight: 1000
    - authority: playground-server-http-canary.playground.svc.cluster.local.:8080
      weight: 0
EOF
kubectl rollout restart deploy -n playground -l app=playground-client
```

destination 컨트롤러가 클라이언트 프록시로 프로파일을 푸시할 때까지
약 5초 정도 기다리세요. UI의 Version 열이 **v1만** 표시하도록 수렴해야
합니다.

20번의 요청 샘플로 검증합니다:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl -n playground debug "$POD" \
  --image=curlimages/curl --profile=general --quiet -i -- \
  sh -c 'for i in $(seq 1 20); do
    curl -s -D - -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ \
      | grep -i x-app-version
  done | sort | uniq -c'
# 20 x-app-version: v1
# (v2 없음)
```

ServiceProfile이 적용된 상태입니다. 내부 동작은 다음과 같습니다: 이
시점에 클라이언트의 `playground-server-http`에 대한 아웃바운드 사이드카가
구성되어 있고 (프록시 시작 시점에, 혹은 그 이전에 SP가 이미 존재한
상태에서 구성됨), **ServiceProfile 경로**에 있습니다 — 프록시는
프로파일 receiver를 관찰하면서 `dstOverrides`를 적용합니다.

정책 측에서 확인하려면:

```sh
linkerd diagnostics profile playground-server-http.playground.svc.cluster.local
```

```
{
  "fully_qualified_name": "playground-server-http.playground.svc.cluster.local",
  "retry_budget": {
    "retry_ratio": 0.2,
    "min_retries_per_second": 10,
    "ttl": {
      "seconds": 10
    }
  },
  "dst_overrides": [
    {
      "authority": "playground-server-http-primary.playground.svc.cluster.local.:8080",
      "weight": 10000000
    },
    {
      "authority": "playground-server-http-canary.playground.svc.cluster.local.:8080"
    }
  ],
  "parent_ref": {
    "Kind": {
      "Resource": {
        "group": "core",
        "kind": "Service",
        "name": "playground-server-http",
        "namespace": "playground",
        "port": 80
      }
    }
  },
  "profile_ref": {
    "Kind": {
      "Resource": {
        "group": "linkerd.io",
        "name": "playground-server-http.playground.svc.cluster.local",
        "namespace": "playground"
      }
    }
  }
}
```

운영자는 모든 트래픽을 v2로 카나리하기로 결정하고, ServiceProfile이
여전히 가로막고 있다는 사실을 모른 채 HTTPRoute를 적용합니다:

```sh
kubectl apply -f - <<'EOF'
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: playground-server-canary
  namespace: playground
spec:
  parentRefs:
    - name: playground-server-http
      kind: Service
      group: ""
      port: 8080
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: playground-server-http-primary
          port: 8080
          weight: 0
        - name: playground-server-http-canary
          port: 8080
          weight: 100
EOF
```

약 5초 기다립니다. HTTPRoute는 v2에 100%를 주장하지만, UI는
**여전히 v1만 표시합니다**.

샘플을 다시 실행해 봅니다:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl -n playground debug "$POD" \
  --image=curlimages/curl --profile=general --quiet -i -- \
  sh -c 'for i in $(seq 1 20); do
    curl -s -D - -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ \
      | grep -i x-app-version
  done | sort | uniq -c'
# 20 x-app-version: v1
# (v2 없음)
```

두 리소스가 에러 이벤트 없이 사이좋게 공존하는지 확인합니다:

```sh
kubectl -n playground get serviceprofile,httproute
```

```
NAME                                                                            AGE
serviceprofile.linkerd.io/playground-server-http.playground.svc.cluster.local   7m54s

NAME                                                           HOSTNAMES   AGE
httproute.gateway.networking.k8s.io/playground-server-canary               6s
```

**이것이 Symptom A입니다: routes나 `dstOverrides`를 가진 SP가
존재할 때 HTTPRoute가 조용히 무시되는 현상.**

운영자가 Symptom A를 알아채고 "ServiceProfile만 제거하면 HTTPRoute가
인계받겠지"라고 결론을 내리고 삭제합니다:

```sh
kubectl -n playground delete serviceprofile \
  playground-server-http.playground.svc.cluster.local
```

destination 컨트롤러가 "프로파일 없음" 업데이트를 푸시하도록 약 10초
정도 기다린 후 샘플을 다시 실행합니다:

```sh
kubectl -n playground debug "$POD" \
  --image=curlimages/curl --profile=general --quiet -i -- \
  sh -c 'for i in $(seq 1 20); do
    curl -s -D - -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ \
      | grep -i x-app-version
  done | sort | uniq -c'
      9 x-app-version: v1
     11 x-app-version: v2
```

`weight: 100 → canary`라고 명시된 HTTPRoute는 여전히 효과가 없습니다.
ServiceProfile은 사라졌지만, 프록시는 경로를 전환하지 않았습니다.

## Why this happens

아웃바운드 프록시는 각 대상에 대해 ServiceProfile 스트림(destination
컨트롤러에서)과 OutboundPolicy 스트림(HTTPRoute가 있는 policy
컨트롤러에서)을 *둘 다* 구독합니다. 둘은 병렬로 프록시에 도착합니다.

대상별 HTTP 사이드카를 구성할 때 프록시는 **둘 중 하나**의 소스를
선택합니다.

**1. SP가 routes 또는 `dstOverrides`를 가지고 있으면 ServiceProfile이
이깁니다.** 비어 있는 ServiceProfile (routes도 없고 `dstOverrides`도
없는 것)은 정책을 **덮어쓰지 않으므로**, 그대로 둬도 안전합니다.
함정은 실제로 라우팅 로직을 가지고 있는 ServiceProfile에만 해당합니다.

**2. 선택은 사이드카 구성 시점에 단 한 번 결정됩니다.** ServiceProfile
경로가 선택되면, 그 로직은 **다시 평가되지 않습니다.** 사이드카는
프로파일 receiver에 영구적으로 구독되어 있고, 남은 수명 동안 정책
receiver를 무시합니다.

나중에 ServiceProfile이 삭제되면, 사이드카는 기본 라우트로 트래픽을
서비스하며 **HTTPRoute는 사용하지 않습니다.** 라우팅 결정은 다음
경우에 재평가됩니다:

- **프록시 재시작**: 모든 대상의 사이드카가 재구성됩니다. 신뢰할 수
  있는 트리거입니다.
- **대상별 캐시 만료(eviction)**: 대상이 충분히 오래 유휴 상태에
  있으면 캐시 엔트리가 제거되고, 그 대상에 대한 다음 요청이 현재
  상태로 새 사이드카를 구성합니다. 지속적인 트래픽이 있는 경우 (SMA
  셋업이 여기에 해당) 이 만료는 절대 일어나지 않습니다.

따라서 운영적으로 정확한 규칙은 다음과 같습니다: **HTTPRoute를
활성화하기 위해 ServiceProfile을 제거한 후에는, 그 대상으로 트래픽을
보내고 있던 프록시들을 롤(roll)하세요.**

## Diagnose

```sh
# 1. 대상에 대한 ServiceProfile이 존재하는가?
kubectl -n playground get serviceprofile

# 2. routes 또는 dstOverrides를 가지고 있는가? 이것들이 덮어쓰기를
#    트리거합니다. routes가 비어 있는 ServiceProfile은 트리거하지 않습니다.
kubectl -n playground get serviceprofile \
  playground-server-http.playground.svc.cluster.local -o yaml 2>/dev/null \
  | grep -A3 -E 'routes:|dstOverrides:'

# 3. 프록시 로그 레벨을 올리고 사이드카가 어떤 결정을 내렸는지 확인합니다.
#    기억하세요: 각 로그 라인은 대상별로 사이드카 구성 시점에 단 한 번만
#    발생합니다.
kubectl port-forward -n playground deploy/playground-client 4191
curl -v --data 'linkerd=debug' -X PUT localhost:4191/proxy-log-level

kubectl -n playground logs deploy/playground-client -c linkerd-proxy \
  | grep -E 'Using ServiceProfile|Using ClientPolicy'

# 4. ServiceProfile을 이미 삭제했는데도 트래픽이 여전히 Symptom B (끈질긴
#    동작)처럼 보인다면, 프록시가 결정을 재평가했는지 확인하세요:
kubectl -n playground logs deploy/playground-client -c linkerd-proxy --since=5m \
  | grep -E 'Using ServiceProfile|Using ClientPolicy'
# 해당 대상에 대한 가장 최근 라인이 여전히 "Using ServiceProfile"이라면,
# 사이드카가 재구성되지 않은 것입니다. 클라이언트를 롤하세요.
```

## Fix

ServiceProfile을 삭제하고 **반드시** 그 대상으로 트래픽을 보내는
클라이언트들을 롤하세요. 두 단계 모두 필수입니다:

```sh
kubectl -n playground delete serviceprofile \
  playground-server-http.playground.svc.cluster.local

kubectl -n playground rollout restart deploy/playground-client
kubectl -n playground rollout status deploy/playground-client
```

UI를 지켜보세요: 롤아웃 이후 Version 열에 v2가 나타나기 시작합니다.
30초가 지나면 (HTTPRoute의 `weight: 100`에 따라) v2가 우세해져야
합니다.

영향을 받은 대상으로 트래픽을 보내는 워크로드가 여러 개라면 그것들을
모두 롤하세요. 각 클라이언트 프록시는 독립적으로 ServiceProfile에
커밋되었기 때문에, 각각의 사이드카를 재구성해야 합니다.
