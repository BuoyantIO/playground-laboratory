# 09 — 만료된 웹훅 `caBundle`이 Pod admission을 차단함

Linkerd Enterprise는 `linkerd-proxy-injector-webhook-config`라는
`MutatingWebhookConfiguration` 하나와,
`linkerd-policy-validator-webhook-config` 및
`linkerd-sp-validator-webhook-config`라는 두 개의
`ValidatingWebhookConfiguration` 리소스를 등록합니다. 이를 통해 API
서버는 모든 Pod / Policy / ServiceProfile 생성 시점에 injector와
validator를 호출하게 됩니다. 웹훅의 `clientConfig.caBundle`은 API
서버가 웹훅의 TLS 서버 인증서를 검증할 때 사용하는 CA 인증서입니다.
이 caBundle이 만료되면 API 서버는 웹훅에 도달할 수 없게 되고, 새로운
프록시 주입(injection)과 Policy / ServiceProfile 생성이 모두
실패합니다.

기본적으로 `clientConfig.caBundle`은 Helm이 설치 시점에 생성하는
유효기간 365일짜리 자체 서명 인증서입니다. 실제 현장에서 흔히 보이는
원인은 운영자가 1년 넘게 Linkerd를 업그레이드하지 않아 인증서가
만료되는 경우입니다.

## Setup

[00-setup.md](00-setup.md)를 따라 새 클러스터, Linkerd Enterprise,
playground 앱을 준비하세요. 진행하기 전에 UI에서 `mTLS` 배지와 함께
초록색 `200` 응답이 보여야 합니다.

## Symptom

- 기존 Pod들은 계속 동작하고 UI는 초록색 `200` 응답을 계속 표시합니다.
- **`playground` 네임스페이스에서 새로 생성된 Pod에 `linkerd-proxy`
  사이드카가 주입되지 않습니다.**
- **`playground` 네임스페이스에서 새로운 `ServiceProfile`이나
  policy 리소스 생성이 실패합니다.**

이 장애는 admission 시점에서 발생하며 데이터 플레인의 문제가
아닙니다. 이미 실행 중인 워크로드는 정상이고, 다음 배포가 망가지는
유형의 장애입니다.

## Recreate

caBundle을 이미 만료될 예정인 자체 서명 인증서로 교체합니다:

```sh
# 2분 후에 만료되는 인증서를 생성합니다.
NOT_BEFORE=$(date -u +%Y%m%d%H%M%SZ)
NOT_AFTER=$(date -u -v+2M +%Y%m%d%H%M%SZ)
openssl req -x509 -newkey rsa:2048 -nodes \
  -not_before "$NOT_BEFORE" -not_after "$NOT_AFTER" \
  -keyout /tmp/expiring.key -out /tmp/expiring.crt \
  -subj "/CN=expiring"

EXPIRED_B64=$(base64 < /tmp/expiring.crt | tr -d '\n')

# proxy-injector 웹훅에 패치를 적용합니다.
kubectl patch mutatingwebhookconfiguration \
  linkerd-proxy-injector-webhook-config \
  --type='json' \
  -p="[{\"op\":\"replace\",\"path\":\"/webhooks/0/clientConfig/caBundle\",\"value\":\"${EXPIRED_B64}\"}]"
```

이제 서버를 스케일하여 새 Pod 생성을 강제합니다:

```sh
kubectl -n playground scale deploy -l app=playground-server-http --replicas=2
```

## What you'll see

새 Pod에 프록시가 주입되지 않습니다:

```
playground    playground-server-http-primary-5c7df787c8-2qvjp   1/1     Running   0          8s
playground    playground-server-http-canary-5c6b6bbc99-zpg4l    1/1     Running   0          8s
```

망가진 caBundle을 확인합니다:

```sh
kubectl get mutatingwebhookconfiguration \
  linkerd-proxy-injector-webhook-config \
  -o jsonpath='{.webhooks[0].clientConfig.caBundle}' \
  | base64 -d | openssl x509 -noout -dates
```

```
notBefore=May 14 12:08:31 2026 GMT
notAfter=May 14 12:09:31 2026 GMT
```

`linkerd check`도 이를 감지합니다:

```sh
linkerd-webhooks-and-apisvc-tls
-------------------------------
× proxy-injector webhook has valid cert
    anchors not within their validity period:
	* 552409261965999710590609819328603539685614650070 expiring not valid anymore. Expired on 2026-05-14T12:09:31Z
    see https://linkerd.io/2/checks/#l5d-proxy-injector-webhook-cert-valid for hints
```

실행 중인 Pod들은 영향을 받지 않으며, UI는 초록색 응답을 계속
폴링합니다.

## Why this happens

Kubernetes는 웹훅 설정의 `clientConfig.caBundle`을 사용해
`linkerd-proxy-injector.linkerd.svc:443`을 비롯한 validating
webhook들이 제시하는 TLS 인증서를 검증합니다. 흐름은 다음과 같습니다:
API 서버 → webhook svc (TLS) → injector/validator Pod. caBundle이
서버 인증서를 검증하지 못하면, API 서버는 admission 요청을 보내기 전에
TLS 핸드셰이크 단계에서 거부합니다.

injector Pod 자체는 정상입니다. Pod가 서비스하는 (별도의) TLS
인증서도 문제가 없습니다. 문제는 오직 API 서버가 그 인증서를
검증할 때 사용하는 신뢰(trust) 입력값에 있습니다.

실행 중인 Pod들이 영향을 받지 않는 이유: proxy-injector는 Pod *생성*
시점에만 호출됩니다. 한 번 주입되고 나면, 사이드카는 웹훅의 추가
개입 없이 계속 동작합니다.

## Diagnose

```sh
# 1. 각 Linkerd 웹훅의 caBundle을 확인합니다.
for w in linkerd-proxy-injector-webhook-config \
         linkerd-sp-validator-webhook-config \
         linkerd-policy-validator-webhook-config; do
  echo "=== $w ==="
  kubectl get mutatingwebhookconfiguration "$w" \
    -o jsonpath='{.webhooks[0].clientConfig.caBundle}' 2>/dev/null \
    | base64 -d | openssl x509 -noout -dates -subject 2>/dev/null \
    || kubectl get validatingwebhookconfiguration "$w" \
       -o jsonpath='{.webhooks[0].clientConfig.caBundle}' \
       | base64 -d | openssl x509 -noout -dates -subject
done

# 2. Linkerd의 자체 check도 이 항목을 검사합니다:
linkerd check

# 3. 정상성 확인 차원에서, injector Pod 자체는 정상입니다:
kubectl -n linkerd get pod -l linkerd.io/control-plane-component=proxy-injector
kubectl -n linkerd logs deploy/linkerd-proxy-injector --tail=20
# (조용함 — API 서버가 웹훅에 도달하지 못하기 때문에 admission 요청 자체가
# 도착하지 않습니다)
```

## Fix

가장 간단한 해결책은 `helm upgrade` 또는 `linkerd upgrade`를
실행하는 것입니다. 둘 중 어느 쪽이든 유효기간 365일짜리 새 자체 서명
인증서를 생성해 줍니다.

```sh
linkerd upgrade | kubectl apply -f -

helm upgrade -n linkerd linkerd-enterprise control-plane --reuse-values

linkerd check
```

운영 환경에서 cert-manager를 함께 사용하는 경우, 동기화와 caBundle
재배포가 수동 개입 없이 자동으로 처리됩니다.

## Revert

`Fix` 단계에서 이미 caBundle을 복구했습니다. 확인:

```sh
linkerd upgrade | kubectl apply -f -
```

새 Pod가 정상적으로 admit되고 사이드카가 주입되어 있어야 합니다.
