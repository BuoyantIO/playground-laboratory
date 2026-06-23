# 12: ServiceAccount deleted/recreated → workload cert renewal fails

Linkerd identity uses the ServiceAccount's projected token to verify which
workload is requesting a TLS cert. The token contains a UID that pins it to
a specific SA instance. If the SA is deleted and recreated *with the same
name*, the new SA has a different UID, and any cached tokens that pods
were holding now reference a "ghost" SA. On the next cert renewal cycle,
linkerd-identity's TokenReview against the API server fails, the proxy
can't refresh its workload cert, and once the current cert expires, mTLS
breaks across the board for that workload.

In a real incident this manifests hours after a GitOps repo accidentally
deleted-and-re-created an SA in the same sync.

## Setup

Install with a **short identity issuance lifetime** so the failure is
observable in minutes instead of hours, see [00-setup.md](00-setup.md)
"Variant: short cert lifetime":

```sh
k3d cluster create sma --servers 1 --agents 1 \
  --image rancher/k3s:v1.30.1-k3s1 --k3s-arg '--disable=traefik@server:*'

linkerd enterprise install --crds | kubectl apply -f -
linkerd enterprise install \
  --identity-issuance-lifetime=2m \
  --identity-clock-skew-allowance=10s \
  | kubectl apply -f -
linkerd enterprise check

docker build -t sma-server:dev server/ && docker build -t sma-client:dev client/
k3d image import sma-server:dev sma-client:dev -c sma
helm upgrade --install sma helm/sma
kubectl -n sma rollout status deploy/sma-server-v1 deploy/sma-server-v2 deploy/sma-client

kubectl -n sma port-forward svc/sma-client 3000:3000 &
```

The chart creates a dedicated SA `sma-server-v1` for v1 deployment (see
[helm/sma/templates/server-serviceaccount.yaml](../helm/sma/templates/server-serviceaccount.yaml),
added specifically for this runbook).

UI should show steady `200`s with mTLS verified, `client-id` reading
`sma-server-v1.sma.serviceaccount.identity.linkerd.cluster.local`.

## Symptom

- Within 1–3 minutes after recreating the SA:
  - Client UI starts showing red `502`s with `l5d-proxy-error: failed to
    identify` or similar TLS-failure markers.
  - mTLS badge flips to red "plain" on failed rows.
- Server pod is `Running`, application is healthy.
- `linkerd-identity` controller logs show repeated TokenReview failures
  for the `sma-server-v1` SA.

## Recreate

Delete and immediately recreate the SA with the same name:

```sh
# Note the current UID for the demo
OLD_UID=$(kubectl -n sma get sa sma-server-v1 -o jsonpath='{.metadata.uid}')
echo "old UID: $OLD_UID"

kubectl -n sma delete sa sma-server-v1
kubectl -n sma create sa sma-server-v1

NEW_UID=$(kubectl -n sma get sa sma-server-v1 -o jsonpath='{.metadata.uid}')
echo "new UID: $NEW_UID"
# UIDs are different.
```

The existing server pod is *not* restarted. Its sidecar still holds the
original projected token (cached on disk in the pod, with the OLD UID
embedded).

Wait for the next cert renewal cycle. With `issuance-lifetime=2m`, the
proxy attempts to renew partway through the cert's validity window,
typically within ~1 minute.

## What you'll see

`linkerd-identity` controller's logs:

```sh
kubectl -n linkerd logs deploy/linkerd-identity --tail=30
```

```
ERRO linkerd_identity::api: Failed to certify
  uid=<OLD_UID>
  error=TokenReview failed: invalid bearer token: serviceaccount with name
  "sma-server" in namespace "sma" has uid <NEW_UID>, expected <OLD_UID>
```

Server-side proxy logs (the one trying to renew):

```sh
kubectl -n sma logs deploy/sma-server-v1 -c linkerd-proxy --tail=30
```

```
WARN identity: linkerd_app::identity: Failed to obtain certificate
  error=status: PermissionDenied, message: "TokenReview failed: ..."
WARN identity: linkerd_app::identity: Retrying cert request in 10s
```

The cert keeps trying to renew, but the old token can't be validated. When
the *currently-installed* cert expires (within the 2m window), the proxy
falls back to plaintext or refuses connections, depending on direction:

- **Outbound from this pod:** can't present a valid client cert to peers
  → peers reject the handshake.
- **Inbound to this pod:** can't present a valid server cert → callers'
  outbound proxies fail the handshake → `502` on the client side.

Curl from the client at that point:

```sh
kubectl -n sma exec deploy/sma-client -c client -- \
  curl -sv -o /dev/null http://sma-server.sma.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< l5d'
```

```
< HTTP/1.1 502 Bad Gateway
< l5d-proxy-error: tls handshake error / certificate verify failed
< l5d-proxy-connection: close
```

## Why this happens

The proxy mounts a projected SA token via:

```yaml
volumes:
  - name: linkerd-identity-token
    projected:
      sources:
        - serviceAccountToken:
            path: token
            audience: identity.l5d.io
            expirationSeconds: 86400  # ~24h
```

The token's payload contains
`"kubernetes.io/serviceaccount/uid": "<UID at issuance time>"`.

When the proxy calls `Certify` on linkerd-identity, the controller forwards
the token to the API server via `TokenReview`. The API server validates:

1. The token's signature is valid (yes, kubelet signed it).
2. The audience matches (`identity.l5d.io`, yes).
3. The SA in the token's claims still exists *with the same UID*, **NO,
   the SA's UID changed** when it was recreated.

The TokenReview returns `Authenticated: false`, and linkerd-identity
returns a `PermissionDenied` to the proxy.

Kubelet will eventually refresh the projected token (default
`expirationSeconds: 3600` for many projected tokens, but Linkerd's is much
longer; see the proxy spec). Until that happens, the proxy has no way to
get a valid token.

## Diagnose

```sh
# 1. Check the SA UID.
kubectl -n sma get sa sma-server-v1 -o jsonpath='{.metadata.uid}{"\n"}'
# Compare with the value baked into the proxy's projected token.

# 2. Read the proxy's projected token directly.
kubectl -n sma exec deploy/sma-server-v1 -c linkerd-proxy -- \
  cat /var/run/secrets/tokens/linkerd-identity-token 2>/dev/null \
  || kubectl -n sma exec deploy/sma-server-v1 -c linkerd-proxy -- \
     find /var/run/secrets -name token -print -exec cat {} \;
# Decode the JWT payload (middle segment, base64url) to see the SA UID claim.

# Pretty-print:
TOKEN=$(kubectl -n sma exec deploy/sma-server-v1 -c linkerd-proxy -- \
  sh -c 'cat /var/run/secrets/tokens/linkerd-identity-token 2>/dev/null || cat $(find /var/run/secrets -name token | head -1)')
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq

# 3. linkerd-identity logs: the TokenReview failure is logged with both UIDs.
kubectl -n linkerd logs deploy/linkerd-identity --tail=50 \
  | grep -iE 'tokenreview|certify|uid'

# 4. From the data plane side, the proxy logs cert-request retries.
kubectl -n sma logs deploy/sma-server-v1 -c linkerd-proxy --tail=30 \
  | grep -iE 'identity|certificate'
```

## Fix

Restart the affected pods. kubelet projects a fresh token bound to the new
SA UID:

```sh
kubectl -n sma rollout restart deploy/sma-server-v1
kubectl -n sma rollout status deploy/sma-server-v1
```

The proxy in the new pod picks up the fresh token, succeeds at
`TokenReview`, and obtains a workload cert from linkerd-identity.

In production: be very careful when GitOps deletes/recreates SAs. Treat SA
deletion as equivalent to taking the workload offline. Roll all pods that
use the SA at the same time as the SA itself.

## Revert

Re-install with the default cert lifetime if you don't want a 2-minute
renewal cycle in subsequent runbooks:

```sh
k3d cluster delete sma
# then re-run 00-setup.md from the top.
```
