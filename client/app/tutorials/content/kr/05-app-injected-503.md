# 05 - 앱이 주입한 `503` (메시 문제가 아님)

메시 디버깅에서 가장 흔한 거짓 양성은 **애플리케이션**이 발생시킨 503을 메시 문제로 오해하는 것입니다. 이 런북은 진단의 기준선으로, 앱 오류와 프록시가 합성한 오류를 구분하는 법을 익히면 이후 모든 런북의 참조점이 됩니다.

## 설치

[00-setup.md](00-setup.md)을 따라 새 클러스터, Linkerd Enterprise, 플레이그라운드 앱을 준비합니다. UI에 녹색 `200`과 `mTLS` 배지가 보여야 진행할 수 있습니다.

## 증상

- 클라이언트 UI: 빨간 `503` 상태 칩의 행렬, `mTLS` 배지는 녹색 유지.
- 성공률이 대략 `100 − ERROR_RATE`%로 떨어집니다.
- 각 행의 "Body" 컬럼에 `injected error 503`이 표시됩니다.

## 재현

primary와 canary **양쪽** 백엔드 모두에서 응답을 100% 503으로 설정합니다. 한쪽만 바꾸면 kube-proxy가 절반의 요청을 정상 canary로 보냅니다.

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0 --reuse-values \
  --set http.primary.env.ERROR_RATE=100 \
  --set http.primary.env.ERROR_CODE=503 \
  --set http.canary.env.ERROR_RATE=100 \
  --set http.canary.env.ERROR_CODE=503
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

## 무엇이 보일까

서버 애플리케이션 로그, 503이 의도된 이벤트로 나타나는 **유일한** 장소:

```sh
kubectl -n playground logs deploy/playground-server-http-primary -c server --tail=20
```

```
2026/05/14 04:53:33 503 Service Unavailable, request 1, version=v1, latency 0ms, client-id="playground-client.playground.serviceaccount.identity.linkerd.cluster.local"
2026/05/14 04:53:34 503 Service Unavailable, request 2, version=v1, latency 0ms, client-id="playground-client.playground.serviceaccount.identity.linkerd.cluster.local"
```

`client-id="playground-client.playground..."`는 mTLS가 정상 동작 중임을 보여줍니다. 프록시가 요청을 가로채 검증된 호출자 ID를 전달한 것으로, 메시 문제가 아님을 나타내는 단서입니다.

서버 측 프록시 로그, 특이 사항 없음:

```sh
kubectl -n playground logs deploy/playground-server-http-primary -c linkerd-proxy --tail=20
```

프록시는 투명하게 동작합니다. 요청을 받아 앱에 전달하고 응답을 중계했을 뿐, `l5d-proxy-error`는 추가하지 않았습니다.

메시 클라이언트 파드를 통해 서버를 직접 확인:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl -n playground debug "$POD" --image=curlimages/curl --profile=general --quiet -i -- \
  curl -sv http://playground-server-http.playground.svc.cluster.local:8080/ 2>&1 | tail -15
```

```
> Accept: */*
* Request completely sent off
injected error 503
< HTTP/1.1 503 Service Unavailable
< x-app-version: v1
< x-mesh-client-id: playground-client.playground.serviceaccount.identity.linkerd.cluster.local
< x-request-count: 65
< x-served-by: playground-server-http-primary-9d9566587-xhsrl
< date: Thu, 14 May 2026 04:54:47 GMT
< content-length: 19
< content-type: text/plain; charset=utf-8
< 
{ [19 bytes data]
* Connection #0 to host playground-server-http.playground.svc.cluster.local:8080 left intact
```

**`l5d-proxy-error`가 없습니다**. 프록시는 앱의 응답을 그대로 통과시켰으며, `x-mesh-client-id`가 있다는 것은 mTLS가 성립했다는 증거입니다.

## 왜 이런 일이 일어나는가

이것은 프록시가 만든 응답이 아닙니다. 프록시는 *자신*이 실패할 때만 오류를 합성합니다: connect refused, failfast, ID 불일치 등. *성공적인* HTTP 트랜잭션에서 5xx 상태 코드가 실려 오는 경우는 어떤 실패 모드에도 해당하지 않으므로, 프록시는 응답을 그대로 통과시킵니다.

## 진단

"앱이냐, 메시냐?" 결정 트리:

1. **메시 피어를 통해 `-v`로 curl.** 응답에 `l5d-proxy-error`가 있는지 확인하세요. 5xx에 해당 헤더가 없으면 앱이 만든 오류입니다.

  ```sh
  POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
  kubectl -n playground debug "$POD" --image=curlimages/curl --profile=general --quiet -i -- \
    curl -sv http://playground-server-http.playground.svc.cluster.local:8080/ 2>&1 | grep -E '< HTTP|< l5d|< x-'
  ```

  ```
  < HTTP/1.1 503 Service Unavailable
  < x-app-version: v1
  < x-mesh-client-id: playground-client.playground.serviceaccount.identity.linkerd.cluster.local
  < x-request-count: 65
  < x-served-by: playground-server-http-primary-9d9566587-xhsrl
  ```

  출력에 `l5d-proxy-error` 헤더가 없습니다. 이것이 앱이 만든 5xx의 특징입니다.

2. **프록시 메트릭 확인.** 프록시가 합성한 오류는 `error="..."` 라벨이 있는 카운터를 증가시키고, 앱 오류는 `error` 라벨 없이 `classification="failure"`만 달린 `response_total` 행을 증가시킵니다:

   ```sh
   linkerd diagnostics proxy-metrics -n playground deploy/playground-client \
     | grep -E '^response_total|^outbound_http_errors_total' \
     | grep -v ' 0$' | head
   ```

  ```
  response_total{direction="outbound",authority="playground-server-http.playground.svc.cluster.local:8080",target_addr="10.42.1.24:8080",target_ip="10.42.1.24",target_port="8080",tls="true",server_id="playground-server-http-primary.playground.serviceaccount.identity.linkerd.cluster.local",dst_control_plane_ns="linkerd",dst_deployment="playground-server-http-primary",dst_namespace="playground",dst_pod="playground-server-http-primary-9d9566587-xhsrl",dst_pod_template_hash="9d9566587",dst_service="playground-server-http",dst_serviceaccount="playground-server-http-primary",dst_zone="",dst_zone_locality="unknown",status_code="503",classification="failure",grpc_status="",error=""} 65
  response_total{direction="outbound",authority="playground-server-http.playground.svc.cluster.local:8080",target_addr="10.42.0.23:8080",target_ip="10.42.0.23",target_port="8080",tls="true",server_id="playground-server-http-canary.playground.serviceaccount.identity.linkerd.cluster.local",dst_control_plane_ns="linkerd",dst_deployment="playground-server-http-canary",dst_namespace="playground",dst_pod="playground-server-http-canary-5597c667f6-4ttcq",dst_pod_template_hash="5597c667f6",dst_service="playground-server-http",dst_serviceaccount="playground-server-http-canary",dst_zone="",dst_zone_locality="unknown",status_code="503",classification="failure",grpc_status="",error=""} 7
  response_total{direction="inbound",target_addr="0.0.0.0:4191",target_ip="0.0.0.0",target_port="4191",tls="no_identity",no_tls_reason="no_tls_from_remote",srv_group="",srv_kind="default",srv_name="all-unauthenticated",srv_port="4191",route_group="",route_kind="default",route_name="default",authz_group="",authz_kind="default",authz_name="all-unauthenticated",status_code="503",classification="failure",grpc_status="",error=""} 1
  ```

  `failfast`도 없고 `error="..."` 라벨도 없으며, `classification="failure"` 카운트만 올라갑니다. 앱 문제라는 신호입니다.

3. **앱 로그를 확인하세요** (위). 서버가 의도적으로 오류를 로깅하고 있습니다.

## 수정

두 버전 모두 폴트 인젝션을 끄고 **양쪽** 노브를 기본값으로 리셋합니다. `ERROR_CODE=503`을 그대로 두면 업그레이드 후에도 서버 로그에 `errorRate=0% errorCode=503`이 남습니다. `errorRate=0`이 인젝션을 무력화하므로 무해하지만, 잘못된 상태가 잔류하면 혼란스럽습니다:

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0 --reuse-values \
  --set http.primary.env.ERROR_RATE=0 \
  --set http.primary.env.ERROR_CODE=500 \
  --set http.canary.env.ERROR_RATE=0 \
  --set http.canary.env.ERROR_CODE=500
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

서버의 시작 로그 라인으로 검증:

```sh
kubectl -n playground logs deploy/playground-server-http-primary -c server --tail=1
```

```
2026/05/14 04:56:43 server listening :8080, version=v1 response="hello from primary" latency=0ms+0ms errorRate=0% errorCode=500
```

실제 환경에서 수정은 워크로드 배포입니다. 메시는 제 역할을 했고, 워크로드가 제 역할을 하지 못한 것입니다.

## 되돌리기

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0 --reset-values
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```
