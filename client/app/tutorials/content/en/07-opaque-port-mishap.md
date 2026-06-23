# 07 - HTTP port mis-marked opaque silently disables routing

Linkerd's protocol detection inspects the first bytes of each connection to classify traffic as HTTP/1, HTTP/2 (gRPC), or opaque TCP. The `config.linkerd.io/opaque-ports` annotation overrides this, which is useful for server-speaks-first protocols (MySQL, SMTP, etc.), but **marking an HTTP/gRPC port as opaque** silently breaks HTTPRoutes, Layer 7 metrics, and AuthorizationPolicy.

Status codes keep returning `200`. What you've lost:

- Per-route HTTP metrics on the proxy.
- HTTPRoute-based timeouts and retries.
- AuthorizationPolicy at the route layer.
- The `l5d-client-id` header the inbound proxy normally injects on meshed HTTP calls. mTLS still occurs at the TCP layer (`tls="true"` on every `tcp_open_total` row), but apps that surface mTLS identity from that header will report it as missing.

In the playground, this is visible in the UI: the server reads `l5d-client-id` and forwards it as `X-Mesh-Client-Id` on the response. Under opaque-ports, that header is empty and the mTLS badge flips to **plain**. In apps without that indirection the badge stays green and the failure is silent, which is the variant most teams hit in production.

## Setup

Follow [00-setup.md](00-setup.md) for a fresh cluster, Linkerd Enterprise, and the playground app. Confirm green `200`s with `mTLS` badges in the UI before proceeding.

## Symptom

- Client UI: status code stays `200`, latency normal.
- **mTLS badge flips to `plain`**: playground-specific signal (the server reads `l5d-client-id`); in a typical workload the badge stays green and the failure is silent.
- Outbound `request_total{authority="playground-server-http..."}` stops incrementing on the client proxy, even as polls continue.
- Previously-working HTTPRoute timeouts/retries silently no-op.

## Where the annotation lives

`config.linkerd.io/opaque-ports` can be set in three places, each affecting a *different* side of the connection.

| Annotation on… | Read by | Effects |
|---|---|---|
| **Workload pod template** (`spec.template.metadata.annotations`) | The proxy-injector at admission time. Becomes `LINKERD2_PROXY_INBOUND_PORTS_DISABLE_PROTOCOL_DETECTION` on the injected sidecar. | Only the **server's inbound** proxy. The server stops parsing HTTP for that port: no `l5d-client-id` header injected, no `inbound_http_request_total`, inbound HTTPRoute/AuthorizationPolicy at the HTTP layer bypassed. **Outbound callers are unaffected** unless they resolve directly to the pod IP (unusual for Service-FQDN traffic). |
| **Service** (`metadata.annotations`) | The destination controller, which publishes the result in the outbound policy (`protocol.Kind: Opaque`). | All **outbound callers** of that Service. Outbound proxies skip HTTP detection and route bytes through the opaque path: no `request_total` for that authority, Service-attached HTTPRoute and outbound HTTP-layer policy bypassed. The server's inbound proxy is unaffected unless its *own* annotation says otherwise. |
| **Namespace** | The proxy-injector at admission time, as a default for pods that don't set the annotation themselves. | Cascades **only to pods** in the namespace, same effect as the pod-template row above for every pod that doesn't override. **Services do not inherit it**: the destination controller reads each Service's own annotations and falls back to the cluster-wide `--default-opaque-ports` flag, never the namespace. |

A common problem: teams annotate the **pod** for a server-speaks-first port but never touch the **Service**. Outbound callers keep parsing HTTP and show per-route metrics, while server-side HTTPRoute rules silently fail to fire and the platform team's AuthorizationPolicy quietly no-ops. The reverse is equally common: annotating the **Service** for an HTTP port "to disable detection for performance" silently strips outbound HTTP visibility from every caller while server-side metrics keep working.

The fix is always the same: decide which side needs to be opaque (or both), and annotate accordingly.

## Recreate

### 1. Opaque port on the Service

Annotating the Service tells **every outbound caller** to skip HTTP detection for this Service+port. The destination controller picks up the annotation and publishes `protocol.Kind: Opaque` in the outbound policy; outbound proxies then route bytes as opaque TCP. The server's inbound proxy is unaffected: it still parses HTTP and injects `l5d-client-id`.

Before changing anything, inspect the policy:

```
linkerd diagnostics policy -n playground svc/playground-server-http 8080 \
  | head -20                                     
```

```
metadata:
  Kind:
    Resource:
      group: core
      kind: Service
      name: playground-server-http
      namespace: playground
      port: 8080
protocol:
  Kind:
    Detect:
      http1:
        routes:
        - metadata:
            Kind:
              Default: http
          rules:
          - backends:
              Kind:
                FirstAvailable:
```

The `Detect` block means the outbound proxy will detect the protocol.

Now apply:

```sh
kubectl -n playground annotate svc playground-server-http \
  config.linkerd.io/opaque-ports=8080 --overwrite

kubectl -n playground rollout restart deploy/playground-client
kubectl -n playground rollout status  deploy/playground-client
```

**Verify on the control plane** that the announced protocol flipped from `Detect` to `Opaque`:

```sh
linkerd diagnostics policy -n playground svc/playground-server-http 8080 \
  | head -20
```

```
metadata:
  Kind:
    Resource:
      group: core
      kind: Service
      name: playground-server-http
      namespace: playground
      port: 8080
protocol:
  Kind:
    Opaque:
      routes:
      - metadata:
          Kind:
            Default: opaq
        rules:
        - backends:
            Kind:
              FirstAvailable:
                backends:
```

**Verify on the data plane**: no HTTP request counter should exist for this authority on the client's outbound proxy:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E '(request_total|tcp_open_total).*authority="playground-server-http'
```

```
tcp_open_total{direction="outbound",peer="dst",authority="playground-server-http.playground.svc.cluster.local:8080",target_addr="10.42.0.31:8080",target_ip="10.42.0.31",target_port="8080",tls="true",server_id="playground-server-http-primary.playground.serviceaccount.identity.linkerd.cluster.local",dst_control_plane_ns="linkerd",dst_deployment="playground-server-http-primary",dst_namespace="playground",dst_pod="playground-server-http-primary-8469756977-bc2p7",dst_pod_template_hash="8469756977",dst_service="playground-server-http",dst_serviceaccount="playground-server-http-primary",dst_zone="",dst_zone_locality="unknown"} 1
tcp_open_total{direction="outbound",peer="dst",authority="playground-server-http.playground.svc.cluster.local:8080",target_addr="10.42.1.34:8080",target_ip="10.42.1.34",target_port="8080",tls="true",server_id="playground-server-http-canary.playground.serviceaccount.identity.linkerd.cluster.local",dst_control_plane_ns="linkerd",dst_deployment="playground-server-http-canary",dst_namespace="playground",dst_pod="playground-server-http-canary-58f9b599f8-9mtxs",dst_pod_template_hash="58f9b599f8",dst_service="playground-server-http",dst_serviceaccount="playground-server-http-canary",dst_zone="",dst_zone_locality="unknown"} 1
```

The signature is that **no `request_total` rows for this authority exist at all**: the proxy never instantiated the HTTP balancer, so no Prometheus series was created. Only `tcp_open_total` remains, pinned at 1 due to HTTP/1 keepalive.

**What you see in the UI**:

- Status code stays `200`, latency normal.
- mTLS badge **stays green**: the server's inbound proxy is still in HTTP mode (no pod annotation), so it still injects `l5d-client-id`, surfaced as `X-Mesh-Client-Id`.

**Bonus check: HTTPRoute-layer policy is bypassed too.** Apply a 1 ms timeout with 2 s of server-side latency; the timeout should fire but won't, because the outbound proxy is not running the HTTP stack that HTTPRoute attaches to:

```sh
kubectl apply -f - <<'EOF'
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: playground-server-http-timeout
  namespace: playground
spec:
  parentRefs:
    - name: playground-server-http
      kind: Service
      group: ""
      port: 8080
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      timeouts:
        request: 1ms
EOF

helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0 --reuse-values \
  --set http.primary.env.LATENCY_MS=2000 \
  --set http.canary.env.LATENCY_MS=2000
```

A 1 ms timeout against a 2 s server should fire. Under opaque it doesn't: the request takes 2 s and succeeds.

Before moving on to case 2, undo the changes so the two cases stay independent:

```sh
kubectl -n playground annotate svc playground-server-http \
  config.linkerd.io/opaque-ports- --overwrite || true
kubectl -n playground delete httproute playground-server-http-timeout --ignore-not-found
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0 --reuse-values \
  --set http.primary.env.LATENCY_MS=0 \
  --set http.canary.env.LATENCY_MS=0
kubectl -n playground rollout restart deploy/playground-client
```

### 2. Opaque port on the Deployment

Annotating the pod template flips only the **server's own inbound proxy**. The proxy-injector reads the annotation at admission time and sets `LINKERD2_PROXY_INBOUND_PORTS_DISABLE_PROTOCOL_DETECTION=8080` on the sidecar. The destination controller is uninvolved; outbound callers never learn the port is opaque.

Annotate both backends: each pod's inbound proxy decides independently based on its own annotation, so leaving one in HTTP mode produces inconsistent behavior across endpoints, with half of requests still parsed as HTTP server-side:

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0 --reuse-values \
  --set-string 'http.primary.podAnnotations.config\.linkerd\.io/opaque-ports=8080' \
  --set-string 'http.canary.podAnnotations.config\.linkerd\.io/opaque-ports=8080'
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

**Verify the sidecar picked up the env var**:

```sh
POD=$(kubectl get -n playground  pod -l app=playground-server-http -o jsonpath='{.items[0].metadata.name}')
kubectl describe pod -n playground $POD \
  | grep DISABLE_PROTOCOL
# LINKERD2_PROXY_INBOUND_PORTS_DISABLE_PROTOCOL_DETECTION:   8080
```

**Verify the control plane is still announcing `Detect`**: the Service is not annotated, so outbound callers are unaffected:

```sh
linkerd diagnostics policy -n playground svc/playground-server-http 8080 \
  | head -20
```

```
metadata:
  Kind:
    Resource:
      group: core
      kind: Service
      name: playground-server-http
      namespace: playground
      port: 8080
protocol:
  Kind:
    Detect:
      http1:
        routes:
        - metadata:
            Kind:
              Default: http
          rules:
          - backends:
              Kind:
                FirstAvailable:
```

**Verify on the data plane**: client side still parsing HTTP, server side no longer:

```sh
# Client outbound is still counting HTTP requests:
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E 'request_total.*authority="playground-server-http'

# Server inbound is frozen on the HTTP counter:
POD=$(kubectl get -n playground  pod -l app=playground-server-http -o jsonpath='{.items[0].metadata.name}')
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E 'request_total.*direction="inbound".*target_port="8080"'
```

The client side keeps climbing; the server side stops at the value it held when the annotation took effect.

**What you see in the UI**:

- Status code stays `200`, latency normal.
- mTLS badge **flips to `plain`**: the server's inbound proxy no longer injects `l5d-client-id`, so `X-Mesh-Client-Id` on the response is empty. This is a playground-specific signal (the app surfaces the header directly); in a typical workload it would be silent.
- Any inbound HTTPRoute or AuthorizationPolicy attached to the server's HTTP layer silently no-ops on this port. Outbound HTTPRoutes (the common case, with `parentRefs: Service`) **still apply**, because the Service is not annotated and the client's outbound proxy is still in HTTP mode.

## Why this happens

Each proxy decides whether to parse HTTP from two inputs:

1. **Local config**: the injector reads the workload's annotations (falling back to the namespace's) and sets `LINKERD2_PROXY_INBOUND_PORTS_DISABLE_PROTOCOL_DETECTION` on the sidecar ([linkerd/app/src/env.rs:192-193](../../buoyant/buoyant-proxy/linkerd/app/src/env.rs)). This is the **inbound** proxy's source of truth.
2. **Discovery**: the outbound proxy queries the destination controller, which reads each Service's own annotation (with a cluster-wide fallback from `--default-opaque-ports`, *not* the namespace) and publishes `protocol.Kind: Opaque` or `Detect` per Service+port.

When a port is opaque, the proxy on that side:

- Skips HTTP protocol detection.
- Routes bytes as TCP, end-to-end.
- Emits TCP-only metrics; no `request_total` series is created for that destination.
- Bypasses HTTPRoute and HTTP-layer AuthorizationPolicy.

mTLS is unaffected: it sits below the HTTP layer. Proxies still negotiate TLS at connection time and `tls="true"` remains on `tcp_open_total`. Anything that depends on HTTP-layer plumbing (routes, retries, the `l5d-client-id` header, per-route metrics) is gone for the side switched to opaque. When only one side is switched, that side loses HTTP plumbing while the other's still works, which is the most common debugging trap.

Policy updates from the destination controller are pushed to outbound proxies in near-real-time, but **existing connections keep their original protocol decision**: the proxy does not tear down live HTTP/2 channels to re-decide. A `kubectl rollout restart` on the caller forces fresh connections under the new policy.

## Diagnose

```sh
# 1. What protocol is the destination controller announcing for this port?
#    The fastest, most authoritative check.
linkerd diagnostics policy -n playground svc/playground-server-http 8080 \
  | head -20
# `protocol.Kind: Detect: { http1, http2 }` = HTTP path, healthy.
# `protocol.Kind: Opaque: { ... }`           = the port has been marked opaque.

# 2. Where did "opaque" come from - pod, Service, or namespace?
kubectl -n playground get pod -l app=playground-server-http \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.annotations.config\.linkerd\.io/opaque-ports}{"\n"}{end}'
kubectl -n playground get svc playground-server-http \
  -o jsonpath='{.metadata.annotations.config\.linkerd\.io/opaque-ports}{"\n"}'
kubectl get ns playground \
  -o jsonpath='{.metadata.annotations.config\.linkerd\.io/opaque-ports}{"\n"}'

# 3. What ports does the server's inbound proxy actually treat as opaque?
kubectl -n playground exec deploy/playground-server-http-primary -c linkerd-proxy -- env \
  | grep -E 'OPAQUE|DISABLE_PROTOCOL'

# 4. Data-plane confirmation: no `request_total` series for this authority
#    on the client's outbound proxy.
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E '(request_total|tcp_open_total).*authority="playground-server-http'
# Only tcp_open_total lines = opaque. request_total lines also present = still HTTP.

# 5. HTTPRoute does/doesn't enforce. Apply a tight timeout (above). If
# requests still succeed at >timeout latency, HTTP policy is being bypassed.
```

## Fix

Drop the annotation and roll:

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0 --reset-values
kubectl -n playground annotate svc playground-server-http \
  config.linkerd.io/opaque-ports- --overwrite || true
kubectl -n playground rollout restart \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
kubectl -n playground delete httproute playground-server-http-timeout --ignore-not-found
```

Opaque ports are correct for server-speaks-first protocols (MySQL `3306`, Postgres `5432`, Redis `6379`, SMTP `25`). HTTP/1, HTTP/2, and gRPC ports should **never** be marked opaque.

## Revert

(Same as Fix.)
