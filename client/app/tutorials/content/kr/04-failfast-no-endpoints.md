# 04 — `504` failfast: 준비된 엔드포인트 없음

전형적인 "0개로 스케일 다운" 데모입니다. 목적지 Service에 준비된
엔드포인트가 0개일 때, 아웃바운드 로드 밸런서는 **failfast** 상태로
들어갑니다. 요청은 무한정 버퍼링되는 대신 즉시 `504`로 실패합니다.

이는 현장에서 가장 자주 오진단되는 Linkerd 오류입니다. 타임아웃처럼
보이지만, 프록시는 서버를 기다리는 게 아니라 — 엔드포인트가 *존재*하기를
기다리는 것입니다. 이 런북이 그 정식 예시입니다.

> 이 오류는 클라이언트와 서버 프록시 사이의 TLS 연결이
> `config.linkerd.io/proxy-outbound-connect-timeout` 시간 안에
> 수립되지 못하게 하는 네트워크 문제로도 발생할 수 있습니다(기본 1000 ms).

## 설치

[00-setup.md](00-setup.md)을 따라 새 클러스터, Linkerd Enterprise,
플레이그라운드 앱을 준비합니다. 진행하기 전에 UI에 녹색 `200`과 `mTLS`
배지가 보여야 합니다.

## 증상

- 클라이언트 UI: 모든 폴링이 ~3초 내에 빨간 `504`로 바뀝니다.
- 지연 시간이 평탄한 ~3000 ms로 떨어집니다 — 프록시가 서버를 실제로
  기다리는 게 아니라 단락(short-circuit)시키고 있기 때문입니다.
- "mTLS" 배지는 빨강/공백으로 유지됩니다(감쌀 응답이 없음). 다만 중요한
  것은 토폴로지 배너가 빨개진다는 점입니다 — 프록시가 호출을 실패시키고
  있다는 뜻입니다.

## 재현

primary와 canary 디플로이먼트를 **모두** 0으로 스케일합니다 — canary를
남겨 두면 kube-proxy가 그쪽으로 계속 라우팅해 성공시키게 됩니다.

```sh
kubectl -n playground scale \
  deploy/playground-server-http-primary deploy/playground-server-http-canary \
  --replicas=0
```

수 초 안에 UI의 모든 폴링이 `504`가 됩니다.

## 무엇이 보일까

클라이언트 측 아웃바운드 프록시 로그:

```sh
kubectl -n playground logs deploy/playground-client -c linkerd-proxy --tail=20
```

```
[    49.103125s]  INFO ThreadId(01) outbound:proxy{addr=10.43.38.167:8080}:service{ns=playground name=playground-server-http port=8080}: linkerd_proxy_balance_queue::worker: Unavailable; entering failfast timeout=3.0
[    49.103159s]  INFO ThreadId(01) outbound:proxy{addr=10.43.38.167:8080}:service{ns=playground name=playground-server-http port=8080}: linkerd_proxy_balance_queue::worker: Unavailable; entering failfast timeout=3.0
[    49.103164s]  INFO ThreadId(01) outbound:proxy{addr=10.43.38.167:8080}:service{ns=playground name=playground-server-http port=8080}: linkerd_proxy_balance_queue::worker: Unavailable; entering failfast timeout=3.0
[    49.103167s]  INFO ThreadId(01) outbound:proxy{addr=10.43.38.167:8080}:service{ns=playground name=playground-server-http port=8080}: linkerd_proxy_balance_queue::worker: Unavailable; entering failfast timeout=3.0
[    49.103266s]  INFO ThreadId(01) outbound:proxy{addr=10.43.38.167:8080}:rescue{client.addr=10.42.1.21:37866}: linkerd_app_core::errors::respond: HTTP/1.1 request failed error=logical service 10.43.38.167:8080: route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast error.sources=[route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast, backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast, Service.playground.playground-server-http:8080: service in fail-fast, service in fail-fast]
```

메시 클라이언트 안에서 직접 curl을 던지면 응답 헤더로 확인할 수 있습니다.

```sh
POD=$(kubectl get pod -n playground -l app=playground-client \
        -o jsonpath='{.items[0].metadata.name}')

kubectl debug -n playground "$POD" \
  --image=nicolaka/netshoot --profile=general --quiet -i -- \
  curl -sv -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< l5d'
```

```
< HTTP/1.1 504 Gateway Timeout
< l5d-proxy-error: logical service 10.43.38.167:8080: route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast
< l5d-proxy-connection: close
```

프록시 메트릭:

```sh
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E 'failfast|endpoints'
```

```
outbound_http_balancer_endpoints{endpoint_state="ready",parent_group="core",parent_kind="Service",parent_namespace="playground",parent_name="playground-server-http",parent_port="8080",parent_section_name="",backend_group="core",backend_kind="Service",backend_namespace="playground",backend_name="playground-server-http",backend_port="8080",backend_section_name=""} 0
outbound_http_balancer_endpoints{endpoint_state="pending",parent_group="core",parent_kind="Service",parent_namespace="playground",parent_name="playground-server-http",parent_port="8080",parent_section_name="",backend_group="core",backend_kind="Service",backend_namespace="playground",backend_name="playground-server-http",backend_port="8080",backend_section_name=""} 0
outbound_http_errors_total{error="failfast"} 7
```

목적지 컨트롤러 시점의 엔드포인트 멤버십:

```sh
linkerd diagnostics endpoints playground-server-http.playground.svc.cluster.local:8080
```

```
No endpoints found.
```

## 왜 이런 일이 일어나는가

아웃바운드 로드 밸런서는 각 목적지를 failfast 타임아웃이 있는 큐로
감쌉니다.

> 밸런서 내부에 사용 가능한 서비스가 없으면 "failfast" 상태로 들어가며,
> 이후의 요청은 무한정 버퍼링되는 대신 즉시 실패합니다.

기본 아웃바운드 HTTP failfast 타임아웃은 프록시의
`DEFAULT_OUTBOUND_HTTP_FAILFAST_TIMEOUT` 상수에 의해 **3초**로 설정됩니다.
엔드포인트가 0개인 채 3초가 지나면 큐가 failfast로 진입하고 이후 모든
요청에 대해 `FailFastError`를 발생시키며, rescue 핸들러가 이를
`gateway_timeout`을 통해 합성 504로 변환합니다.

## 진단

```sh
# 1. 서비스가 비었는가?
linkerd diagnostics endpoints playground-server-http.playground.svc.cluster.local:8080
# 깨졌을 때 예상: 행 없음.

# 2. 준비된 파드가 하나라도 있는가?
kubectl -n playground get pods -l app=playground-server-http
# READY=0/2 또는 행 없음.

# 3. failfast인지(진짜 타임아웃이 아닌지) 확인:
kubectl -n playground exec deploy/playground-client -c linkerd-proxy -- \
  curl -s http://localhost:4191/metrics \
  | grep -E 'failfast|endpoints'
# in_failfast=1, endpoints=0.

# 4. 504 지속 시간이 ~3000ms(failfast 기본값)이며 서버 지연의 배수가 아니다.
# 그것이 진짜 타임아웃과 구별되는 단서다.
```

## 수정

다시 스케일 업:

```sh
kubectl -n playground scale \
  deploy/playground-server-http-primary deploy/playground-server-http-canary \
  --replicas=1
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

프록시는 약 1초 안에 새 엔드포인트를 알아채고, 다음 요청에서 밸런서가
failfast를 빠져나옵니다.

## 되돌리기

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.7 --reset-values
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```
