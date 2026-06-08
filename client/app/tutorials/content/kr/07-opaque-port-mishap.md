# 08 — HTTP 포트를 opaque로 잘못 표시하면 라우팅이 조용히 비활성화된다

Linkerd의 프로토콜 감지는 각 연결의 처음 몇 바이트를 보고 HTTP/1, HTTP/2
(gRPC), opaque TCP 중 어느 것으로 다룰지 결정합니다. `config.linkerd.io/opaque-ports`
어노테이션으로 이 결정을 덮어쓸 수 있습니다 — 서버가 먼저 말하는 프로토콜
(MySQL, SMTP 등)에는 유용하지만, **HTTP/gRPC 포트를 opaque로 표시하고**
HTTPRoute를 사용한 Argo 점진적 롤아웃, L7 메트릭, AuthorizationPolicy
등에 의존하고 있다면 **심각한 결과**가 따릅니다.

상태 코드는 계속 `200`을 반환합니다. 잃어버린 것:

- 프록시의 라우트별 HTTP 메트릭.
- HTTPRoute 기반 타임아웃과 재시도.
- 라우트 계층의 AuthorizationPolicy.
- 메시 HTTP 호출에서 인바운드 프록시가 보통 주입하는 `l5d-client-id`
  요청 헤더. mTLS 자체는 TCP 계층에서 여전히 일어나고
  (`tcp_open_total`의 모든 행에 `tls="true"`), 다만 mTLS ID를 HTTP
  헤더로 노출하는 앱은 그 ID를 누락된 것으로 보고하게 됩니다.

플레이그라운드에서는 마지막 항목이 UI에서 관찰됩니다: 서버가 인바운드
요청에서 `l5d-client-id`를 읽어 응답에 `X-Mesh-Client-Id`로 다시
실어 보냅니다. opaque 포트 아래에서는 그 헤더가 비어 있어, UI의 mTLS
배지가 **plain**으로 바뀝니다. 그 간접 참조가 없는 앱이라면 배지는
녹색을 유지하고 실패는 조용히 숨겨졌을 것이며, 그것이 대부분의 팀이
프로덕션에서 만나는 변형입니다.

## 설치

[00-setup.md](00-setup.md)을 따라 새 클러스터, Linkerd Enterprise,
플레이그라운드 앱을 준비합니다. 진행하기 전에 UI에 녹색 `200`과 `mTLS`
배지가 보여야 합니다.

## 증상

- 클라이언트 UI: 상태 코드는 `200` 유지, 지연 시간은 정상.
- **mTLS 배지가 `plain`으로 바뀜** — 다만 이것은 플레이그라운드 특유의
  신호(서버가 `l5d-client-id`를 읽음)이며, 일반 워크로드에서는 동등한
  배지가 녹색을 유지하고 실패가 조용히 숨겨질 것입니다.
- 클라이언트 프록시의 아웃바운드 `request_total{authority="playground-server-http..."}`
  카운터가, 폴링은 계속되는데도 더 이상 증가하지 않습니다.
- 이전에 동작하던 HTTPRoute 타임아웃/재시도가 조용히 무동작이 됩니다.

## 어노테이션이 사는 곳

`config.linkerd.io/opaque-ports`는 세 곳에 설정할 수 있고, 각 위치는
연결의 *서로 다른* 측면에 영향을 줍니다. 어떤 게 어떤 건지 이해하는 것이
이 런북의 핵심입니다.

| 어노테이션 위치 | 읽는 주체 | 영향 |
|---|---|---|
| **워크로드 파드 템플릿** (`spec.template.metadata.annotations`) | admission 시점의 proxy-injector. 주입된 사이드카에서 `LINKERD2_PROXY_INBOUND_PORTS_DISABLE_PROTOCOL_DETECTION`이 됩니다. | **서버의 인바운드** 프록시에만 영향. 서버는 그 포트에 대해 HTTP 파싱을 멈춥니다: `l5d-client-id` 헤더 미주입, `inbound_http_request_total` 미증가, 인바운드 HTTPRoute/AuthorizationPolicy의 HTTP 계층이 우회됩니다. **아웃바운드 호출자는 영향받지 않습니다** — 단, 파드 IP로 직접 해석하는 경우는 예외(서비스 FQDN 트래픽에서는 드뭄). |
| **Service** (`metadata.annotations`) | destination 컨트롤러. 결과를 아웃바운드 정책(`protocol.Kind: Opaque`)에 게시합니다. | 그 Service의 모든 **아웃바운드 호출자**. 아웃바운드 프록시는 HTTP 감지를 건너뛰고 opaque 경로로 바이트를 라우팅합니다: 그 authority에 대한 `request_total`이 사라지고, Service에 붙은 HTTPRoute와 아웃바운드 HTTP 계층 정책이 우회됩니다. 서버의 인바운드 프록시는 *자신의* 어노테이션이 별도로 지시하지 않는 한 영향받지 않습니다. |
| **네임스페이스** | admission 시점의 proxy-injector. 그 어노테이션을 자신이 설정하지 않은 파드의 기본값으로 사용. | 네임스페이스 안의 **파드에만** 캐스케이드 — 위의 파드 템플릿 행과 동일한 효과를 모든 미오버라이드 파드에 적용. **Service는 상속하지 않습니다**: destination 컨트롤러는 각 Service 자신의 어노테이션을 읽고, 클러스터 전역의 `--default-opaque-ports` 플래그를 폴백으로 사용하지, 절대 네임스페이스를 사용하지 않습니다. |

흔한 문제: 팀이 서버가 먼저 말하는 포트를 opaque로 표시하기 위해
**파드**에 어노테이션을 달면서 **Service**는 손대지 않는 경우. 아웃바운드
호출자들은 계속 HTTP를 파싱하고 대시보드에는 라우트별 메트릭이 그대로
보이지만 — 서버측 HTTPRoute 작성자는 규칙을 발화시킬 수 없고, 플랫폼
팀의 AuthorizationPolicy가 조용히 무동작이 됩니다. 그 반대도 똑같이
흔합니다: 누군가가 "성능을 위해 감지를 끄려고" HTTP 포트의 **Service**에
어노테이션을 달면 모든 호출자에게서 아웃바운드 HTTP 가시성을 조용히
벗기는 반면, 서버측 메트릭은 계속 작동합니다.

해결은 항상 같습니다: 어느 쪽(또는 양쪽)을 opaque로 만들어야 할지 결정해
거기에 어노테이션을 답니다.

## 재현

### 1. Service의 opaque 포트

Service에 어노테이션을 달면 **모든 아웃바운드 호출자**에게 이 Service+포트에
대해 HTTP 감지를 건너뛰라고 지시합니다. destination 컨트롤러가 어노테이션을
주워 아웃바운드 정책에 `protocol.Kind: Opaque`로 게시하고, 아웃바운드
프록시는 바이트를 opaque 경로로 라우팅합니다. 서버의 인바운드 프록시는
영향받지 않습니다 — 여전히 HTTP를 파싱하고 `l5d-client-id`를 주입합니다.

변경 전, 다음 명령으로 정책을 살펴봅시다:

```
linkerd diagnostics policy -n playground svc/playground-server-http 8080 \
  | head -20                                     
```

```
metadata:
  Kind:
    Resource:
      group: core
      kind: Service
      name: playground-server-http
      namespace: playground
      port: 8080
protocol:
  Kind:
    Detect:
      http1:
        routes:
        - metadata:
            Kind:
              Default: http
          rules:
          - backends:
              Kind:
                FirstAvailable:
```

`Detect` 블록은 아웃바운드 프록시가 프로토콜을 감지한다는 뜻입니다.

이제 적용:

```sh
kubectl -n playground annotate svc playground-server-http \
  config.linkerd.io/opaque-ports=8080 --overwrite

kubectl -n playground rollout restart deploy/playground-client
kubectl -n playground rollout status  deploy/playground-client
```

**컨트롤 플레인에서 검증**, 광고되는 프로토콜이 `Detect`에서 `Opaque`로
바뀌어야 합니다:

```sh
linkerd diagnostics policy -n playground svc/playground-server-http 8080 \
  | head -20
```

```
metadata:
  Kind:
    Resource:
      group: core
      kind: Service
      name: playground-server-http
      namespace: playground
      port: 8080
protocol:
  Kind:
    Opaque:
      routes:
      - metadata:
          Kind:
            Default: opaq
        rules:
        - backends:
            Kind:
              FirstAvailable:
                backends:
```

**데이터 플레인에서 검증**, 클라이언트의 아웃바운드 프록시에 이 authority에
대한 HTTP 요청 카운터가 존재하지 않아야 합니다:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E '(request_total|tcp_open_total).*authority="playground-server-http'
```

```
tcp_open_total{direction="outbound",peer="dst",authority="playground-server-http.playground.svc.cluster.local:8080",target_addr="10.42.0.31:8080",target_ip="10.42.0.31",target_port="8080",tls="true",server_id="playground-server-http-primary.playground.serviceaccount.identity.linkerd.cluster.local",dst_control_plane_ns="linkerd",dst_deployment="playground-server-http-primary",dst_namespace="playground",dst_pod="playground-server-http-primary-8469756977-bc2p7",dst_pod_template_hash="8469756977",dst_service="playground-server-http",dst_serviceaccount="playground-server-http-primary",dst_zone="",dst_zone_locality="unknown"} 1
tcp_open_total{direction="outbound",peer="dst",authority="playground-server-http.playground.svc.cluster.local:8080",target_addr="10.42.1.34:8080",target_ip="10.42.1.34",target_port="8080",tls="true",server_id="playground-server-http-canary.playground.serviceaccount.identity.linkerd.cluster.local",dst_control_plane_ns="linkerd",dst_deployment="playground-server-http-canary",dst_namespace="playground",dst_pod="playground-server-http-canary-58f9b599f8-9mtxs",dst_pod_template_hash="58f9b599f8",dst_service="playground-server-http",dst_serviceaccount="playground-server-http-canary",dst_zone="",dst_zone_locality="unknown"} 1
```

가장 깔끔한 시그니처는 **이 authority에 대한 `request_total` 행이 전혀
존재하지 않는다**는 점입니다. 프록시는 HTTP 카운터를 멈춘 게 아니라,
이 목적지에 대해 HTTP 밸런서를 아예 인스턴스화하지 않았으므로 어떤
Prometheus 시리즈도 만들어지지 않은 것입니다. `tcp_open_total`만 남으며,
애플리케이션 측 HTTP/1 keepalive 덕분에 1로 유지됩니다.

**UI에서 보이는 것**:

- 상태 코드는 `200` 유지, 지연 시간은 정상.
- mTLS 배지가 **녹색을 유지** — 서버의 인바운드 프록시는 여전히 HTTP
  모드(파드 어노테이션 없음)이므로 `l5d-client-id`를 계속 주입하고,
  앱이 이를 `X-Mesh-Client-Id`로 노출합니다.

**보너스 체크: HTTPRoute 계층 정책도 우회됩니다.** 1 ms 타임아웃을 걸고
서버측에 2 s 지연을 추가합니다; 보통은 타임아웃이 발화해야 하지만
발화하지 않습니다 — HTTPRoute가 붙는 HTTP 스택을 아웃바운드 프록시가
실행하고 있지 않기 때문입니다:

```sh
kubectl apply -f - <<'EOF'
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: playground-server-http-timeout
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
      timeouts:
        request: 1ms
EOF

helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.5 --reuse-values \
  --set http.primary.env.LATENCY_MS=2000 \
  --set http.canary.env.LATENCY_MS=2000
```

2 s 서버에 대한 1 ms 타임아웃은 발화해야 합니다. opaque 아래에서는
발화하지 않으며, 요청은 여전히 2 s가 걸린 뒤 성공합니다.

케이스 2로 넘어가기 전에, 두 케이스를 독립적으로 유지하기 위해 변경을
되돌립니다:

```sh
kubectl -n playground annotate svc playground-server-http \
  config.linkerd.io/opaque-ports- --overwrite || true
kubectl -n playground delete httproute playground-server-http-timeout --ignore-not-found
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.5 --reuse-values \
  --set http.primary.env.LATENCY_MS=0 \
  --set http.canary.env.LATENCY_MS=0
kubectl -n playground rollout restart deploy/playground-client
```

### 2. Deployment의 opaque 포트

파드 템플릿에 어노테이션을 달면 **서버 자신의 인바운드 프록시**만
바뀝니다. proxy-injector가 admission 시점에 어노테이션을 읽고 사이드카에
`LINKERD2_PROXY_INBOUND_PORTS_DISABLE_PROTOCOL_DETECTION=8080`을
설정합니다. destination 컨트롤러는 관여하지 않으며, 아웃바운드 호출자는
그 포트가 opaque라는 것을 결코 알지 못합니다.

두 백엔드 모두에 어노테이션을 답니다. 각 파드의 인바운드 프록시는 자신의
어노테이션에 따라 독립적으로 결정하므로, 한쪽을 HTTP 모드로 두면
엔드포인트 사이에서 일관성 없는 동작이 발생합니다 — 절반의 요청은 여전히
서버측에서 HTTP로 파싱됩니다:

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.5 --reuse-values \
  --set-string 'http.primary.podAnnotations.config\.linkerd\.io/opaque-ports=8080' \
  --set-string 'http.canary.podAnnotations.config\.linkerd\.io/opaque-ports=8080'
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

**사이드카가 환경 변수를 받아들였는지 검증**:

```sh
POD=$(kubectl get -n playground  pod -l app=playground-server-http -o jsonpath='{.items[0].metadata.name}')
kubectl describe pod -n playground $POD \
  | grep DISABLE_PROTOCOL
# LINKERD2_PROXY_INBOUND_PORTS_DISABLE_PROTOCOL_DETECTION:   8080
```

**컨트롤 플레인은 여전히 `Detect`를 광고하고 있어야 함** — Service에는
어노테이션이 없으므로 아웃바운드 호출자는 영향받지 않아야 합니다:

```sh
linkerd diagnostics policy -n playground svc/playground-server-http 8080 \
  | head -20
```

```
metadata:
  Kind:
    Resource:
      group: core
      kind: Service
      name: playground-server-http
      namespace: playground
      port: 8080
protocol:
  Kind:
    Detect:
      http1:
        routes:
        - metadata:
            Kind:
              Default: http
          rules:
          - backends:
              Kind:
                FirstAvailable:
```

**데이터 플레인 검증** — 클라이언트 측은 여전히 HTTP를 파싱하지만,
서버 측은 더 이상 그렇지 않습니다:

```sh
# 클라이언트 아웃바운드는 여전히 HTTP 요청을 카운트:
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E 'request_total.*authority="playground-server-http'

# 서버 인바운드는 HTTP 카운터가 멈춤:
POD=$(kubectl get -n playground  pod -l app=playground-server-http -o jsonpath='{.items[0].metadata.name}')
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E 'request_total.*direction="inbound".*target_port="8080"'
```

클라이언트 측은 계속 올라가고, 서버 측은 어노테이션이 적용된 시점의
값에서 멈춥니다.

**UI에서 보이는 것**:

- 상태 코드는 `200` 유지, 지연 시간은 정상.
- mTLS 배지가 **`plain`으로 바뀜** — 서버의 인바운드 프록시가 더 이상
  `l5d-client-id`를 주입하지 않으므로, 응답의 `X-Mesh-Client-Id`가 비어
  있습니다. 이는 플레이그라운드 특유의 신호이며(앱이 헤더를 직접 노출),
  일반 워크로드라면 동등한 신호가 조용히 사라졌을 것입니다.
- 서버의 HTTP 계층에 붙은 인바운드 HTTPRoute나 AuthorizationPolicy는
  이 포트에서 조용히 무동작이 됩니다. 아웃바운드 HTTPRoute(흔한 경우,
  `parentRefs: Service`)는 **여전히 적용**됩니다 — Service에 어노테이션이
  없고 클라이언트의 아웃바운드 프록시는 여전히 HTTP 모드이기 때문입니다.

## 왜 이런 일이 일어나는가

각 프록시는 두 입력에서 HTTP 파싱 여부를 결정합니다:

1. **로컬 설정** — injector가 워크로드의 어노테이션(없으면 네임스페이스의
   어노테이션)을 읽어 사이드카에
   `LINKERD2_PROXY_INBOUND_PORTS_DISABLE_PROTOCOL_DETECTION`을 설정합니다
   ([linkerd/app/src/env.rs:192-193](../../buoyant/buoyant-proxy/linkerd/app/src/env.rs)).
   이것이 **인바운드** 프록시의 "이 포트가 opaque인가"에 대한 진실의
   원천입니다.
2. **디스커버리** — 아웃바운드 프록시가 destination 컨트롤러에 질의하고,
   컨트롤러는 각 Service 자신의 어노테이션(없으면 컨트롤러의
   `--default-opaque-ports` 플래그 폴백 — *네임스페이스가 아님*)을 읽어
   Service+포트별로 `protocol.Kind: Opaque` 또는 `Detect`를 게시합니다.

포트가 opaque일 때, 그 측의 프록시는:

- HTTP 프로토콜 감지를 건너뜁니다.
- 바이트를 종단간 TCP로 라우팅합니다.
- TCP 전용 메트릭만 발행합니다 — 그 목적지에 대한 HTTP `request_total`
  시리즈는 결코 만들어지지 않습니다.
- HTTPRoute와 HTTP 계층 AuthorizationPolicy를 우회합니다(이 CRD들은
  HTTP 트래픽에 붙기 때문).

mTLS 자체는 영향받지 않습니다 — HTTP 계층 아래에 있기 때문입니다.
프록시들은 여전히 연결 시점에 TLS를 협상하고, `tcp_open_total`에는
`tls="true"` 라벨이 그대로 남습니다. 다만 HTTP 계층 배관에 의존하는
모든 것(라우트, 재시도, `l5d-client-id` 헤더, 라우트별 메트릭)은
opaque로 바뀐 쪽에서는 사라집니다. 한쪽만 바뀌었다면, 그쪽의 HTTP
배관은 사라지고 다른 쪽은 여전히 동작합니다 — 가장 흔한 디버깅 함정이
바로 이것입니다.

destination 컨트롤러의 정책 업데이트는 거의 실시간으로 아웃바운드
프록시에 푸시되지만, **기존 연결은 처음 결정한 프로토콜을 유지합니다** —
프록시는 살아 있는 HTTP/2 채널을 다시 결정하기 위해 끊지 않습니다.
호출자에 `kubectl rollout restart`를 하면 새로운 정책 아래에서 새 연결이
강제됩니다.

## 진단

```sh
# 1. 이 포트에 대해 destination 컨트롤러가 어떤 프로토콜을 광고하고 있나?
#    가장 빠르고 권위 있는 체크.
linkerd diagnostics policy -n playground svc/playground-server-http 8080 \
  | head -20
# `protocol.Kind: Detect: { http1, http2 }` = HTTP 경로, 정상.
# `protocol.Kind: Opaque: { ... }`           = 그 포트가 opaque로 표시됨.

# 2. "opaque"는 어디서 왔는가 — 파드, Service, 네임스페이스?
kubectl -n playground get pod -l app=playground-server-http \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.annotations.config\.linkerd\.io/opaque-ports}{"\n"}{end}'
kubectl -n playground get svc playground-server-http \
  -o jsonpath='{.metadata.annotations.config\.linkerd\.io/opaque-ports}{"\n"}'
kubectl get ns playground \
  -o jsonpath='{.metadata.annotations.config\.linkerd\.io/opaque-ports}{"\n"}'

# 3. 서버의 인바운드 프록시가 실제로 어떤 포트를 opaque로 다루고 있는가?
kubectl -n playground exec deploy/playground-server-http-primary -c linkerd-proxy -- env \
  | grep -E 'OPAQUE|DISABLE_PROTOCOL'

# 4. 데이터 플레인 확인: 클라이언트의 아웃바운드 프록시에 이 authority에 대한
#    `request_total` 시리즈가 없다.
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E '(request_total|tcp_open_total).*authority="playground-server-http'
# tcp_open_total만 = opaque. request_total도 함께 = 여전히 HTTP.

# 5. HTTPRoute 강제 여부. 빠듯한 타임아웃을 적용해 본다(위). 타임아웃을 넘는 지연
# 에서도 요청이 성공하면 HTTP 정책이 우회되고 있는 것이다.
```

## 수정

어노테이션을 떼고 롤아웃:

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.5 --reset-values
kubectl -n playground annotate svc playground-server-http \
  config.linkerd.io/opaque-ports- --overwrite || true
kubectl -n playground rollout restart \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
kubectl -n playground delete httproute playground-server-http-timeout --ignore-not-found
```

opaque 포트가 *맞는* 답일 때: 서버가 먼저 말하는 프로토콜
(MySQL `3306`, Postgres `5432`, Redis `6379`, SMTP `25`). HTTP/1, HTTP/2,
gRPC 포트는 **결코** opaque로 표시해서는 안 됩니다.

## 되돌리기

(수정과 동일.)
