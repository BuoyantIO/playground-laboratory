# 06: `502` from `l5d-require-id` mismatch

The `l5d-require-id` header lets a caller assert that *only* a specific peer
identity is acceptable at the other end of the mTLS connection. If the
endpoint the outbound balancer picks doesn't present that identity, the proxy
short-circuits to a `502` instead of trusting the wrong peer.

The real-world failure: someone hard-coded an SA name in a header filter,
then the destination Deployment got migrated to a different SA. Every
request now fails with no obvious clue from the destination's side, because
the destination's proxy never gets dialled.

## Setup

Follow [00-setup.md](00-setup.md). Baseline should be green.

## Symptom

- Client UI: every poll red `502`. mTLS badge shows "plain", but the request
  never reached the server-side proxy, so that's expected (no response means
  no `x-mesh-client-id` to display).
- Latency near-instant.
- Server-side proxy and server app log nothing, the outbound proxy never
  even opened a connection.

## Recreate

Inject a wrong-identity `l5d-require-id` via an HTTPRoute header filter on
every request to `sma-server`:

```sh
kubectl apply -f - <<'EOF'
apiVersion: policy.linkerd.io/v1beta3
kind: HTTPRoute
metadata:
  name: sma-server-pin-wrong-id
  namespace: sma
spec:
  parentRefs:
    - name: sma-server
      kind: Service
      group: core
      port: 8080
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      filters:
        - type: RequestHeaderModifier
          requestHeaderModifier:
            set:
              - name: l5d-require-id
                value: nobody.sma.serviceaccount.identity.linkerd.cluster.local
EOF
```

The real server identity is `sma-server-v1.sma.serviceaccount.identity.linkerd.cluster.local`
(the SA the chart creates for the server), which doesn't match
`nobody.sma...`.

## What you'll see

Curl from the meshed client:

```sh
kubectl -n sma exec deploy/sma-client -c client -- \
  curl -sv -o /dev/null http://sma-server.sma.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< l5d'
```

```
< HTTP/1.1 502 Bad Gateway
< l5d-proxy-error: identity required: required id "nobody.sma..." does not match endpoint "sma-server.sma..."
< l5d-proxy-connection: close
```

Client-side outbound proxy logs:

```sh
kubectl -n sma logs deploy/sma-client -c linkerd-proxy --tail=10
```

```
WARN outbound:rescue{...}: HTTP/1.1 request failed
  error=identity required: required id
  "nobody.sma.serviceaccount.identity.linkerd.cluster.local"
  does not match endpoint
  "sma-server-v1.sma.serviceaccount.identity.linkerd.cluster.local"
```

Crucially, the *server*-side proxy and app are silent. The outbound proxy
rejected the endpoint before even attempting to connect.

## Why this happens

The outbound stack checks the resolved endpoint's identity against
`l5d-require-id` *before* establishing the connection. The handler lives in
[linkerd/app/outbound/src/http/require_id_header.rs](../../buoyant/buoyant-proxy/linkerd/app/outbound/src/http/require_id_header.rs);
the rescue path in
[linkerd/app/outbound/src/http/server.rs:147-151](../../buoyant/buoyant-proxy/linkerd/app/outbound/src/http/server.rs)
converts `IdentityRequired` into a `bad_gateway`:

```rust
// A request with a `l5d-require-id` header are dispatched to endpoints
// with a different identity.
if errors::is_caused_by::<IdentityRequired>(&*error) {
    return Ok(errors::SyntheticHttpResponse::bad_gateway(error));
}
```

This is *enforced*, not advisory. The proxy refuses to talk to the endpoint:
no bytes flow.

## Diagnose

```sh
# 1. What identity does the destination *actually* present?
# (Look at a healthy request to a different service, or check the SA.)
kubectl -n sma get deploy sma-server-v1 \
  -o jsonpath='{.spec.template.spec.serviceAccountName}{"\n"}'
# sma-server-v1  →  identity sma-server-v1.sma.serviceaccount.identity.linkerd.cluster.local

# 2. Is anything injecting l5d-require-id?
kubectl -n sma get httproute -o yaml | grep -B2 -A4 l5d-require-id

# 3. Test without the header (curl directly to the Service from another
# meshed pod, bypassing the HTTPRoute filter is harder, easier to delete
# the route first). For diagnostic purposes:
kubectl -n sma delete httproute sma-server-pin-wrong-id --ignore-not-found
kubectl -n sma exec deploy/sma-client -c client -- \
  curl -sv http://sma-server.sma.svc.cluster.local:8080/ 2>&1 | tail -10
# Succeeds → confirms the require-id was the culprit.
```

## Fix

Three options depending on intent:

1. **Drop the assertion:** remove `l5d-require-id`. The mesh still gives
   you mTLS by default; pinning is optional.
2. **Fix the value:** set the header to the *actual* destination identity.
3. **Move the destination to the asserted SA:** create the `nobody` SA and
   bind the server deployment to it via `spec.template.spec.serviceAccountName`.

For the demo, option 1 is the usual cleanup:

```sh
kubectl -n sma delete httproute sma-server-pin-wrong-id
```

## Revert

```sh
kubectl -n sma delete httproute sma-server-pin-wrong-id --ignore-not-found
```
