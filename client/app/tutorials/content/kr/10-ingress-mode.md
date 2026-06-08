# 10 - 메시에 포함된 ingress가 Linkerd 라우팅을 우회함 (ingress mode & `service-upstream`)

Linkerd는 자체 ingress 컨트롤러를 제공하지 않습니다. 대신 이미
운영 중인 컨트롤러(ingress-nginx, Traefik, Kong 등)에 다른 워크로드와
마찬가지로 `linkerd-proxy` 사이드카를 주입해서 메시에 포함시킵니다.
함정은 **ingress 컨트롤러가 백엔드에 도달하는 방식**에 있습니다.

대부분의 컨트롤러는 *직접* 엔드포인트를 선택합니다. 대상 Service의
`Endpoints`를 감시하다가 Pod 하나를 고른 뒤, **그 Pod의 IP로 직접**
연결을 엽니다. 절대 Service의 ClusterIP로 연결하지 않습니다. 메시에
포함된 컨트롤러의 outbound 프록시가 Pod IP를 향한 연결을 보면, 그것을
고정된 단일 엔드포인트로 취급하고 곧장 그쪽으로 전달합니다. 그 결과
**Service**에 연결되는 모든 것이 조용히 건너뛰어집니다:

- `HTTPRoute`, 그리고 그 weight, timeout, retry, 헤더 필터.
- `ServiceProfile`.
- 트래픽 분할(traffic split) / 카나리 가중치.
- Linkerd 자체의 엔드포인트 집합에 대한 로드 밸런싱.

mTLS는 여전히 동작합니다. mTLS는 L7 아래 계층에 있고, destination
컨트롤러는 Pod IP를 워크로드 identity에 매핑할 수 있기 때문입니다.
그래서 이 장애는 눈에 보이지 않습니다. `200` 응답, 초록색 배지, 정상
지연 시간이 그대로 유지되는데 카나리 `HTTPRoute`만 **아무 일도 하지
않습니다.**

해결 방법은 두 가지이며, 어느 쪽을 쓰는지는 컨트롤러에 따라
달라집니다:

- **컨트롤러가 ClusterIP를 향하도록 합니다.** ingress-nginx는
  `nginx.ingress.kubernetes.io/service-upstream: "true"` 어노테이션으로
  이를 지원합니다. 그러면 프록시가 ClusterIP를 보고 논리적 Service를
  resolve해서 모든 정책을 적용합니다. 컨트롤러는 **일반 방식으로**
  주입합니다(`linkerd.io/inject: enabled`).
- **Ingress mode**(`linkerd.io/inject: ingress`). ClusterIP를 향하게
  만들 수 없는 컨트롤러(Traefik, Kong, Contour, Gloo, HAProxy, GCE,
  EnRoute)의 경우, 프록시가 원래 목적지 IP를 무시하고 대신
  `l5d-dst-override` 헤더를 기준으로 라우팅합니다(없으면 원래 목적지로).
  그래서 Pod IP를 향한 연결이라도 논리적 Service로 다시
  resolve됩니다. 이 헤더는 컨트롤러별 메커니즘(Traefik `Middleware`,
  nginx snippet 등)으로 설정하며, ingress를 open relay로 만들지 않도록
  **클라이언트가 보낸 `l5d-dst-override`를 반드시 제거해야 합니다.**

이 runbook은 ingress-nginx로 우회 현상을 재현한 뒤 `service-upstream`으로
고치고, 이어서 Traefik으로 같은 일을 ingress mode를 써서 합니다. 차트가
배포하는 두 서버 버전(`playground-server-http-primary`의 v1,
`playground-server-http-canary`의 v2)을 apex `playground-server-http`
Service 뒤에서 그대로 재사용합니다.

## Setup

[00-setup.md](00-setup.md)를 따라 새 클러스터, Linkerd Enterprise,
playground 앱을 준비하세요. 진행하기 전에 UI에서 `mTLS` 배지와 함께
초록색 `200` 응답이 보여야 합니다. 00-setup은 k3d 내장 Traefik을 이미
비활성화하므로(`--disable=traefik`), 여기서 설치하는 컨트롤러를 위해
호스트의 `:80`/`:443`이 비어 있습니다.

`playground-server-http`(포트 8080)를 ingress 컨트롤러를 통해
노출합니다. 모든 경우에 카나리(v2)로 트래픽을 **100 %** 고정하는
**동일한** `HTTPRoute`를 적용하며, 그것이 ingress를 통해 실제로
적용되는지가 테스트입니다. 지금 적용하세요. apex Service에 연결되며
이후 내내 재사용하는 probe입니다:

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
kubectl -n playground get httproute
```

**메시 내부에서** 정상성을 확인합니다. 메시 내부 클라이언트는 route를
준수하므로 대시보드는 **v2만** 표시하도록 수렴합니다:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl -n playground debug "$POD" \
  --image=curlimages/curl --profile=general --quiet -i -- \
  sh -c 'for i in $(seq 1 20); do
    curl -s -D - -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ \
      | grep -i x-app-version
  done | sort | uniq -c'
# 20 x-app-version: v2
```

이것이 기준선입니다. **Service**로 연결하는 클라이언트는 HTTPRoute를
적용받습니다. 이제 ingress 컨트롤러가 **Pod**로 연결할 때 무슨 일이
벌어지는지 보겠습니다.

## Symptom

- ingress를 통한 요청은 `200`을 반환하고 지연 시간도 정상이며 mTLS도
  그대로입니다.
- 카나리 `HTTPRoute`는 `weight: 100 → v2`라고 적혀 있는데도, ingress를
  통한 버전 스트림은 **v1과 v2를 모두**(~50/50) 계속 보여줍니다. route가
  무시되고 있습니다.
- Service에 연결된 `ServiceProfile`, timeout, retry 역시 ingress
  트래픽에 대해서는 동작하지 않습니다.
- 메시 내부 직접 호출(위)은 route를 **준수합니다.** ingress를 통한
  경로만 망가져 있습니다. **이 비대칭이 결정적인 단서입니다.**

## 메시 ingress를 통합하는 두 가지 방법

| 전략 | 컨트롤러가 백엔드에 도달하는 방식 | Inject mode | Service 라우팅이 동작하는 이유 |
|---|---|---|---|
| **`service-upstream`** (ingress-nginx) | Service **ClusterIP**로 연결 | `enabled` (일반) | 프록시가 ClusterIP → 논리적 Service를 resolve → `HTTPRoute` / `ServiceProfile` / split을 적용하고 엔드포인트를 직접 로드 밸런싱 |
| **Ingress mode** (Traefik, Kong, Contour, Gloo, HAProxy, GCE, EnRoute) | **Pod IP**로 연결하되 `l5d-dst-override`를 설정 | `ingress` | 프록시가 dst IP를 무시하고 대신 헤더에서 논리적 Service를 resolve |

이후로는 전략별로 컨트롤러를 하나씩 다룹니다.

## Recreate

### 1. ingress-nginx: 함정, 그리고 `service-upstream`

ingress-nginx를 **Pod** 수준에서 메시에 포함시켜 설치합니다:

```sh
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set-string 'controller.podAnnotations.linkerd\.io/inject=enabled' \
  --set controller.replicaCount=1
kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller
```

> **네임스페이스가 아니라 Pod에 어노테이션을 답니다.** ingress-nginx는
> 수명이 짧은 admission `Job`(`ingress-nginx-admission-create` /
> `-patch`)을 실행합니다. 네임스페이스 수준의 `linkerd.io/inject`
> 어노테이션은 이 Job들까지 메시에 포함시키는데, 그러면 사이드카가
> 종료되지 않아 Job이 영원히 끝나지 않습니다. 컨트롤러 Deployment에
> Pod 수준으로 어노테이션을 달면 이를 피할 수 있습니다.

컨트롤러가 메시에 포함됐는지 확인합니다(`2/2`, nginx + `linkerd-proxy`):

```sh
kubectl -n ingress-nginx get pod -l app.kubernetes.io/component=controller
```

```
NAME                                        READY   STATUS    RESTARTS   AGE
ingress-nginx-controller-7c6f5d9b8c-h4n2t   2/2     Running   0          25s
```

Ingress를 생성합니다. 아직 `service-upstream` 어노테이션이 **없다는**
점에 유의하세요:

```sh
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: playground
  namespace: playground
spec:
  ingressClassName: nginx
  rules:
    - host: playground.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: playground-server-http
                port:
                  number: 8080
EOF
```

ingress를 통해 20개의 요청을 샘플링합니다. 컨트롤러를 port-forward해서
외부 트래픽을 흉내냅니다:

```sh
# 터미널 1: 그대로 실행 상태로 둡니다.
kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8080:80
```

```sh
# 터미널 2.
for i in $(seq 1 20); do
  curl -s -H 'Host: playground.example.com' -D - -o /dev/null http://localhost:8080/ \
    | grep -i x-app-version
done | sort | uniq -c
```

```
  11 x-app-version: v1
   9 x-app-version: v2
```

HTTPRoute는 100 %를 v2로 고정하는데도 거의 반반으로 나뉩니다. 이
분배는 apex Service의 두 엔드포인트에 대한 **nginx 자체의**
라운드로빈입니다. Linkerd는 Service를 본 적이 없으므로 route도 발동하지
않았습니다.

route는 정상이고 accept된 상태입니다. 문제는 설정이 아니라 라우팅에
있습니다:

```sh
linkerd diagnostics policy -n playground svc/playground-server-http 8080 | head -25
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
              Resource:
                group: gateway.networking.k8s.io
                kind: HTTPRoute
                name: playground-server-canary
```

**와이어 레벨 확인**: 컨트롤러의 outbound 프록시에서 HTTP 요청은 Service의
`playground-server-canary` HTTPRoute가 아니라 합성 `endpoint` route(Pod IP
직접 전달)로 집계됩니다. 즉 route가 실행되지 않았습니다:

```sh
linkerd diagnostics proxy-metrics -n ingress-nginx deploy/ingress-nginx-controller \
  | grep '^outbound_http_route_backend_requests_total' \
  | sed -E 's/.*route_name="([^"]*)".*backend_name="([^"]*)".*\} ([0-9]+)/route=\1 backend=\2 reqs=\3/'
```

```
route=endpoint backend=unknown reqs=20
```

`tcp_open_total`은 여기서 유용한 신호가 아닙니다. 프록시는 route 적용
여부와 무관하게 모든 엔드포인트로 TCP 연결을 유지하므로 두 경우 모두
양쪽 Pod를 보여줍니다. 라우팅 결정은 위 메트릭처럼 HTTP 계층에서만
드러납니다.

**이제 해결책을 적용합니다.** nginx가 엔드포인트 대신 ClusterIP로
연결하도록 `service-upstream` 어노테이션을 추가합니다:

```sh
kubectl -n playground annotate ingress playground \
  nginx.ingress.kubernetes.io/service-upstream=true --overwrite
```

다시 샘플링합니다(재시작 불필요, nginx는 1~2초 안에 upstream을
리로드합니다):

```sh
for i in $(seq 1 20); do
  curl -s -H 'Host: playground.example.com' -D - -o /dev/null http://localhost:8080/ \
    | grep -i x-app-version
done | sort | uniq -c
```

```
  20 x-app-version: v2
```

이제 nginx가 프록시에 ClusterIP를 넘겨줍니다. 프록시는
`playground-server-http`를 resolve하고 HTTPRoute를 적용해 100 %를
카나리로 보냅니다. 와이어 레벨 관점도 일치합니다. 이제 요청이
`playground-server-canary` route를 거쳐 canary 백엔드로 100 %, primary로
0 흐릅니다:

```sh
linkerd diagnostics proxy-metrics -n ingress-nginx deploy/ingress-nginx-controller \
  | grep '^outbound_http_route_backend_requests_total' \
  | sed -E 's/.*route_name="([^"]*)".*backend_name="([^"]*)".*\} ([0-9]+)/route=\1 backend=\2 reqs=\3/'
```

```
route=playground-server-canary backend=playground-server-http-canary reqs=20
route=playground-server-canary backend=playground-server-http-primary reqs=0
```

이 카운터는 누적값이므로, bypass 단계까지 처리한 프록시에는 이전
`route=endpoint` 줄도 남아 있습니다. 깨끗한 값을 보려면 컨트롤러를
재시작하세요. 핵심 신호는 `route_name`이 `endpoint`에서
`playground-server-canary`로 바뀐다는 점입니다.

두 케이스를 독립적으로 유지하기 위해 케이스 2로 넘어가기 전에
정리합니다:

```sh
kubectl -n playground delete ingress playground --ignore-not-found
helm uninstall ingress-nginx -n ingress-nginx
kubectl delete ns ingress-nginx --ignore-not-found
```

### 2. Traefik: ingress mode

Traefik도 기본적으로 Pod IP로 로드 밸런싱하며 표준 Kubernetes 경로에는
`service-upstream`에 해당하는 옵션이 없습니다. 그래서 ingress mode의
교과서적인 컨트롤러입니다. `enabled`가 아니라
`linkerd.io/inject: **ingress**`로 메시에 포함시켜 설치합니다. 이번에도
Pod 수준입니다:

```sh
helm repo add traefik https://traefik.github.io/charts
helm repo update
helm install traefik traefik/traefik \
  --namespace traefik --create-namespace \
  --set-string 'deployment.podAnnotations.linkerd\.io/inject=ingress'
kubectl -n traefik rollout status deploy/traefik
```

프록시가 **ingress mode**로 떴는지 확인합니다. 어노테이션이 `enabled`가
아니라 `ingress`이면 injector가 전용 env 변수를 설정합니다. 프록시 이미지는
distroless라서(셸이나 `env` 바이너리가 없음) `exec` 대신 Pod 스펙에서 이
변수를 읽습니다:

```sh
kubectl -n traefik get pod -l app.kubernetes.io/name=traefik \
  -o jsonpath='{range .items[0].spec.containers[?(@.name=="linkerd-proxy")].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -i ingress
# LINKERD2_PROXY_INGRESS_MODE=true
```

먼저 헤더 **없이** 백엔드로 라우팅해서, ingress mode만으로는 충분하지
않다는 것을 보입니다. 프록시는 논리적 Service를 알기 위해
`l5d-dst-override`가 여전히 필요합니다:

```sh
kubectl apply -f - <<'EOF'
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: playground
  namespace: playground
spec:
  entryPoints:
    - web
  routes:
    - match: Host(`playground.example.com`)
      kind: Rule
      services:
        - name: playground-server-http
          port: 8080
EOF
```

```sh
# 터미널 1.
kubectl -n traefik port-forward svc/traefik 8080:80
```

```sh
# 터미널 2.
for i in $(seq 1 20); do
  curl -s -H 'Host: playground.example.com' -D - -o /dev/null http://localhost:8080/ \
    | grep -i x-app-version
done | sort | uniq -c
```

```
  10 x-app-version: v1
  10 x-app-version: v2
```

같은 우회입니다. Traefik이 Pod IP로 연결했고, 프록시는 기준으로 삼을
`l5d-dst-override`가 없었으며, HTTPRoute는 건너뛰어졌습니다.

이제 `l5d-dst-override`를 Service FQDN으로 설정하는 `Middleware`를
추가하고 route에 연결합니다. `customRequestHeaders`는 헤더를
**덮어쓰기** 때문에, 클라이언트가 주입하려던 값도 함께 제거되어 이
route의 open relay 구멍이 막힙니다:

```sh
kubectl apply -f - <<'EOF'
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: l5d-dst-override
  namespace: playground
spec:
  headers:
    customRequestHeaders:
      l5d-dst-override: "playground-server-http.playground.svc.cluster.local:8080"
---
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: playground
  namespace: playground
spec:
  entryPoints:
    - web
  routes:
    - match: Host(`playground.example.com`)
      kind: Rule
      services:
        - name: playground-server-http
          port: 8080
      middlewares:
        - name: l5d-dst-override
EOF
```

다시 샘플링합니다:

```sh
for i in $(seq 1 20); do
  curl -s -H 'Host: playground.example.com' -D - -o /dev/null http://localhost:8080/ \
    | grep -i x-app-version
done | sort | uniq -c
```

```
  20 x-app-version: v2
```

프록시는 Traefik이 연결한 Pod IP를 무시하고 `l5d-dst-override`를 읽어
논리적 Service로 다시 resolve한 뒤 HTTPRoute를 적용해 100 %를 카나리로
보냈습니다.

> **Traefik CRD 그룹.** Traefik v3(및 최근 v2)는 위에서 보인
> `traefik.io/v1alpha1` API 그룹을 사용합니다. 구버전 Traefik v2는
> `traefik.containo.us/v1alpha1`을 썼습니다. `Middleware` /
> `IngressRoute`의 형태는 같고 `apiVersion`만 다릅니다.

## Why this happens

outbound 프록시는 연결을 어디로 보낼지를 **원래 목적지 주소(original
destination address)**로부터 결정하며, 이를 destination 컨트롤러에
질의합니다:

- **ClusterIP**(또는 ClusterIP로 resolve되는 이름) → 컨트롤러는
  **논리적 Service**를 반환합니다. 엔드포인트 집합(프록시가 로드
  밸런싱할 대상), `HTTPRoute`, `ServiceProfile`, traffic split, retry가
  여기에 포함됩니다. 프록시는 완전한 L7 스택을 실행합니다.
- **Pod IP** → 컨트롤러는 그 **단일 엔드포인트**를 반환합니다. 밸런싱할
  대상도 없고 적용할 Service 연결 정책도 없습니다. 프록시는 그 Pod
  하나로 전달합니다.

ingress 컨트롤러는 기본적으로 두 번째 경로를 택합니다. Service를 직접
`Endpoints`로 resolve해서 Pod IP로 연결합니다. 그래서 메시에 포함된
컨트롤러는 기본 상태에서 단순 엔드포인트 전달로 떨어지며 모든 Service
수준 기능을 건너뜁니다. mTLS와 `200`은 영향이 없으므로 조용히
일어납니다.

두 해결책은 같은 연결의 서로 다른 끝을 공략합니다:

- **`service-upstream`**은 **컨트롤러**를 바꿉니다. ClusterIP로
  연결하게 만들면 위의 첫 번째 항목이 다시 적용됩니다. 일반 주입이며
  프록시 쪽에는 특별한 설정이 없습니다.
- **Ingress mode**는 **프록시**를 바꿉니다. 원래 dst IP를 무시하고
  대신 `l5d-dst-override` 헤더에서 논리적 Service를 resolve합니다(해당
  헤더가 없으면 원래 목적지). 컨트롤러는 계속 Pod IP로 연결해도 되고,
  프록시가 어쨌든 Service로 다시 resolve합니다.

**보안.** ingress mode에서 프록시는 `l5d-dst-override`가 가리키는
곳이면 어디든 라우팅합니다. 외부 클라이언트가 이 헤더를 설정할 수
있다면, ingress가 **클러스터 내부(또는 외부)의 어떤 주소로든** 중계하게
만들 수 있습니다. SSRF급 open relay입니다. 들어오는 길목에서
`l5d-dst-override`를 항상 덮어쓰거나 제거하세요. Traefik의
`customRequestHeaders`는 (덮어쓰므로) 이를 공짜로 해주지만, **모든**
route가 그렇게 해야 합니다. ingress mode를 다른 워크로드는 일반적으로
메시에 포함되어야 하는 네임스페이스 전체가 아니라 컨트롤러 **Pod**에만
두어야 하는 이유이기도 합니다.

## Diagnose

```sh
# 1. 컨트롤러가 메시에 포함됐는가, 그리고 어떤 모드인가?
kubectl -n ingress-nginx get pod -l app.kubernetes.io/component=controller   # READY 2/2
kubectl -n traefik       get pod -l app.kubernetes.io/name=traefik           # READY 2/2
# ingress mode는 프록시에 이 env를 설정합니다. "enabled"는 설정하지 않습니다.
# 프록시는 distroless라서(`env` 바이너리 없음) Pod 스펙에서 읽습니다:
kubectl -n traefik get pod -l app.kubernetes.io/name=traefik \
  -o jsonpath='{range .items[0].spec.containers[?(@.name=="linkerd-proxy")].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -i ingress
# LINKERD2_PROXY_INGRESS_MODE=true

# 2. 동작 기반 probe (명확한 테스트): 카나리 HTTPRoute가 *ingress를 통해*
#    적용되는가?
for i in $(seq 1 20); do
  curl -s -H 'Host: playground.example.com' -D - -o /dev/null http://localhost:8080/ \
    | grep -i x-app-version
done | sort | uniq -c
# v1과 v2 둘 다 -> Service 라우팅 우회됨
# v2만         -> Service 라우팅이 적용됨

# 3. route는 존재하고 destination 컨트롤러가 이를 인식한 상태, 즉 문제는
#    설정이 아니라 라우팅이다. (Service를 parent로 둔 HTTPRoute에는 status가
#    기록되지 않으므로, 프록시가 실제로 받는 policy를 확인한다.)
kubectl -n playground get httproute playground-server-canary
linkerd diagnostics policy -n playground svc/playground-server-http 8080 | head -25

# 4. HTTP 계층에서 어떤 route가 요청을 처리했는가? (ns/deploy를 바꿔가며.)
#    tcp_open_total은 도움이 안 된다: 프록시는 어느 경우든 모든 엔드포인트로
#    연결을 유지한다. route 집계가 신호다.
linkerd diagnostics proxy-metrics -n ingress-nginx deploy/ingress-nginx-controller \
  | grep '^outbound_http_route_backend_requests_total' \
  | sed -E 's/.*route_name="([^"]*)".*backend_name="([^"]*)".*\} ([0-9]+)/route=\1 backend=\2 reqs=\3/'
# route=endpoint ...                 = Pod IP 직접 전달 (우회됨)
# route=playground-server-canary ... = Service HTTPRoute 적용됨 (해결됨)

# 5. ingress-nginx 한정: Ingress에 service-upstream이 설정돼 있는가?
kubectl -n playground get ingress playground \
  -o jsonpath='{.metadata.annotations.nginx\.ingress\.kubernetes\.io/service-upstream}{"\n"}'
# (비어 있음) = 우회;  true = 해결됨
```

## Fix

- **ingress-nginx (및 ClusterIP 옵션이 있는 컨트롤러):** 일반 주입
  (`linkerd.io/inject: enabled`)을 유지하고 Ingress에
  `nginx.ingress.kubernetes.io/service-upstream: "true"`를 추가해
  컨트롤러가 ClusterIP로 연결하게 합니다.

  ```sh
  kubectl -n playground annotate ingress playground \
    nginx.ingress.kubernetes.io/service-upstream=true --overwrite
  ```

- **Traefik / Kong / Contour / Gloo / HAProxy / GCE / EnRoute:**
  컨트롤러를 **ingress mode**(`linkerd.io/inject: ingress`, Pod 수준)로
  메시에 포함시키고, 모든 route에
  `l5d-dst-override: <svc>.<ns>.svc.cluster.local:<port>`를 설정합니다
  (덮어쓰므로 들어오는 값도 함께 제거).

- 동작 기반 probe를 다시 실행합니다. ingress를 통한 카나리 `HTTPRoute`가
  이제 **v2만**으로 resolve되어야 합니다.

핵심 원칙: HTTP/gRPC ingress는 백엔드에 **Service를 거쳐** 도달해야
합니다. ClusterIP로 연결하거나(`service-upstream`),
`l5d-dst-override`에 Service를 명시하거나(ingress mode) 둘 중
하나입니다. 단순 Pod IP 전달이 바로 Linkerd의 L7 기능을 벗겨내는
원인입니다.

## Revert

```sh
kubectl -n playground delete ingress playground --ignore-not-found
kubectl -n playground delete ingressroute playground --ignore-not-found
kubectl -n playground delete middleware l5d-dst-override --ignore-not-found
kubectl -n playground delete httproute playground-server-canary --ignore-not-found

helm uninstall ingress-nginx -n ingress-nginx 2>/dev/null || true
helm uninstall traefik -n traefik 2>/dev/null || true
kubectl delete ns ingress-nginx traefik --ignore-not-found
```
