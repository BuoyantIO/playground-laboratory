# 03: `502` connection refused: Service targets the wrong port

A `502 Bad Gateway` from the outbound proxy means the proxy picked an endpoint
but failed at the TCP layer, most commonly the application isn't listening
on the port the Service says it is. Endpoints exist; the process behind them
refuses connections.

This is the failure mode that *doesn't* trigger failfast. There's a pod IP in
the endpoint slice, so the balancer thinks all is well until it actually
tries to dial.

## Setup

Follow [00-setup.md](00-setup.md). Baseline should be green.

## Symptom

- Client UI: every poll red `502`.
- Latency near-instant (~few ms, connect-refused is fast).
- `kubectl get endpointslices` shows endpoints. Pods are `Ready`.
- The server pod itself is fine. Its own `linkerd-proxy` is listening on
  `:4143` and the app is on `:8080`. The lie is in the Service spec.

## Recreate

Point the Service at a port nothing is listening on:

```sh
kubectl -n sma patch svc sma-server \
  --type=json \
  -p='[{"op":"replace","path":"/spec/ports/0/targetPort","value":9999}]'
```

The deployment only declares `containerPort: 8080`, so port 9999 ConnectionRefuses
every dial.

## What you'll see

Curl from the meshed client:

```sh
kubectl -n sma exec deploy/sma-client -c client -- \
  curl -sv -o /dev/null http://sma-server.sma.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< l5d'
```

```
< HTTP/1.1 502 Bad Gateway
< l5d-proxy-error: client error (Connect): Connection refused (os error 111)
< l5d-proxy-connection: close
```

`errno 111` is ECONNREFUSED, see
[linkerd/errno/src/lib.rs:111](../../buoyant/buoyant-proxy/linkerd/errno/src/lib.rs).

Outbound proxy logs (set `linkerd=debug` first if you want the dial line,
see [00-setup.md](00-setup.md)):

```sh
kubectl -n sma exec deploy/sma-client -c linkerd-proxy -- \
  curl -sS -X PUT -d 'linkerd=debug,info' http://localhost:4191/proxy-log-level
kubectl -n sma logs deploy/sma-client -c linkerd-proxy --tail=20
```

```
DEBUG outbound:proxy{addr=10.244.0.34:9999}: linkerd_proxy_transport::connect:
  Connecting...
WARN  outbound:rescue{...}: HTTP/1.1 request failed
  error=client error (Connect): Connection refused (os error 111)
```

Note the address `:9999`. The outbound proxy is dialling the destination
endpoint directly (mesh traffic redirects there from the inbound proxy on
:4143, but on the *outbound* side the proxy dials whatever the Service
declares).

## Why this happens

The outbound proxy resolves the Service to endpoint `10.244.0.34:9999`. It
dials. The kernel on the destination node replies with TCP RST because
nothing is bound to `:9999`. The proxy maps that `std::io::Error` (kind
`ConnectionRefused`) to a 502 via the rescue chain in
[linkerd/app/outbound/src/http/endpoint.rs:162-176](../../buoyant/buoyant-proxy/linkerd/app/outbound/src/http/endpoint.rs);
the synthesiser `bad_gateway`
([respond.rs:88-96](../../buoyant/buoyant-proxy/linkerd/app/core/src/errors/respond.rs))
fills in:

```rust
pub fn bad_gateway(msg: impl ToString) -> Self {
    Self {
        close_connection: true,
        http_status: http::StatusCode::BAD_GATEWAY,
        grpc_status: tonic::Code::Unavailable,
        ...
    }
}
```

Distinguishing `502` from `504`: a 502 says "I reached the network, the
network said no." A 504 says "I never got past the balancer / the response
never came back."

## Diagnose

```sh
# 1. Are there endpoints? (yes, that's what makes this a 502 not a 504)
linkerd diagnostics endpoints sma-server.sma.svc.cluster.local:8080

# 2. What port is the Service pointing at?
kubectl -n sma get svc sma-server -o jsonpath='{.spec.ports}' | jq

# 3. What ports is the pod listening on?
kubectl -n sma get pod -l app=sma-server \
  -o jsonpath='{.items[0].spec.containers[*].ports}' | jq

# 4. Confirm the dial fails:
kubectl -n sma exec deploy/sma-client -c linkerd-proxy -- \
  curl -v --max-time 2 http://sma-server.sma.svc.cluster.local:8080/ 2>&1 \
  | head -20
```

The mismatch between (2) and (3) is the smoking gun.

## Fix

Restore `targetPort` to `http` (the named port on the container):

```sh
kubectl -n sma patch svc sma-server \
  --type=json \
  -p='[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```

In real environments, the same mistake comes from: renamed container port the
Service never followed, a sidecar that hijacked the original port, or a
`containerPort` typo.

## Revert

```sh
helm upgrade sma helm/sma --reset-values
```
