# 01 — NetworkPolicy가 인바운드 프록시 포트를 차단

Linkerd 인바운드 프록시는 메시 트래픽용으로 `:4143`을, 어드민 서버용으로
`:4191`을 사용합니다. 메시 파드를 선택하면서 `:4143`에 대한 인그레스를
허용하지 않는 쿠버네티스 `NetworkPolicy`가 있으면, 애플리케이션 자체 포트
(여기서는 `:8080`)는 형식상 나열되어 있더라도 모든 인바운드 메시 트래픽이
조용히 차단됩니다.

결과는 connection-refused 502처럼 보이지만, 실제 실패 지점은 워크로드가 아니라
정책을 강제하는 CNI 플러그인입니다.

## 설치

[00-setup.md](00-setup.md)을 따르세요. k3d의 기본 CNI(flannel)는
NetworkPolicy를 강제하지 않습니다. 이 런북에서는 Cilium으로 클러스터를
다시 만듭니다.

```sh
k3d cluster delete sma 2>/dev/null
k3d cluster create sma \
  --servers 1 --agents 1 \
  --image rancher/k3s:v1.30.1-k3s1 \
  --k3s-arg '--disable=traefik@server:*' \
  --k3s-arg '--flannel-backend=none@server:*' \
  --k3s-arg '--disable-network-policy@server:*'

helm repo add cilium https://helm.cilium.io/
helm repo update
helm install cilium cilium/cilium --version 1.15.5 \
  --namespace kube-system \
  --set operator.replicas=1
kubectl -n kube-system rollout status ds/cilium --timeout=2m
```

이어서 [00-setup.md](00-setup.md)의 Linkerd Enterprise 설치 + SMA 배포를
진행합니다. 베이스라인은 녹색이어야 합니다.

## 증상

- 클라이언트 UI: 모든 폴링이 빨간색 `502`. mTLS 배지는 "plain"으로 표시
  (메시 피어에서 응답 없음).
- 지연 시간은 거의 즉시.
- 서버 파드는 `Ready`이고, 서버 앱은 로컬 루프백 호출자에게는 정상적으로
  응답합니다.
- 서버 파드에 `kubectl exec`해서 `curl localhost:8080`은 동작합니다.

## 재현

`:8080`은 허용하지만 `:4143`을 빠뜨린 NetworkPolicy를 적용합니다.

```sh
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: playground-server-only-8080
  namespace: playground
spec:
  podSelector:
    matchLabels:
      app: playground-server-http
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: playground-client
      ports:
        - protocol: TCP
          port: 8080
EOF
```

작성자는 앱 포트를 허용하고 있다고 생각했지만, 실제로는 메시가 사용하는
모든 것을 닫아 버렸습니다. 메시 파드의 인바운드 트래픽은 `:8080`이 아니라
`:4143`으로 도착하기 때문입니다.

> **참고 — 동일한 버그, `CiliumNetworkPolicy` 형태.** 이 클러스터는
> Cilium을 사용하므로, 동일한 시나리오를 `CiliumNetworkPolicy`
> (`cilium.io/v2`) 또는 클러스터 전역 변형인 `CiliumClusterwideNetworkPolicy`로
> 작성할 수 있습니다. CNP는 표준 `NetworkPolicy`와 동일한 L4 포트/프로토콜
> 구조를 공유하므로, `:4143`을 빠뜨리는 실수가 그대로 재현됩니다.
>
> ```yaml
> apiVersion: cilium.io/v2
> kind: CiliumNetworkPolicy
> metadata:
>   name: playground-server-only-8080
>   namespace: playground
> spec:
>   endpointSelector:
>     matchLabels:
>       app: playground-server-http
>   ingress:
>     - fromEndpoints:
>         - matchLabels:
>             app: playground-client
>       toPorts:
>         - ports:
>             - port: "8080"
>               protocol: TCP
> ```
>
> CNP는 그 위에 ID/서비스 어카운트 셀렉터, DNS 기반 이그레스, L7 규칙
> (`rules.http`, `rules.dns`, `rules.kafka`)을 추가합니다. 어떤 것도
> 프록시 포트 이야기를 바꾸지는 않습니다 — 단지 `:4143`과 `:4191`을
> "허용" 집합에서 조용히 빼먹을 수 있는 방법이 늘어날 뿐입니다.
> 진단과 수정은 동일합니다: 프록시 포트를 포함하세요.

## 무엇이 보일까

클라이언트 측 아웃바운드 프록시 로그:

```sh
kubectl -n playground logs deploy/playground-client -c linkerd-proxy --tail=10
```

```
[  1589.462218s]  INFO ThreadId(01) outbound:proxy{addr=10.43.67.169:8080}:rescue{client.addr=10.0.1.145:36552}: linkerd_app_core::errors::respond: HTTP/1.1 request failed error=logical service 10.43.67.169:8080: route default.http: service unavailable error.sources=[route default.http: service unavailable, service unavailable]
[  1619.469625s]  WARN ThreadId(01) outbound:proxy{addr=10.43.67.169:8080}:service{ns=playground name=playground-server-http port=8080}:endpoint{addr=10.0.0.120:8080}: linkerd_reconnect: Failed to connect error=connect timed out after 1s
[  1619.469672s]  WARN ThreadId(01) outbound:proxy{addr=10.43.67.169:8080}:service{ns=playground name=playground-server-http port=8080}:endpoint{addr=10.0.0.145:8080}: linkerd_reconnect: Failed to connect error=connect timed out after 1s
[  1620.574116s]  WARN ThreadId(01) outbound:proxy{addr=10.43.67.169:8080}:service{ns=playground name=playground-server-http port=8080}:endpoint{addr=10.0.0.145:8080}: linkerd_reconnect: Failed to connect error=connect timed out after 1s
[  1620.579566s]  WARN ThreadId(01) outbound:proxy{addr=10.43.67.169:8080}:service{ns=playground name=playground-server-http port=8080}:endpoint{addr=10.0.0.120:8080}: linkerd_reconnect: Failed to connect error=connect timed out after 1s
[  1621.471035s]  INFO ThreadId(01) outbound:proxy{addr=10.43.67.169:8080}:service{ns=playground name=playground-server-http port=8080}: linkerd_proxy_balance_queue::worker: Unavailable; entering failfast timeout=3.0
[  1621.471126s]  INFO ThreadId(01) outbound:proxy{addr=10.43.67.169:8080}:rescue{client.addr=10.0.1.145:34960}: linkerd_app_core::errors::respond: HTTP/1.1 request failed error=logical service 10.43.67.169:8080: route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast error.sources=[route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast, backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast, Service.playground.playground-server-http:8080: service in fail-fast, service in fail-fast]
```

메시 클라이언트에서 curl:

```sh
POD=$(kubectl get pod -n playground -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl debug -n playground "$POD" --image=nicolaka/netshoot --profile=general --quiet -i -- \
  curl -sv http://playground-server-http.playground.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< l5d'
```

```
< HTTP/1.1 504 Gateway Timeout
< l5d-proxy-error: logical service 10.43.67.169:8080: route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast
< l5d-proxy-connection: close
```

### 직접 포트 테스트

목표: `:4143`이 차단되고 `:8080`은 허용되고 있다는 사실을 와이어 위에서
입증합니다. Linkerd의 iptables 규칙이 양 끝단에 모두 깔려 있어 단순한
프로브는 거짓말을 합니다 — 이어지는 세 절은 함정 하나와 유효한 테스트
두 가지를 보여 줍니다.

```sh
SERVER_IP=$(kubectl -n playground get pod -l app=playground-server-http \
  -o jsonpath='{.items[0].status.podIP}')
POD=$(kubectl -n playground get pod -l app=playground-client \
  -o jsonpath='{.items[0].metadata.name}')
```

#### 함정: `kubectl debug --profile=general` (거짓 양성)

```sh
kubectl debug -n playground "$POD" \
  --image=nicolaka/netshoot --profile=general --quiet -i -- \
  nc -zv -w 3 "$SERVER_IP" 4143
# Connection to 10.0.0.120 4143 port [tcp/*] succeeded!
```

디버그 컨테이너는 메시 파드의 netns를 공유하므로 `linkerd-init`의 iptables
규칙을 그대로 상속받습니다. `OUTPUT` 체인은 비프록시 UID에서 나가는 모든
TCP 트래픽을 `127.0.0.1:4140`(로컬 아웃바운드 프록시)로 리다이렉트하며,
이 프록시는 들어오는 모든 SYN을 받아들입니다. 패킷은 파드를 떠나지 않고,
실제 서버가 아니라 자기 자신의 프록시와 핸드셰이크하고 있는 것입니다.
Cilium과 NetworkPolicy는 전혀 호출되지 않습니다.

#### 테스트 1 — 프록시 UID로 실행 (리다이렉트에서 제외)

Linkerd의 `OUTPUT` 체인에는 `-m owner --uid-owner 2102 -j RETURN`이
있어, UID `2102`(프록시)에서 나가는 트래픽은 리다이렉트를 우회합니다.
임시 컨테이너의 `runAsUser`를 덮어쓰면 SYN이 와이어까지 도달합니다.

```sh
cat > /tmp/proxy-uid.json <<'EOF'
{
  "securityContext": { "runAsUser": 2102 }
}
EOF

kubectl debug -n playground "$POD" \
  --image=nicolaka/netshoot --profile=general \
  --custom=/tmp/proxy-uid.json \
  --quiet -i -- \
  nc -zv -w 3 "$SERVER_IP" 4143
# nc: connect to 10.0.0.120 port 4143 (tcp) timed out: Operation in progress
```

`Connection refused`가 아닌 `timed out` — `:4143`에 매칭되는 규칙이
없으므로 Cilium의 eBPF 정책이 패킷을 조용히 떨어뜨린 것입니다.
Calico를 iptables 모드로 사용했다면 `Connection refused`가 반환됐을
것입니다.

#### 테스트 2 — 동일한 라벨을 가진 메시 외 파드에서 프로브

이 파드에는 iptables 규칙이 없으므로 패킷이 변조 없이 나갑니다. 파드는
`app=playground-client` 라벨을 달고 있어 정책의 `from` 절은 여전히
매칭됩니다 — 결과를 포트 검증으로 한정합니다.

```sh
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: netshoot
  namespace: playground
  labels:
    app: playground-client
  annotations:
    linkerd.io/inject: disabled
spec:
  restartPolicy: Never
  containers:
    - name: netshoot
      image: nicolaka/netshoot
      command: ["sleep", "3600"]
EOF
kubectl -n playground wait --for=condition=Ready pod/netshoot --timeout=5m

# :4143 — 정책이 거부, Cilium이 SYN을 떨어뜨림
kubectl -n playground exec netshoot -- nc -zv -w 3 "$SERVER_IP" 4143
# nc: connect to 10.0.0.120 port 4143 (tcp) timed out: Operation in progress

# :8080 — 정책이 허용; 서버 파드의 PREROUTING이 SYN을
# :4143으로 리다이렉트하고 인바운드 프록시가 응답한다. 앱은 보지 못한다.
kubectl -n playground exec netshoot -- nc -zv -w 3 "$SERVER_IP" 8080
# Connection to 10.0.0.120 8080 port [tcp/http-alt] succeeded!

kubectl -n playground delete pod netshoot
```

참고: `:8080`의 "성공"은, PREROUTING이 서버 파드 안에서 패킷을
`:8080`에서 `:4143`으로 리다이렉트한 뒤 *인바운드 프록시*가 핸드셰이크를
받아준 것입니다 — 루프백 위의 애플리케이션이 받은 것이 아닙니다. 두 가지
유효한 테스트가 일치합니다: `:4143`은 와이어에서 차단되고 있으며, 위의
아웃바운드 프록시 로그에 보이는 `connect timed out`과 정확히 맞아떨어집니다.

## 왜 이런 일이 일어나는가

메시 파드의 트래픽 흐름:

```
client pod                                       server pod
┌──────────────┐                            ┌─────────────────────┐
│ app          │                            │ app  :8080 (lo only)│
│  │           │                            │  ▲                  │
│  ▼ localhost │                            │  │ localhost        │
│ proxy(out)   │ ─── mTLS ───────► proxy(in):4143                  │
└──────────────┘                            └─────────────────────┘
```

`linkerd-init`(또는 linkerd-cni 플러그인)이 설치하는 iptables 규칙은
파드의 모든 비루프백 인바운드 트래픽을 `:4143`의 프록시로 리다이렉트합니다.
앱은 프록시를 위해 루프백에서만 수신합니다. `:4143`을 막으면 프록시가
연결을 받아들일 수 없으므로, 아웃바운드 측은 ECONNREFUSED를 봅니다.
런북 03과 동일한 코드 경로지만, 근본 원인은 완전히 다릅니다.

## 진단

```sh
# 1. 네임스페이스에 NetworkPolicy가 있는가?
kubectl -n playground get networkpolicy

# 2. 각 정책이 어떤 포트를 인그레스로 허용하는지 읽어 본다.
kubectl -n playground get networkpolicy -o yaml \
  | grep -E 'name:|port:|protocol:'

# 3. 정책에 :4143이나 :4191이 언급되는가? 없다면 잘못된 것.

# 4. 메시를 완전히 우회해 앱이 정상인지 확인:
kubectl -n playground port-forward deploy/playground-server-http-primary 18080:8080
curl -s http://localhost:18080/   # 작동 — 파드 루프백, iptables 미경유

## 수정

허용 포트에 `4143`(프록시 메트릭을 스크래핑한다면 `4191`도)을 추가합니다.
앱 포트 `:8080`은 *전혀* 필요하지 않습니다 — 인바운드 트래픽은 결코 그
포트로 직접 도착하지 않기 때문입니다.

```sh
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: playground-server-only-8080
  namespace: playground
spec:
  podSelector:
    matchLabels:
      app: playground-server-http
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: playground-client
      ports:
        - protocol: TCP
          port: 4143    # 인바운드 프록시 데이터 플레인
        - protocol: TCP
          port: 4191    # 프록시 어드민 / 메트릭
EOF
```

오해를 부르는 지점: 정책에 `8080`을 추가해도 어떤 것도 고쳐지지 않지만,
어떤 것도 깨지지 않습니다 — 단지 정책 작성자에게 *진짜* 트래픽을 허용하고
있다는 *착각*을 줄 뿐입니다. 그래서 이 실수가 코드베이스에서 몇 달씩
살아남곤 합니다.

## 되돌리기

```sh
kubectl -n sma delete networkpolicy sma-server-only-8080
```
