# 09 — Expired webhook `caBundle` blocks pod admission

Linkerd Enterprise registers a `MutatingWebhookConfiguration` named
`linkerd-proxy-injector-webhook-config` and two
`ValidatingWebhookConfiguration` resources named
`linkerd-policy-validator-webhook-config` and
`linkerd-sp-validator-webhook-config`, so the API server calls the
injector and validators on every pod / Policy / ServiceProfile
creation. The webhook's `clientConfig.caBundle` is the CA cert the API
server uses to verify the webhook's TLS server cert. When that caBundle
expires, the API server can't reach the webhook, and every new proxy
injection or Policy / ServiceProfile creation fails.

By default, the `clientConfig.caBundle` is a self-signed certificate
with a 365-day validity, created by Helm at installation time. A
classic real-world cause is an operator who hasn't upgraded Linkerd in
more than a year, letting the certificate expire.

## Setup

Follow [00-setup.md](00-setup.md) for a fresh cluster, Linkerd
Enterprise, and the playground app. You should see green `200`s with
`mTLS` badges in the UI before proceeding.

## Symptom

- Existing pods keep running and the UI keeps showing green `200`s.
- **New pods created in `playground` are not injected with the
  `linkerd-proxy` sidecar.**
- **New `ServiceProfile` or policy resources in `playground` fail to
  be created.**

The failure mode is admission-time, not data-plane. Running workloads
are fine; the next deploy is broken.

## Recreate

Replace the caBundle with an already-expired self-signed cert:

```sh
# Generate a cert that expires in 2 minutes.
NOT_BEFORE=$(date -u +%Y%m%d%H%M%SZ)
NOT_AFTER=$(date -u -v+2M +%Y%m%d%H%M%SZ)
openssl req -x509 -newkey rsa:2048 -nodes \
  -not_before "$NOT_BEFORE" -not_after "$NOT_AFTER" \
  -keyout /tmp/expiring.key -out /tmp/expiring.crt \
  -subj "/CN=expiring"

EXPIRED_B64=$(base64 < /tmp/expiring.crt | tr -d '\n')

# Patch the proxy-injector webhook with it.
kubectl patch mutatingwebhookconfiguration \
  linkerd-proxy-injector-webhook-config \
  --type='json' \
  -p="[{\"op\":\"replace\",\"path\":\"/webhooks/0/clientConfig/caBundle\",\"value\":\"${EXPIRED_B64}\"}]"
```

Now force a new pod by scaling the server:

```sh
kubectl -n playground scale deploy -l app=playground-server-http --replicas=2
```

## What you'll see

The new pods are not injected with the proxy:

```
playground    playground-server-http-primary-5c7df787c8-2qvjp   1/1     Running   0          8s
playground    playground-server-http-canary-5c6b6bbc99-zpg4l    1/1     Running   0          8s
```

Inspect the broken caBundle:

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

`linkerd check` flags it:

```sh
linkerd-webhooks-and-apisvc-tls
-------------------------------
× proxy-injector webhook has valid cert
    anchors not within their validity period:
	* 552409261965999710590609819328603539685614650070 expiring not valid anymore. Expired on 2026-05-14T12:09:31Z
    see https://linkerd.io/2/checks/#l5d-proxy-injector-webhook-cert-valid for hints
```

Running pods are unaffected; the UI keeps polling green.

## Why this happens

Kubernetes uses the `clientConfig.caBundle` from the webhook config to
verify the TLS cert presented by `linkerd-proxy-injector.linkerd.svc:443`
and the other validating webhooks. The chain is: API server → webhook
svc (TLS) → injector/validator pod. If the caBundle doesn't validate
the server cert, the API server rejects the handshake before sending
the admission request.

The injector pod itself is healthy. Its TLS cert (separate, served by
the pod) is fine. The problem is purely in the trust input that the
API server uses to verify it.

Why running pods are unaffected: the proxy-injector is only invoked at
pod *creation* time. Once injected, the sidecar keeps running without
further involvement from the webhook.

## Diagnose

```sh
# 1. Inspect the caBundle on each Linkerd webhook.
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

# 2. Linkerd's own check covers this:
linkerd check

# 3. As a sanity check, the injector pod itself is fine:
kubectl -n linkerd get pod -l linkerd.io/control-plane-component=proxy-injector
kubectl -n linkerd logs deploy/linkerd-proxy-injector --tail=20
# (silent — no admission requests are arriving because the API server
# can't reach the webhook)
```

## Fix

The easiest fix is to trigger a `helm upgrade` or `linkerd upgrade`.
Either will generate a new self-signed certificate with a 365-day
validity.

```sh
linkerd upgrade | kubectl apply -f -

helm upgrade -n linkerd linkerd-enterprise control-plane --reuse-values

linkerd check
```

In production, cert-manager takes care of the sync and re-populates
the caBundle without manual intervention.

## Revert

The `Fix` section already restored the caBundle. Sanity check:

```sh
linkerd upgrade | kubectl apply -f -
```

New pods should now be admitted, and the sidecar should be present.
