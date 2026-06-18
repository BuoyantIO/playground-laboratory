# 00 - 클러스터 + Linkerd Enterprise 설치

이 디렉터리의 모든 런북은 Linkerd Enterprise(BEL)가 설치된 새 k3d 클러스터를 전제합니다. 이 파일이 정식 설치 가이드이며, 각 런북의 "## Setup" 섹션은 이 문서를 참조합니다.

## 머신 사전 준비물

```sh
# k3d
brew install k3d            # 또는: curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash

# kubectl, helm (OCI 레지스트리에는 3.8+ 필요)
brew install kubectl helm

# Linkerd Enterprise CLI (BEL)
curl --proto '=https' --tlsv1.2 -sSfL https://enterprise.buoyant.io/install | sh
export PATH="$HOME/.linkerd2/bin:$PATH"
linkerd version

# Buoyant Enterprise 라이선스 (`linkerd install`이 사용하는 환경 변수)
export BUOYANT_LICENSE='<your license string>'
```

> BEL 라이선스가 없다면, 동일한 런북이 오픈소스 Linkerd에서도 동작합니다.

## 1. k3d 클러스터 생성

```sh
k3d cluster create playground \
  --servers 1 --agents 1 \
  --image rancher/k3s:v1.30.1-k3s1 \
  --k3s-arg '--disable=traefik@server:*' \
  --port '8081:80@loadbalancer'
kubectl cluster-info
```

노드 두 개(서버 1개 + 에이전트 1개)는 런북 15(CNI 경합)와 14(SA 재생성, 파드 재스케줄) 시연에 필요합니다. `--port '8081:80@loadbalancer'`는 ingress 런북용으로 ingress 컨트롤러를 `localhost:8081`에 노출하며, 다른 런북에는 영향이 없어 이 클러스터 하나로 모든 런북을 진행할 수 있습니다.

## 2. Linkerd Enterprise 설치

```sh
# Gateway API CRDs 설치
kubectl apply --server-side -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.0/standard-install.yaml

# CRD를 먼저, 별도의 apply로.
linkerd install --crds | kubectl apply -f -

# 컨트롤 플레인.
linkerd install | kubectl apply -f -

# 모든 것이 Ready가 될 때까지 기다리고 검증.
linkerd check
```

## 3. 플레이그라운드 배포

차트와 이미지는 GHCR에 공개 OCI 아티팩트로 게시됩니다.

```sh
helm install demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0

kubectl -n playground rollout status \
  deploy/playground-server-http-primary \
  deploy/playground-server-http-canary \
  deploy/playground-dashboard \
  deploy/playground-client
```

`playground` 네임스페이스에 `linkerd.io/inject: enabled` 어노테이션이 있어 네 디플로이먼트 모두 `linkerd-proxy` 사이드카와 함께 기동됩니다. **`playground-client`**는 상시 실행 트래픽 생성기로 모든 런북이 계측하는 메시 호출자이며, **`playground-dashboard`**는 그 흐름과 생성기의 실시간 설정을 표시하는 UI입니다.

## 4. 대시보드 열기

```sh
kubectl -n playground port-forward svc/playground-dashboard 3000:3000
open http://localhost:3000
```

녹색 `200`이 일정하게 흐르고, 지연은 수 밀리초 수준이며, "Recent samples" 테이블의 모든 행에 **mTLS** 배지가 표시됩니다. Topology 배너에는 `HTTP/1.1 · mTLS`가 나타나고 `mtls verified` 칩이 녹색으로 켜집니다.

프록시가 우회되거나(런북 13) mTLS가 깨지면(런북 14) 배지는 **plain**으로 바뀌고 프로토콜 배너는 빨간색이 됩니다. 이것이 수업에서 활용하는 시각적 신호입니다.

## 진단 도구 모음

모든 런북이 동일한 다섯 가지 기법을 사용합니다.

```sh
# 1. 프록시 메트릭
linkerd diagnostics proxy-metrics -n playground deploy/playground-client
kubectl port-forward -n playground deploy/playground-client 4191
curl localhost:4191/metrics

# 2. 프록시 로그
kubectl logs -n playground deploy/playground-client -c linkerd-proxy --tail=50 -f

# 3. 런타임에 프록시 로그 레벨 올리기 (재시작 불필요). 기본은 "info".
kubectl port-forward -n playground deploy/playground-client 4191
curl -v --data 'linkerd=debug' -X PUT localhost:4191/proxy-log-level

# 3. 프록시 메트릭
kubectl -n playground exec deploy/playground-client -c linkerd-proxy -- \
  curl -s http://localhost:4191/metrics | grep -E 'failfast|response_total|endpoints'

# 4. 엔드포인트 멤버십
linkerd diagnostics endpoints playground-server-http.playground.svc.cluster.local:8080

# 5. 메시 피어 내부에서 목적지로 curl, -v로 헤더까지 확인.
POD=$(kubectl get pod -n playground -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl debug -n playground "$POD" --image=nicolaka/netshoot --profile=general --quiet -i -- \
  curl -sv http://playground-server-http.playground.svc.cluster.local:8080/ 2>&1 | tail -15
# 다음을 살펴봅니다: l5d-proxy-error, l5d-proxy-connection, l5d-client-id
```

## 런북 사이의 리셋

```sh
# 정책, 라우트, 네트워크 리소스를 기본값으로 되돌리기.
kubectl -n playground delete httproute,authorizationpolicy,meshtlsauthentication,\
networkauthentication,server.policy.linkerd.io,networkpolicy --all \
  --ignore-not-found

# Helm 릴리스 리셋.
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --set prometheus.enabled=true \
  --set grafana.enabled=true \
  --version 1.1.0
kubectl -n playground rollout status \
  deploy/playground-server-http-primary \
  deploy/playground-server-http-canary \
  deploy/playground-dashboard \
  deploy/playground-client
```

클러스터가 복구 불가 상태가 되면(예: 트러스트 앵커 불일치), 원인을 추적하기보다 새로 시작하는 편이 빠릅니다.

```sh
k3d cluster delete playground
```
