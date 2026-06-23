# 03: Outbound connect-timeout exceeded (slow upstream handshake)

When the outbound proxy dials an upstream endpoint, it gives up if the
TCP handshake doesn't complete within
`config.linkerd.io/proxy-outbound-connect-timeout` (default **1 s**).
A common production cause is **network-induced latency**: the endpoint
is reachable and healthy, but the path to it is slow enough that the
handshake takes longer than the configured timeout.

## How the failure surfaces depends on the destination protocol

The same TCP-level cause produces very different observable symptoms
depending on whether the destination is treated as **HTTP** or as
**opaque TCP** by the outbound proxy. Both manifestations are covered
in this runbook because operators frequently encounter only one and
draw the wrong conclusion about how connect-timeouts behave.

| | HTTP destination | Opaque destination |
|---|---|---|
| Per-request response visible? | Yes (HTTP 503 / 504) | No (raw TCP, connection closes) |
| Direct `connect timed out after Xs` string visible in response? | **No**, masked by load-balancer cascade | n/a (no HTTP response) |
| Direct `connect timed out after Xs` string visible in proxy log? | **Rarely**, usually hidden by fail-fast errors | **Yes**: INFO log from `linkerd_app_core::serve` |
| Ground-truth metric? | `outbound_http_errors_total` | `outbound_http_errors_total` (still increments for the listener that synthesised the error) |

The opaque path is the one where you'll see the literal
`connect timed out after 1s` string in the proxy logs without
chasing it through metrics. For HTTP traffic, that string is
almost always swallowed by the balancer's fail-fast/load-shed
behaviour and you have to read metrics to prove the cause.

## Setup

Follow [00-setup.md](00-setup.md). Baseline should be green.

Three things make this demo cleanly reproducible:

1. **Pause the SMA Next.js polling** so the only outbound traffic is
   yours. Without this, the continuous polling traffic keeps the
   load-balancer's PeakEWMA score high enough to mask per-request
   errors behind a persistent fail-fast cascade.
2. **Use a *jittered* netem delay on the server**, not a flat one.
   A flat 2 s delay starves the server proxy's own control-plane
   traffic (identity, destination) and tips it into
   `PostStartHookError` because `linkerd-await` can't reach identity
   to bootstrap a cert.
3. **Run the demo with the default 1 s connect-timeout.** Don't raise
   it until the "fix" section, otherwise nothing times out.

## Symptoms (in two flavours)

### A) HTTP destination: cascade of 503 / 504, message string buried

- HTTP requests from the meshed client return a mix:
  - `200 OK` (connects that completed under 1 s)
  - `503 Service Unavailable` with
    `l5d-proxy-error: ... service unavailable` (load-shed at queue gate)
  - `504 Gateway Timeout` with
    `l5d-proxy-error: ... service in fail-fast` (no ready endpoint
    within the balancer's failfast deadline, ~3 s)
- `outbound_http_errors_total` for the destination climbs.
- `tcp_close_total` against the destination shows `errno=""` (not
  `ETIMEDOUT`), the proxy aborts the connect in userspace before the
  kernel TCP timeout fires, so there's no kernel-level errno to
  attribute.
- Proxy log periodically shows
  `linkerd_proxy_balance_queue::worker: Unavailable; entering failfast`
  at INFO. The connect-timeout error itself stays inside the balancer
  and is not logged separately.

### B) Opaque destination: log line includes the literal error string

- TCP connections to the destination close without flowing any data.
- Proxy log at **INFO** shows:
  ```
  linkerd_app_core::serve: Connection closed error=logical service **********: route default.opaq: concrete service **********: connect timed out after 1s error.sources=[route default.opaq: concrete service **********: connect timed out after 1s, concrete service **********: connect timed out after 1s, connect timed out after 1s] client.addr=********** server.addr=**********
  ```
- The literal `connect timed out after 1s` is in the log because the
  opaque path doesn't have an HTTP rescue layer to wrap or transform
  the error.

## Recreate

### 1. Pause SMA polling so the only traffic is yours

```sh
kubectl -n playground set env deploy/playground-client POLL_ENABLED=false
kubectl -n playground rollout status deploy/playground-client
```

### 2. Bind shell variables to the current pods

```sh
CLIENT_POD=$(kubectl get pod -n playground -l app=playground-client \
               -o jsonpath='{.items[0].metadata.name}')
SERVER_POD=$(kubectl get pod -n playground \
               -l app=playground-server-http,role=primary \
               -o jsonpath='{.items[0].metadata.name}')
```

### 3. Inject a jittered delay on the server pod

```sh
kubectl debug -n playground "$SERVER_POD" \
  --image=nicolaka/netshoot --profile=netadmin --quiet -i -- \
  tc qdisc add dev eth0 root netem delay 600ms 500ms   
```

This produces a uniform delay in `[600 ms, 500 ms]`. About 40 % of
egress packets (including SYN-ACKs) exceed the 1 s connect-timeout
boundary; the rest complete in time. The base 600 ms is comfortably
under 1 s so the server proxy's own control-plane traffic (identity,
destination) survives, no `PostStartHookError`.

> **Don't use a flat 2 s delay here.** That breaks the server
> proxy's bootstrap because identity calls hit the same delay and
> exceed the proxy's own 1 s connect-timeout. The pod ends up in
> `PostStartHookError` on startup and the whole demo grinds to a
> halt.

Verify it's in place:

```sh
kubectl debug -n playground "$SERVER_POD" \
  --image=nicolaka/netshoot --profile=netadmin --quiet -i -- \
  tc qdisc show dev eth0
# qdisc netem 8009: root refcnt 19 limit 1000 delay 600ms  600ms seed 12135109073341622588
```

## Scenario A: HTTP destination (cascade)

### Generate failing traffic

```sh
for i in {1..30}; do
  result=$(kubectl debug -n playground "$CLIENT_POD" \
    --image=nicolaka/netshoot --profile=general --quiet -i -- \
    curl -s -o /dev/null -D - \
      http://playground-server-http-primary.playground.svc.cluster.local:8080/ \
    2>/dev/null \
    | grep -E '^HTTP/|^l5d-proxy-error:' \
    | tr -d '\r' | tr '\n' ' ')
  echo "[$i] $result"
done
```

Expected mix:

```
[1]  HTTP/1.1 200 OK
[2]  HTTP/1.1 504 Gateway Timeout  l5d-proxy-error: ... service in fail-fast
[3]  HTTP/1.1 503 Service Unavailable  l5d-proxy-error: ... service unavailable
[4]  HTTP/1.1 200 OK
[5]  HTTP/1.1 504 Gateway Timeout  l5d-proxy-error: ... service in fail-fast
...
```

The literal `connect timed out after 1s` is **not** in any of these
responses. It's been transformed by the balancer's load-shedding /
fail-fast machinery before reaching the HTTP rescue layer.

### Prove connect-timeout is the cause from metrics

```sh
# Catalogue the metrics this proxy exposes
linkerd diagnostics proxy-metrics -n playground pod/"$CLIENT_POD" \
  | grep -E '^# (HELP|TYPE) outbound_http_(errors|route_request)' | head

# The smoking gun: error count attributed to the primary backend
linkerd diagnostics proxy-metrics -n playground pod/"$CLIENT_POD" \
  | grep '^outbound_http_errors_total' \
  | grep 'parent_name="playground-server-http-primary"'

# Same evidence at the response-status layer
linkerd diagnostics proxy-metrics -n playground pod/"$CLIENT_POD" \
  | grep '^outbound_http_route_request_statuses' \
  | grep -E 'http_status="(50[34])"'
```

Both counters climb in proportion to the failing curls. The HTTP
error count is the proxy-level ground truth: every increment is one
request that the outbound proxy synthesised an error response for,
because no successful upstream connection could be established within
the connect-timeout.

### Why no `errno="ETIMEDOUT"` on tcp_close_total

```sh
linkerd diagnostics proxy-metrics -n playground pod/"$CLIENT_POD" \
  | grep 'tcp_close_total' \
  | grep 'authority="playground-server-http-primary'
```

You'll see closes against the primary destination, but **all with
`errno=""`**. That's because Linkerd's connect-timeout is enforced
by a Tokio timer wrapping the connect call from userspace, when
the timer fires (at 1 s), the proxy aborts the pending connect
itself. The kernel never gets to its own TCP timeout (~21 s by
default), so there's no `ETIMEDOUT` errno to record. This is a
useful tell: a destination with `tcp_close_total` increments and
all `errno=""` plus rising `outbound_http_errors_total` is the
fingerprint of proxy-level connect-timeouts.

### Why the user-facing error rotates between 503 and 504

The outbound load balancer has two states beyond "healthy" that map
to two different HTTP errors:

- **Queue gate Shut** → request is load-shed → **503**
  (`linkerd_app_core::errors::respond: service unavailable`).
- **Queue waited `failfast_timeout` (3 s) for a ready endpoint, gave up**
  → **504** (`linkerd_proxy_balance_queue::worker: Unavailable;
  entering failfast`).

Both are downstream of the same cause (the endpoint can't establish
connections within 1 s), but which one you get depends on the
balancer's internal state at the moment your request arrives. In
practice an operator sees both interleaved.

## Scenario B: Opaque destination (direct log line)

Same network slowdown, same connect-timeout, but the destination is
now marked as opaque. The outbound proxy bypasses the HTTP balancer
and treats the connection as raw TCP, so the connect-timeout error
isn't wrapped. It goes straight into the connection-closed log line.

### 1. Mark the destination port as opaque

```sh
kubectl -n playground annotate svc playground-server-http-primary \
  config.linkerd.io/opaque-ports="8080" --overwrite
```

The policy controller picks this up within a few seconds and tells
the outbound proxy to use the opaque route for connections to this
Service.

### 2. Open a raw TCP connection from the client

`nc -z` (zero-I/O) just establishes TCP and exits. Loop a handful so
the ~30 % timeout rate produces some failures:

```sh
for i in {1..15}; do
  echo "[$i] $(kubectl debug -n playground "$CLIENT_POD" \
    --image=nicolaka/netshoot --profile=general --quiet -i -- \
    sh -c 'time nc -zv -w 2 playground-server-http-primary.playground.svc.cluster.local 8080 2>&1' \
    | grep -E 'succeeded|timed|real')"
done
```

### 3. Read the proxy log

```sh
kubectl logs -n playground "$CLIENT_POD" -c linkerd-proxy --tail=200 \
  | grep 'connect timed out'
```

You should see (formatted for readability, the real log is one line):

```
INFO ThreadId(02) outbound: linkerd_app_core::serve: Connection closed
  error=logical service 10.43.58.32:8080:
        route default.opaq:
          concrete service playground-server-http-primary.playground.svc.cluster.local:8080:
            connect timed out after 1s
  error.sources=[route default.opaq: ... connect timed out after 1s,
                 concrete service ...: connect timed out after 1s,
                 connect timed out after 1s]
  client.addr=127.0.0.1:NNNN  server.addr=10.43.58.32:8080
```

The literal `connect timed out after 1s` is plainly visible. This is
the same shape of log line you'll see from a customer running, say,
a TCP-protocol database or a custom opaque service whose port is in
their `opaque-ports` annotation.

### Why opaque shows the string but HTTP doesn't

For HTTP destinations, the connect-timeout error flows up to the
balancer's queue. The queue's failfast/load-shed logic converts it
into a separate error type (`FailFastError` or load-shed) that no
longer has `ConnectTimeout` in its cause chain, so the HTTP rescue
handler (which matches on `is_caused_by::<ConnectTimeout>`) never
fires. The user sees `service in fail-fast` / `service unavailable`.

For opaque destinations, there's no HTTP rescue and no
HTTP-balancer-queue between the connect attempt and the
`linkerd_app_core::serve` listener. The error from the failed connect
propagates directly to where the listener decides to close the
connection, and at that point it's logged with the full error chain
intact.

## Fix

Same annotation works for both manifestations. Set it on the
**client** Deployment (the proxy doing the dialing), then roll the
pods so the proxy-injector renders the new env value into the
`linkerd-proxy` container.

```sh
kubectl -n playground annotate deploy playground-client \
  config.linkerd.io/proxy-outbound-connect-timeout=3s --overwrite

kubectl -n playground rollout restart deploy/playground-client
kubectl -n playground rollout status deploy/playground-client

# Re-bind to the new pod
CLIENT_POD=$(kubectl get pod -n playground -l app=playground-client \
               -o jsonpath='{.items[0].metadata.name}')

# Verify the env var
kubectl -n playground get pod "$CLIENT_POD" \
  -o jsonpath='{range .spec.containers[?(@.name=="linkerd-proxy")].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -i outbound_connect_timeout
# LINKERD2_PROXY_OUTBOUND_CONNECT_TIMEOUT=3s
```

### Verify the fix

For HTTP traffic, the 503/504 cascade clears:

```sh
for i in {1..20}; do
  kubectl debug -n playground "$CLIENT_POD" \
    --image=nicolaka/netshoot --profile=general --quiet -i -- \
    curl -s -o /dev/null \
      -w '%{http_code} elapsed=%{time_total}s\n' \
      http://playground-server-http-primary.playground.svc.cluster.local:8080/
done
# All "200 elapsed=~1-2s", slow but successful.
```

For opaque traffic, the `connect timed out` log line stops appearing:

```sh
for i in {1..15}; do
  kubectl debug -n playground "$CLIENT_POD" \
    --image=nicolaka/netshoot --profile=general --quiet -i -- \
    sh -c 'nc -zv -w 5 playground-server-http-primary.playground.svc.cluster.local 8080 2>&1' \
    | grep -E 'succeeded|timed'
done
kubectl logs -n playground "$CLIENT_POD" -c linkerd-proxy --tail=100 \
  | grep 'connect timed out' | wc -l
# 0 new lines after the rollout
```

### When NOT to raise the timeout

Raising the connect-timeout is the right answer only when the path
is **slow but healthy**. If the path is broken (NetworkPolicy drop,
dead node, firewall RST-then-drop), raising the timeout doesn't
change the outcome. Every request still fails, just after a longer
wait.

Differential diagnostic:

- Raise the timeout, redeploy.
- If requests now succeed (slowly) → path was slow-but-healthy, this
  is the right fix.
- If requests still fail with `connect timed out after <new value>`
  in the opaque log or the same 503/504 cascade on HTTP → path is
  broken; fix the network or remove the bad endpoint instead.

## Diagnose checklist

```sh
# 1. Confirm the proxy's configured connect-timeout
kubectl -n playground get pod -l app=playground-client \
  -o jsonpath='{range .items[0].spec.containers[?(@.name=="linkerd-proxy")].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -i outbound_connect_timeout

# 2. HTTP-side evidence: proxy errors attributed to the destination
linkerd diagnostics proxy-metrics -n playground pod/"$CLIENT_POD" \
  | grep '^outbound_http_errors_total' \
  | grep 'parent_name="playground-server-http-primary"'

# 3. HTTP-side evidence: status-code rollup
linkerd diagnostics proxy-metrics -n playground pod/"$CLIENT_POD" \
  | grep '^outbound_http_route_request_statuses' \
  | grep -E 'http_status="(50[34])"'

# 4. Opaque-side evidence: the connect-timed-out log line
kubectl logs -n playground "$CLIENT_POD" -c linkerd-proxy --tail=300 \
  | grep 'connect timed out'

# 5. Network-path proof: ping latency from inside the client netns
kubectl -n playground exec deploy/playground-client -c client -- \
  sh -c 'apk add --no-cache iputils >/dev/null 2>&1; \
         ping -c 3 -W 5 playground-server-http-primary.playground.svc.cluster.local'
# Should show RTT in the 800ms-1300ms range when the netem is in place.

# 6. tc qdisc on the server (the cause)
kubectl debug -n playground "$SERVER_POD" \
  --image=nicolaka/netshoot --profile=netadmin --quiet -i -- \
  tc qdisc show dev eth0
```

## Revert

```sh
# Remove the netem from the server
kubectl debug -n playground "$SERVER_POD" \
  --image=nicolaka/netshoot --profile=netadmin --quiet -i -- \
  tc qdisc del dev eth0 root

# Remove the connect-timeout override on the client
kubectl -n playground annotate deploy playground-client \
  config.linkerd.io/proxy-outbound-connect-timeout- --overwrite || true

# Remove the opaque-ports annotation (only if you applied Scenario B)
kubectl -n playground annotate svc playground-server-http-primary \
  config.linkerd.io/opaque-ports- --overwrite || true

# Re-enable SMA polling
kubectl -n playground set env deploy/playground-client POLL_ENABLED-

# Roll the client to pick up annotation + env changes
kubectl -n playground rollout restart deploy/playground-client
kubectl -n playground rollout status deploy/playground-client
```

Confirm the qdisc and policy are gone:

```sh
kubectl debug -n playground "$SERVER_POD" \
  --image=nicolaka/netshoot --profile=netadmin --quiet -i -- \
  tc qdisc show dev eth0
# qdisc noqueue 0: root refcnt 2   (the default, no netem)

kubectl -n playground get svc playground-server-http-primary -o yaml \
  | grep -i opaque
# (nothing, the annotation is gone)
```

## Real-world patterns that produce this

- **Cross-AZ or cross-region calls** with WAN latency, especially after
  a multicluster failover that lands traffic on a more distant cluster.
- **Overloaded CNI / datapath**: a node under memory pressure with a
  slow kernel network stack, or a misconfigured eBPF program adding
  per-packet overhead.
- **Loaded VPN or NAT gateway** on the path to an off-cluster destination
  (databases, third-party APIs).
- **Sidecar contention on the destination**: the destination pod's
  proxy is CPU-starved and slow to accept the inbound TLS handshake.
  This manifests the same way from the outbound side, connect-timeout
  expires before the TLS handshake completes, even though the network
  path itself is fast.

## Key takeaways

- The connect-timeout enforced by `proxy-outbound-connect-timeout` is
  a proxy-level Tokio timer, not the kernel TCP timeout. That's why
  `tcp_close_total` records `errno=""` rather than `ETIMEDOUT`.
- For **HTTP destinations**, the connect-timeout cascades into 503
  (load-shed) and 504 (fail-fast) responses; the literal
  `connect timed out` string is **not** in the response or the per-
  request log. Use `outbound_http_errors_total` and the
  `outbound_http_route_request_statuses` per-status counter as proof.
- For **opaque destinations**, the connect-timeout produces an INFO
  log line from `linkerd_app_core::serve` that includes
  `connect timed out after Xs` in the error chain. If a customer
  shares that exact log line, their destination port is opaque (check
  their Service / namespace annotations for `config.linkerd.io/opaque-ports`
  or membership in the cluster-default opaque-ports list).
- Raise the annotation only if the network path is slow-but-healthy.
  If raising it doesn't restore traffic, the path is broken and the
  fix lives elsewhere (NetworkPolicy, endpoint health, firewall, etc.).
