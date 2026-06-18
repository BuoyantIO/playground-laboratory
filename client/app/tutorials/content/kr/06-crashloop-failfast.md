# 06 - CrashLoopBackOff로 인한 지속적 failfast

readiness 깜빡임의 극단적 형태입니다. 서버가 시작 시점에 크래시하면 kubelet이 `Ready`로 표시하지 못하고, Service가 영구적으로 비어 있어 모든 아웃바운드 요청이 `504 failfast`로 실패합니다. 메시 측 증상은 [런북 04](04-failfast-no-endpoints.md)와 동일하지만, 해결책은 다릅니다. `scale --replicas=1`로는 해결되지 않습니다.

## 설치

[00-setup.md](00-setup.md)에 따라 새 클러스터, Linkerd Enterprise, 플레이그라운드 앱을 준비합니다. UI에 녹색 `200`과 `mTLS` 배지가 확인되면 진행합니다.

## 증상

- 클라이언트 UI: 트리거 즉시 모든 폴링이 빨간 `504`.
- `kubectl get pods`: `STATUS=CrashLoopBackOff`, `RESTARTS` 증가.
- `kubectl get endpointslices`: `playground-server-http`에 대해 `<none>`.

## 재현

시작 실패 노브를 설정합니다([server/cmd/http/main.go:17-19](../server/cmd/http/main.go) 참조).

```sh
helm uninstall demo
helm install demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.11 \
  --set http.primary.env.FAIL_ON_STARTUP=true \
  --set http.canary.env.FAIL_ON_STARTUP=true
kubectl -n playground rollout status \
  deploy/playground-server-http-primary --timeout=10s || true
```

두 버전 모두 크래시해야 합니다. primary만 CrashLoopBackOff이면 kube-proxy가 canary로 라우팅해 성공 응답을 반환하므로 failfast가 발생하지 않습니다.

롤아웃은 수렴하지 않습니다. 1분 이내에 확인합니다.

```sh
kubectl -n playground get pods -l app=playground-server-http
```

```
NAME                                              READY   STATUS             RESTARTS      AGE
playground-server-http-primary-58dc4c65c6-4jwqt   1/2     CrashLoopBackOff   1 (11s ago)   16s
playground-server-http-canary-69bf7bf467-blgg5    1/2     CrashLoopBackOff   1 (11s ago)   16s
```

`1/2`는 사이드카는 동작 중이고 `server` 컨테이너만 크래시 루프 중이기 때문입니다.

## 무엇이 보일까

클라이언트에서 curl하면 런북 04와 동일한 failfast 응답을 받습니다.

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

일시적 스케일-제로와 달리, 엔드포인트가 복귀한다는 신호가 없습니다. 엔드포인트는 계속 비어 있습니다.

```sh
linkerd diagnostics endpoints playground-server-http.playground.svc.cluster.local:8080
# No endpoints found.
```

파드 이벤트에서 원인을 확인합니다.

```sh
kubectl -n playground describe pod -l app=playground-server-http | grep -A20 Events:
```

```
  Warning  BackOff    118s (x7 over 2m24s)  kubelet            Back-off restarting failed container server in pod playground-server-http-canary-69bf7bf467-ktfn6_playground(1cc5e5d2-fa8f-496f-afb9-3dbea6516221)
```

## 왜 이런 일이 일어나는가

아웃바운드 failfast 경로는 런북 04와 동일합니다. 차이점은 실패가 *지속적*이라는 것입니다. kubelet이 재시작을 지수적으로 백오프하므로 엔드포인트는 한동안 비어 있습니다.

진단의 핵심은 메시가 아니라 파드 라이프사이클을 확인하는 것입니다. 프록시는 정상 동작 중이며, 문제는 워크로드에 있습니다.

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

두 버전 모두 크래시를 중단합니다.

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.11 --reuse-values \
  --set http.primary.env.FAIL_ON_STARTUP=false \
  --set http.canary.env.FAIL_ON_STARTUP=false
kubectl -n playground rollout restart \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

실제 환경에서의 주요 원인:

- ConfigMap / Secret 마운트 누락.
- 잘못된 이미지 태그(`ImagePullBackOff`도 메시 관점에서는 유사하게 보임).
- 필수 환경 변수 누락.
- init 컨테이너 실패.

## 되돌리기

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.11 --reset-values
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```
