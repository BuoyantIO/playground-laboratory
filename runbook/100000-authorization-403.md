# 05: `403` from a mis-scoped AuthorizationPolicy

Linkerd's policy CRDs let you require specific peer identities to be allowed
to call a workload. When the policy on the *inbound* side doesn't match the
real caller, the proxy synthesises a `403 Forbidden` before the request
reaches the application.

The classic mistake demonstrated here: someone locked down `sma-server` by
copy-pasting an `AuthorizationPolicy` example that references a service
account that doesn't exist (or the wrong namespace). All legitimate traffic
gets denied.

## Setup

Follow [00-setup.md](00-setup.md). Baseline should be green.

## Symptom

- Client UI: every poll red `403`. mTLS badge stays green (because mTLS *is*
  established, the rejection happens after the handshake).
- Latency near-instant.
- Server application logs are silent, request never reached the app.

## Recreate

Apply a `Server` + `MeshTLSAuthentication` + `AuthorizationPolicy` triple
that only allows a service account that doesn't exist:

```sh
kubectl apply -f - <<'EOF'
apiVersion: policy.linkerd.io/v1beta3
kind: Server
metadata:
  name: sma-server-http
  namespace: sma
spec:
  podSelector:
    matchLabels:
      app: sma-server
  port: http
  proxyProtocol: HTTP/1
---
apiVersion: policy.linkerd.io/v1beta3
kind: MeshTLSAuthentication
metadata:
  name: only-nobody
  namespace: sma
spec:
  identities:
    - "nobody.sma.serviceaccount.identity.linkerd.cluster.local"
---
apiVersion: policy.linkerd.io/v1beta3
kind: AuthorizationPolicy
metadata:
  name: sma-server-allow-nobody
  namespace: sma
spec:
  targetRef:
    group: policy.linkerd.io
    kind: Server
    name: sma-server-http
  requiredAuthenticationRefs:
    - kind: MeshTLSAuthentication
      group: policy.linkerd.io
      name: only-nobody
EOF
```

The `sma-client` deployment runs under its own `sma-client` SA, so its
mesh identity is
`sma-client.sma.serviceaccount.identity.linkerd.cluster.local`, does
not match `nobody.sma...`.

## What you'll see

Curl from the meshed client:

```sh
kubectl -n sma exec deploy/sma-client -c client -- \
  curl -sv -o /dev/null http://sma-server.sma.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< l5d'
```

```
< HTTP/1.1 403 Forbidden
< l5d-proxy-error: unauthorized request on route
```

Note no `l5d-proxy-connection: close`, the synthesiser for
`permission_denied` keeps the connection open
([respond.rs:138-146](../../buoyant/buoyant-proxy/linkerd/app/core/src/errors/respond.rs)).

Server-side inbound proxy logs:

```sh
kubectl -n sma logs deploy/sma-server-v1 -c linkerd-proxy --tail=20
```

```
INFO inbound:server{port=8080}:rescue{client.addr=10.244.0.21:55012}:
  HTTP/1.1 request failed
  error=unauthorized request on route
  client.tls.id=sma-client.sma.serviceaccount.identity.linkerd.cluster.local
```

Server app logs: nothing. The request never made it past the proxy.

## Why this happens

The inbound proxy enforces policy *before* dispatching to the application.
Relevant pieces:

- Error type `HttpRouteUnauthorized` in
  [linkerd/app/inbound/src/policy/http.rs:80-81](../../buoyant/buoyant-proxy/linkerd/app/inbound/src/policy/http.rs).
- Rescue handler converts it in
  [linkerd/app/inbound/src/http/server.rs:182-189](../../buoyant/buoyant-proxy/linkerd/app/inbound/src/http/server.rs).
- Synthesiser `permission_denied` in
  [linkerd/app/core/src/errors/respond.rs:138-146](../../buoyant/buoyant-proxy/linkerd/app/core/src/errors/respond.rs):

  ```rust
  pub fn permission_denied(msg: impl ToString) -> Self {
      Self {
          http_status: http::StatusCode::FORBIDDEN,
          grpc_status: tonic::Code::PermissionDenied,
          close_connection: false,
          ...
      }
  }
  ```

`close_connection: false` means the TLS session is kept open for re-use, a
403 won't tear down the connection pool the way a 502/504 does.

## Diagnose

```sh
# 1. Is there a Server resource capturing the port? Any policies?
kubectl -n sma get server.policy.linkerd.io,authorizationpolicy,\
meshtlsauthentication -o wide

# 2. What identities are allowed?
kubectl -n sma get meshtlsauthentication -o yaml | grep -A3 identities

# 3. What identity is the caller actually presenting?
kubectl -n sma exec deploy/sma-client -c client -- \
  curl -sv http://sma-server.sma.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< x-mesh-client-id'
# < x-mesh-client-id: sma-client.sma.serviceaccount.identity.linkerd.cluster.local

# 4. Cross-check: the SA the client pod is actually using.
kubectl -n sma get pod -l app=sma-client \
  -o jsonpath='{.items[0].spec.serviceAccountName}{"\n"}'
```

The mismatch between (2) and (3), "policy expects X, request presents Y",
is the diagnosis. Inbound proxy logs (above) also print both sides of the
mismatch on every denied request.

## Fix

Make the policy match the real client identity. Widen the authentication:

```sh
kubectl -n sma patch meshtlsauthentication only-nobody --type=merge -p '
spec:
  identities:
    - sma-client.sma.serviceaccount.identity.linkerd.cluster.local
'
```

Or, more realistically, give the client its own ServiceAccount and reference
that.

## Revert

```sh
kubectl -n sma delete authorizationpolicy sma-server-allow-nobody
kubectl -n sma delete meshtlsauthentication only-nobody
kubectl -n sma delete server.policy.linkerd.io sma-server-http
```
