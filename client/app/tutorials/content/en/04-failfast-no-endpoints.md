# 04 — `504` failfast: no ready endpoints

The classic "scaled to zero" demo. When the destination Service has zero ready
endpoints, the outbound load balancer enters **failfast**: requests fail
immediately with a `504` instead of buffering indefinitely.

This is the most-misdiagnosed Linkerd error in the wild. It looks like a
timeout, but the proxy isn't waiting on the server — it's waiting for an
endpoint to *exist*. This runbook is the canonical example.

> This error can also be caused by networking issues that prevent the
> establishment of TLS connections between the client and server proxies
> within the `config.linkerd.io/proxy-outbound-connect-timeout` window
> (default 1000 ms).

## Setup

Follow [00-setup.md](00-setup.md) for a fresh cluster, Linkerd Enterprise,
and the playground app. You should see green `200`s with `mTLS` badges in the
UI before proceeding.

## Symptom

- Client UI: every poll flips to red `504` within ~3 s.
- Latency drops to a flat ~3000 ms — the proxy is short-circuiting, not
  actually waiting on the server.
- The "mTLS" badge stays red/empty (no response to wrap), but importantly the
  topology banner turns red — the proxy is failing the call.

## Recreate

Scale **both** the primary and canary deployments to zero — leaving the
canary running would let kube-proxy keep routing successfully to it:

```sh
kubectl -n playground scale \
  deploy/playground-server-http-primary deploy/playground-server-http-canary \
  --replicas=0
```

Within a few seconds, every poll in the UI is `504`. 

## What you'll see

Client-side outbound proxy logs:

```sh
kubectl -n playground logs deploy/playground-client -c linkerd-proxy --tail=20
```

```
[    49.103125s]  INFO ThreadId(01) outbound:proxy{addr=10.43.38.167:8080}:service{ns=playground name=playground-server-http port=8080}: linkerd_proxy_balance_queue::worker: Unavailable; entering failfast timeout=3.0
[    49.103159s]  INFO ThreadId(01) outbound:proxy{addr=10.43.38.167:8080}:service{ns=playground name=playground-server-http port=8080}: linkerd_proxy_balance_queue::worker: Unavailable; entering failfast timeout=3.0
[    49.103164s]  INFO ThreadId(01) outbound:proxy{addr=10.43.38.167:8080}:service{ns=playground name=playground-server-http port=8080}: linkerd_proxy_balance_queue::worker: Unavailable; entering failfast timeout=3.0
[    49.103167s]  INFO ThreadId(01) outbound:proxy{addr=10.43.38.167:8080}:service{ns=playground name=playground-server-http port=8080}: linkerd_proxy_balance_queue::worker: Unavailable; entering failfast timeout=3.0
[    49.103266s]  INFO ThreadId(01) outbound:proxy{addr=10.43.38.167:8080}:rescue{client.addr=10.42.1.21:37866}: linkerd_app_core::errors::respond: HTTP/1.1 request failed error=logical service 10.43.38.167:8080: route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast error.sources=[route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast, backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast, Service.playground.playground-server-http:8080: service in fail-fast, service in fail-fast]
```

A direct curl from inside the meshed client confirms the response headers:

```sh
POD=$(kubectl get pod -n playground -l app=playground-client \
        -o jsonpath='{.items[0].metadata.name}')

kubectl debug -n playground "$POD" \
  --image=nicolaka/netshoot --profile=general --quiet -i -- \
  curl -sv -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< l5d'
```

```
< HTTP/1.1 504 Gateway Timeout
< l5d-proxy-error: logical service 10.43.38.167:8080: route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast
< l5d-proxy-connection: close
```

Proxy metrics:

```sh
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E 'failfast|endpoints'
```

```
outbound_http_balancer_endpoints{endpoint_state="ready",parent_group="core",parent_kind="Service",parent_namespace="playground",parent_name="playground-server-http",parent_port="8080",parent_section_name="",backend_group="core",backend_kind="Service",backend_namespace="playground",backend_name="playground-server-http",backend_port="8080",backend_section_name=""} 0
outbound_http_balancer_endpoints{endpoint_state="pending",parent_group="core",parent_kind="Service",parent_namespace="playground",parent_name="playground-server-http",parent_port="8080",parent_section_name="",backend_group="core",backend_kind="Service",backend_namespace="playground",backend_name="playground-server-http",backend_port="8080",backend_section_name=""} 0
outbound_http_errors_total{error="failfast"} 7
```

Endpoint membership from the destination controller's POV:

```sh
linkerd diagnostics endpoints playground-server-http.playground.svc.cluster.local:8080
```

```
No endpoints found.
```

## Why this happens

The outbound load balancer wraps each destination in a queue with a failfast
timeout:

> When the balancer has no available inner services, it goes into "failfast"
> — subsequent requests fail immediately rather than buffering indefinitely.

The default outbound HTTP failfast timeout is **3 seconds**, set by the
`DEFAULT_OUTBOUND_HTTP_FAILFAST_TIMEOUT` constant in the proxy. 
After 3 s with zero endpoints, the queue enters failfast and emits 
a `FailFastError` for every subsequent request, which the rescue 
handler turns into a synthetic 504 via `gateway_timeout`.

## Diagnose

```sh
# 1. Is the service empty?
linkerd diagnostics endpoints playground-server-http.playground.svc.cluster.local:8080
# Expected when broken: no rows.

# 2. Are there ready pods at all?
kubectl -n playground get pods -l app=playground-server-http
# READY=0/2 or no rows.

# 3. Confirm failfast, not a real timeout:
kubectl -n playground exec deploy/playground-client -c linkerd-proxy -- \
  curl -s http://localhost:4191/metrics \
  | grep -E 'failfast|endpoints'
# in_failfast=1, endpoints=0.

# 4. The 504 duration is ~3000ms (failfast default), not a multiple of
# server latency. That's the giveaway over a real timeout.
```

## Fix

Scale back up:

```sh
kubectl -n playground scale \
  deploy/playground-server-http-primary deploy/playground-server-http-canary \
  --replicas=1
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

The proxy notices the new endpoint within ~1 s and the balancer exits
failfast on the next request.

## Revert

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.8 --reset-values
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```
