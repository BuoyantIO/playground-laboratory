# 06 — CrashLoopBackOff로 인한 지속적 failfast

readiness 깜빡임의 병적인 형태: 서버가 시작 시점에 크래시하고, kubelet이
결코 `Ready`로 표시하지 못해 Service가 영구적으로 비어 있게 되며, 모든
아웃바운드 요청이 `504 failfast`로 실패합니다. 메시 측의 증상은
[런북 04](04-failfast-no-endpoints.md)와 동일하지만, *운영* 측의 해결책은
완전히 다릅니다 — 그저 `scale --replicas=1`만 할 수 없습니다.

## 설치

[00-setup.md](00-setup.md)을 따라 새 클러스터, Linkerd Enterprise,
플레이그라운드 앱을 준비합니다. 진행하기 전에 UI에 녹색 `200`과 `mTLS`
배지가 보여야 합니다.

## 증상

- 클라이언트 UI: 트리거하는 순간부터 모든 폴링이 빨간 `504`.
- `kubectl get pods`가 `STATUS=CrashLoopBackOff`와 증가하는 `RESTARTS`를
  보여 줍니다.
- `kubectl get endpointslices`가 `playground-server-http`에 대해 `<none>`을
  보여 줍니다.

## 재현

시작 실패 노브를 설정합니다(
[server/cmd/http/main.go:17-19](../server/cmd/http/main.go) 참조):

```sh
helm uninstall demo
helm install demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.5 \
  --set http.primary.env.FAIL_ON_STARTUP=true \
  --set http.canary.env.FAIL_ON_STARTUP=true
kubectl -n playground rollout status \
  deploy/playground-server-http-primary --timeout=10s || true
```

두 버전 모두 크래시해야 합니다. primary만 CrashLoopBackOff면 kube-proxy가
canary로 계속 라우팅해 성공시키기 때문에 failfast를 결코 보지 못합니다.

롤아웃은 수렴하지 않습니다. 1분 안에:

```sh
kubectl -n playground get pods -l app=playground-server-http
```

```
NAME                                              READY   STATUS             RESTARTS      AGE
playground-server-http-primary-58dc4c65c6-4jwqt   1/2     CrashLoopBackOff   1 (11s ago)   16s
playground-server-http-canary-69bf7bf467-blgg5    1/2     CrashLoopBackOff   1 (11s ago)   16s
```

`1/2`인 것은 사이드카는 여전히 동작 중이고 `server` 컨테이너만 크래시
루프 중이기 때문입니다.

## 무엇이 보일까

클라이언트에서 curl, 런북 04와 동일한 failfast 응답:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl -n playground debug "$POD" --image=curlimages/curl --profile=general --quiet -i -- \
  curl -sv -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< l5d'
```

```
< HTTP/1.1 504 Gateway Timeout
< l5d-proxy-error: logical service 10.43.140.232:8080: route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast
< l5d-proxy-connection: close
```

다만 일시적 스케일-제로와 달리, 프록시에 "엔드포인트가 돌아오고 있다"고
알려 주는 신호가 없습니다. 엔드포인트가 계속 비어 있는 것을 지켜봅니다.

```sh
linkerd diagnostics endpoints playground-server-http.playground.svc.cluster.local:8080
# No endpoints found.
```

파드의 이벤트가 사연을 들려줍니다.

```sh
kubectl -n playground describe pod -l app=playground-server-http | grep -A20 Events:
```

```
  Warning  BackOff    118s (x7 over 2m24s)  kubelet            Back-off restarting failed container server in pod playground-server-http-canary-69bf7bf467-ktfn6_playground(1cc5e5d2-fa8f-496f-afb9-3dbea6516221)
```

## 왜 이런 일이 일어나는가

런북 04와 동일한 아웃바운드 failfast 경로입니다. 차이는 실패가
*지속적*이라는 점입니다. kubelet이 재시작을 지수적으로 백오프하므로
앞으로도 한동안 엔드포인트가 비어 있습니다.

구별되는 진단 단계는 메시가 아니라 파드 라이프사이클을 보는 것입니다.
프록시는 올바르게 반응하고 있고, 망가진 것은 워크로드입니다.

## 진단

```sh
# 1. 실패가 지속적인가, 일시적인가?
kubectl -n playground get pods -l app=playground-server-http
# RESTARTS가 올라가는 CrashLoopBackOff = 지속적.

# 2. 왜 크래시하는가?
kubectl -n playground logs deploy/playground-server-http-primary -c server --previous --tail=20
# 치명적 오류 / OOMKilled / 0이 아닌 종료 코드를 찾는다.

# 3. 엔드포인트가 비었음을 확인 (readiness 깜빡임 시나리오에서는 순환).
kubectl -n playground get endpointslices \
  -l kubernetes.io/service-name=playground-server-http \
  -o jsonpath='{.items[*].endpoints}' | jq

# 4. 엔드포인트 없음:
linkerd diagnostics endpoints playground-server-http.playground.svc.cluster.local:8080
# No endpoints found.

5. 
POD=$(kubectl -n playground get pod -l app=playground-client \
        -o jsonpath='{.items[0].metadata.name}')
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E 'outbound_http_balancer_endpoints|outbound_http_errors_total' \
  | grep playground-server-http
# 카운터가 증가하지 않고 0으로 설정됨
```

## 수정

크래시를 멈추세요 — 두 버전 모두에서:

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.5 --reuse-values \
  --set http.primary.env.FAIL_ON_STARTUP=false \
  --set http.canary.env.FAIL_ON_STARTUP=false
kubectl -n playground rollout restart \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

언급할 만한 실세계 원인:

- 누락된 ConfigMap / Secret 마운트.
- 잘못된 이미지 태그(`ImagePullBackOff`도 메시 시점에서는 비슷하게 보임).
- 필수 환경 변수 누락.
- init 컨테이너 실패.

## 되돌리기

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.5 --reset-values
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```
