# 02 — 아웃바운드 프로토콜 감지 타임아웃 (10초 지연)

아웃바운드 프록시는 모든 TCP 스트림의 첫 바이트를 들여다보고, HTTP/1인지,
HTTP/2(gRPC)인지, opaque인지 결정합니다. 약 10초 안에 바이트가 도착하지
않으면, 프록시는 기다리기를 포기하고 그 연결을 **opaque**로 분류한 뒤,
바이트를 raw TCP로 포워딩합니다. 연결이 **닫히는 것이 아니라**, 단지
감지 타임아웃만큼 지연될 뿐입니다.

이것이 "서버가 먼저 말하는" 또는 "양쪽 다 말하지 않는" 실패 모드이며,
SSH, IRC 같은 프로토콜이나 opaque-ports 목록에 없는 특이한 커스텀 포트의
흔한 함정입니다. (참고: MySQL, SMTP, Postgres, Redis, Memcached 등 일부는
이미 Linkerd의 `default-opaque-ports` 목록에 들어 있어 기본 설치에서는
이 문제를 겪지 않습니다.)

타임아웃을 *눈으로 보는* 가장 깔끔한 방법은, 메시 파드에서 페이로드 없는
TCP 연결을 만들고 프록시 로그를 지켜보는 것입니다.

## 설치

[00-setup.md](00-setup.md)을 따르세요. 베이스라인은 녹색이어야 합니다.

## 증상

- 메시 클라이언트 파드 내부에서
  `kubectl debug ... nc playground-server-http-primary 8080 </dev/null`을
  실행하면 TCP가 즉시 열립니다(핸드셰이크는 목적지가 아니라 *로컬
  아웃바운드 프록시*와 일어나기 때문). 이후 약 10초간 멈춰 있다가
  프록시가 opaque 포워딩을 시작합니다.
- 클라이언트 측 아웃바운드 프록시 로그에 `Detection::ReadTimeout(10s)`
  이후 `Continuing after timeout: 10s`가 찍힙니다.
- 서버 측 프록시는 (트랜스포트 헤더를 통해) 연결을 받지만, 자체 감지를
  건너뜁니다. 아웃바운드 프록시가 세션 프로토콜 힌트를 설정하지 않아
  인바운드 타임아웃 로그가 남지 않기 때문입니다.

이 현상은 SMA UI에서는 보이지 않습니다. Next.js 클라이언트가 즉시 HTTP
프리앰블을 보내기 때문에 프록시가 마이크로초 안에 감지합니다. 메시 파드
내부에서 `nc`로 수행하는 TCP 레벨 데모입니다.

## 재현

### 1. 클라이언트 프록시에서 detect 디버그 로깅 켜기

```sh
kubectl port-forward -n playground deploy/playground-client 4191
curl -v --data 'linkerd=info,linkerd_http_detect=debug,linkerd_app_outbound=debug' -X PUT localhost:4191/proxy-log-level
```

### 2. 메시 클라이언트에서 TCP 연결만 열고 바이트는 보내지 않기

```sh
POD=$(kubectl get pod -n playground -l app=playground-client \
        -o jsonpath='{.items[0].metadata.name}')

kubectl debug -n playground "$POD" \
  --image=nicolaka/netshoot --profile=general --quiet -i -- \
  sh -c 'time timeout 15 nc -v playground-server-http-primary.playground.svc.cluster.local 8080 </dev/null'
```

다음과 같이 보일 것입니다.

```
Command terminated by signal 15
real	0m 15.03s
user	0m 0.00s
sys	0m 0.00s
```

전체 15초가 걸린 것은 `timeout 15`가 그 시점에 `nc`를 죽였기 때문이며,
프록시가 15초를 기다린 것이 *아닙니다*. 프록시 자신의 타임아웃은
내부적으로 10초 지점에서 발화했습니다.

### 3. 클라이언트 프록시 로그에서 10초 타임아웃 확인

```sh
kubectl -n playground logs deploy/playground-client -c linkerd-proxy | grep -iE 'detect|timeout'
```

다음과 같은 라인이 보여야 합니다.

```
[  1267.198753s] DEBUG ThreadId(01) outbound:proxy{addr=10.43.163.235:8080}: linkerd_http_detect: Detected result=Ok(ReadTimeout(10s)) elapsed=10.001082629s
[  1267.198830s]  INFO ThreadId(01) outbound:proxy{addr=10.43.163.235:8080}: linkerd_app_outbound::protocol: Continuing after timeout: 10s
```

`Continuing after timeout` 라인이 핵심입니다. 프록시는 연결을 닫지 않고
opaque(raw-TCP) 핸들러로 전환해 계속 포워딩합니다.

### 4. (선택) 서버 프록시는 감지를 건너뛴다는 것 확인

```sh
kubectl port-forward -n playground deploy/playground-server-http-primary 4191
curl -v --data 'linkerd=info,linkerd_http_detect=debug,linkerd_app_outbound=debug' -X PUT localhost:4191/proxy-log-level

# nc 멈춤 재현 후:
kubectl -n playground logs deploy/playground-server-http-primary -c linkerd-proxy | grep -iE 'detect|timeout'
```

인바운드 측에서는 `ReadTimeout` 라인이 *보이지 않습니다*. 아웃바운드
프록시가 세션 프로토콜 힌트 없이 트랜스포트 헤더를 보냈고, 곧장
opaque/forward 스택으로 라우팅되어 바이트 단위 HTTP 감지가 완전히
생략됩니다.

일반 SMA 트래픽 제너레이터에서 나오는
`Detected result=Ok(Http(HTTP/1)) elapsed=Xµs` 라인이 많이 보일 수
있지만(실제 HTTP 바이트가 즉시 도착하므로 마이크로초 안에 끝남), 이는
멈춰 있던 `nc` 연결과는 무관합니다.

### 5. 로그 레벨 되돌리기

```sh
for d in playground-client playground-server-http-primary; do
  kubectl -n playground exec deploy/$d -c linkerd-proxy -- \
    curl -s --data 'warn,linkerd=info,hickory=error' \
    -X PUT localhost:4191/proxy-log-level
done
```

## 왜 이런 일이 일어나는가

아웃바운드 프록시의 프로토콜 감지 타임아웃은 기본 10초
(`proxy.detect_protocol_timeout`)입니다. 아웃바운드 정책이 `Detect`인
포트로 향하는 아웃바운드 TCP 스트림을 받았을 때:

1. 최대 1024바이트의 단일 비차단 read를 수행합니다.
2. **바이트가 도착하면**: HTTP/2 프리페이스(`PRI * HTTP/2.0`)와 매칭하거나,
   `httparse`로 HTTP/1 파싱을 시도합니다. 결정은 마이크로초 단위입니다.
3. **10초 안에 바이트가 도착하지 않으면**: 감지가
   `Detection::ReadTimeout(10s)`을 반환합니다. 프록시는
   `Continuing after timeout: 10s`를 로그에 남기고 opaque 스택으로
   떨어집니다. 그 연결의 남은 수명 동안 raw TCP로 포워딩됩니다.

연결은 **끊기지 않습니다**. 피어(여기서는 `nc`)는 어떤 오류도 보지
못하며, 외부에서 보이는 유일한 결과는 그 연결의 처음 10초 동안 어떤
트래픽도 포워딩되지 않는다는 것입니다.

이 실패의 두 가지 실세계 변형:

- **서버가 먼저 말하는 프로토콜** (SSH, IRC, 커스텀 TCP). 서버는 배너를
  보낼 준비가 되어 있지만, 프록시가 클라이언트가 말하기를 기다리고
  있어서 보낼 수 없습니다. 양쪽이 모두 기다립니다. 10초 후 프록시가
  opaque로 폴백하면서 마침내 배너가 도착합니다 — 다만 새 연결마다
  10초를 지불합니다.
- **앱이 첫 바이트를 보내는 데 시간이 오래 걸리는 경우**: 예컨대
  스레드 풀이 고갈된 HTTP 서버가 멈춰서 10초 넘게 요청 라인을 쓰지
  못하는 경우. 프록시는 HTTP를 포기하고 스트림을 opaque로 처리해 결국
  나오는 무엇이든 포워딩합니다 — 하지만 그 연결에서 요청별 라우트
  기능(타임아웃, 재시도, 메트릭)은 사라집니다.

두 경우 모두 해결책은 같습니다: 그 포트를 opaque로 표시해 프록시가
감지를 건너뛰고 즉시 바이트를 포워딩하게 합니다. 단순히 시작이 느린
HTTP 서비스라면, 올바른 수정은 메시 설정이 아니라 애플리케이션 측에
있습니다.

## 진단

```sh
# 1. 아웃바운드/인바운드 프록시 로그에 ReadTimeout이 나타난다.
kubectl -n playground logs deploy/playground-client -c linkerd-proxy --tail=200 \
  | grep -iE 'detect|timed out|timeout'

# 2. detect-timeout 카운터가 멈춘 연결마다 증가한다.
linkerd diagnostics proxy-metrics -n playground deploy/playground-client | grep -E 'detect.*(timeout|count|sum)' | head
```

## 수정

목적지가 정말로 서버가 먼저 말하는 프로토콜이라면, 워크로드 파드 레벨에서
포트를 opaque로 표시합니다 (인바운드 프록시의 로컬 정책을 제어).

```sh
kubectl -n playground annotate deploy playground-server-http-primary \
  config.linkerd.io/opaque-ports=8080 --overwrite
kubectl -n playground rollout restart deploy/playground-server-http-primary
```

## 되돌리기

```sh
kubectl -n playground annotate svc playground-server-http \
  config.linkerd.io/opaque-ports- --overwrite || true
kubectl -n playground annotate deploy playground-server-http-primary \
  config.linkerd.io/opaque-ports- --overwrite || true
kubectl -n playground rollout restart deploy/playground-server-http-primary
```
