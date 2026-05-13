# 02 — Outbound protocol-detection timeout (10 s hang)

The outbound proxy peeks at the first bytes of every TCP stream to decide
whether it's HTTP/1, HTTP/2 (gRPC), or opaque. If no bytes arrive within
~10 seconds, the proxy stops waiting, classifies the connection as
**opaque**, and forwards the bytes as raw TCP. The connection is **not**
closed — it's just delayed by the detection timeout.

This is the "server-speaks-first" / "neither side speaks" failure mode and
it's a common gotcha for protocols like SSH, IRC, or an unusual custom
port that isn't on the opaque-ports list. (Note: MySQL, SMTP, Postgres,
Redis, Memcached and a few others are already in Linkerd's
`default-opaque-ports` list, so they don't hit this in a default install.)

The cleanest way to *see* the timeout is to make an empty-payload TCP
connection from a meshed pod and watch the proxy log.

## Setup

Follow [00-setup.md](00-setup.md). Baseline should be green.

## Symptom

- A `kubectl debug ... nc playground-server-http-primary 8080 </dev/null`
  from inside a meshed client pod opens TCP instantly (handshake is with
  the *local outbound proxy*, not the destination), then sits idle for
  ~10 seconds before the proxy starts opaque-forwarding.
- The client-side outbound proxy logs `Detection::ReadTimeout(10s)`
  followed by `Continuing after timeout: 10s`.
- The server-side proxy receives the connection (via the transport
  header) but skips its own detection because the outbound proxy did not
  set a session-protocol hint, so there is no inbound timeout log to
  match.

This is invisible in the SMA UI because the Next.js client sends an HTTP
preamble immediately, which the proxy detects in microseconds. It's a
TCP-level demo done via `nc` from inside a meshed pod.

## Recreate

### 1. Turn on detect debug logging on the client proxy

```sh
kubectl port-forward -n playground deploy/playground-client 4191
curl -v --data 'linkerd=info,linkerd_http_detect=debug,linkerd_app_outbound=debug' -X PUT localhost:4191/proxy-log-level
```

### 2. Open a TCP-only connection from the meshed client, send no bytes

```sh
POD=$(kubectl get pod -n playground -l app=playground-client \
        -o jsonpath='{.items[0].metadata.name}')

kubectl debug -n playground "$POD" \
  --image=nicolaka/netshoot --profile=general --quiet -i -- \
  sh -c 'time timeout 15 nc -v playground-server-http-primary.playground.svc.cluster.local 8080 </dev/null'
```

You should see:

```
Command terminated by signal 15
real	0m 15.03s
user	0m 0.00s
sys	0m 0.00s
```

The full 15 s elapsed because that's what `timeout 15` killed `nc` 
at — *not* because the proxy waited 15 s. The proxy's own timeout 
fired at the 10 s mark, internally.

### 3. Confirm the 10 s timeout in the client proxy log

```sh
kubectl -n playground logs deploy/playground-client -c linkerd-proxy | grep -iE 'detect|timeout'
```

You should see lines like:

```
[  1267.198753s] DEBUG ThreadId(01) outbound:proxy{addr=10.43.163.235:8080}: linkerd_http_detect: Detected result=Ok(ReadTimeout(10s)) elapsed=10.001082629s
[  1267.198830s]  INFO ThreadId(01) outbound:proxy{addr=10.43.163.235:8080}: linkerd_app_outbound::protocol: Continuing after timeout: 10s
```

The `Continuing after timeout` line is the key one, the proxy did not
close the connection, it switched to the opaque (raw-TCP) handler and
kept forwarding.

### 4. (Optional) Confirm the server proxy skips detection

```sh
kubectl port-forward -n playground deploy/playground-server-http-primary 4191
curl -v --data 'linkerd=info,linkerd_http_detect=debug,linkerd_app_outbound=debug' -X PUT localhost:4191/proxy-log-level

# Re-run the nc stall, then:
kubectl -n playground logs deploy/playground-server-http-primary -c linkerd-proxy | grep -iE 'detect|timeout'
```

You will *not* see a `ReadTimeout` line on the inbound side. The
outbound proxy sent a transport header without a session-protocol hint,
and routes that straight to the opaque/forward stack, byte-level HTTP 
detection is skipped entirely.

You may see plenty of `Detected result=Ok(Http(HTTP/1)) elapsed=Xµs`
lines from the regular SMA traffic generator (each completing in
microseconds because real HTTP bytes arrive immediately). Those are
unrelated to the stalled `nc` connection.

### 5. Revert log levels

```sh
for d in playground-client playground-server-http-primary; do
  kubectl -n playground exec deploy/$d -c linkerd-proxy -- \
    curl -s --data 'warn,linkerd=info,hickory=error' \
    -X PUT localhost:4191/proxy-log-level
done
```

## Why this happens

The outbound proxy's protocol-detection timeout is 10 seconds by default
(`proxy.detect_protocol_timeout`). When the proxy accepts an outbound
TCP stream destined for a port whose outbound policy is `Detect`:

1. It does a single non-blocking read of up to 1024 bytes.
2. **If bytes arrive**: it matches them against the HTTP/2 preface
   (`PRI * HTTP/2.0`) or attempts an HTTP/1 parse with `httparse`.
   Decision in microseconds.
3. **If no bytes arrive within 10 s**: detection returns
   `Detection::ReadTimeout(10s)`. The proxy logs `Continuing after
   timeout: 10s` and falls through to the opaque stack, the connection
   is forwarded as raw TCP for the rest of its life.

The connection is **not** torn down. The peer (in this case `nc`) sees
no error; the only externally visible effect is that the first 10 s of
that connection produce no forwarded traffic.

Two real-world flavours of this failure:

- **Server-speaks-first protocols** (SSH, IRC, custom TCP). The server
  is ready to send a banner, but it can't, because the proxy is waiting
  for the client to speak. Both sides wait. After 10 s the proxy falls
  back to opaque and the banner finally gets through — but every new
  connection pays the 10 s.
- **Application is slow to send the first byte**: e.g. a thread-pool-
  starved HTTP server that's pinned and won't write the request line
  for > 10 s. The proxy gives up on HTTP, treats the stream as opaque,
  and forwards whatever eventually comes out — but per-request route
  features (timeouts, retries, metrics) are gone for that connection.

The fix in both cases is the same: mark the port as opaque so the proxy
skips detection and forwards bytes immediately. For HTTP services that
are merely slow at startup, the right fix is application-side, not mesh
config.

## Diagnose

```sh
# 1. Outbound/Inbound proxy logs show the ReadTimeout.
kubectl -n playground logs deploy/playground-client -c linkerd-proxy --tail=200 \
  | grep -iE 'detect|timed out|timeout'

# 2. Detect-timeout counter increments per stalled connection.
linkerd diagnostics proxy-metrics -n playground deploy/playground-client | grep -E 'detect.*(timeout|count|sum)' | head
```

## Fix

If the destination really is a server-speaks-first protocol, mark its
port opaque at workload-pod level (controls the inbound proxy's local policy):

```sh
kubectl -n playground annotate deploy playground-server-http-primary \
  config.linkerd.io/opaque-ports=8080 --overwrite
kubectl -n playground rollout restart deploy/playground-server-http-primary
```

## Revert

```sh
kubectl -n playground annotate svc playground-server-http \
  config.linkerd.io/opaque-ports- --overwrite || true
kubectl -n playground annotate deploy playground-server-http-primary \
  config.linkerd.io/opaque-ports- --overwrite || true
kubectl -n playground rollout restart deploy/playground-server-http-primary
```
