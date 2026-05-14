# 05 — App-injected `503` (not a mesh problem)

The most common false positive in mesh debugging: a 503 that came from the
**application**, not the mesh. This runbook is the diagnostic baseline —
once you can spot an app-generated error vs. a proxy-synthesised one, every
subsequent runbook becomes "compare to this".

## Setup

Follow [00-setup.md](00-setup.md) for a fresh cluster, Linkerd Enterprise,
and the playground app. You should see green `200`s with `mTLS` badges in the
UI before proceeding.

## Symptom

- Client UI: stream of red `503` status pills, `mTLS` badge stays green.
- Success rate drops to roughly `100 − ERROR_RATE`%.
- "Body" column on each row shows `injected error 503`.

## Recreate

Flip 100% of responses to 503 on **both** the primary and canary backends
via helm — otherwise kube-proxy keeps half the requests hitting a healthy
canary:

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.7 --reuse-values \
  --set http.primary.env.ERROR_RATE=100 \
  --set http.primary.env.ERROR_CODE=503 \
  --set http.canary.env.ERROR_RATE=100 \
  --set http.canary.env.ERROR_CODE=503
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

## What you'll see

Server application logs — the **only** place the 503 appears as a deliberate
event:

```sh
kubectl -n playground logs deploy/playground-server-http-primary -c server --tail=20
```

```
2026/05/14 04:53:33 503 Service Unavailable — request 1, version=v1, latency 0ms, client-id="playground-client.playground.serviceaccount.identity.linkerd.cluster.local"
2026/05/14 04:53:34 503 Service Unavailable — request 2, version=v1, latency 0ms, client-id="playground-client.playground.serviceaccount.identity.linkerd.cluster.local"
```

Note `client-id="playground-client.playground..."` — mTLS is working, the
proxy intercepted the request and forwarded the verified caller identity.
That's the visual cue this isn't a mesh problem.

Server-side proxy logs, nothing interesting:

```sh
kubectl -n playground logs deploy/playground-server-http-primary -c linkerd-proxy --tail=20
```

The proxy is transparent here. It accepted the request, dispatched to the
app, relayed the response. No `l5d-proxy-error` was added.

Confirm by hitting the server through the meshed client pod:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl -n playground debug "$POD" --image=curlimages/curl --profile=general --quiet -i -- \
  curl -sv http://playground-server-http.playground.svc.cluster.local:8080/ 2>&1 | tail -15
```

```
> Accept: */*
* Request completely sent off
injected error 503
< HTTP/1.1 503 Service Unavailable
< x-app-version: v1
< x-mesh-client-id: playground-client.playground.serviceaccount.identity.linkerd.cluster.local
< x-request-count: 65
< x-served-by: playground-server-http-primary-9d9566587-xhsrl
< date: Thu, 14 May 2026 04:54:47 GMT
< content-length: 19
< content-type: text/plain; charset=utf-8
< 
{ [19 bytes data]
* Connection #0 to host playground-server-http.playground.svc.cluster.local:8080 left intact
```

**`l5d-proxy-error` is absent**. The proxy passed the app's response through
untouched. `x-mesh-client-id` is *present*, proving mTLS happened.

## Why this happens

This is not a proxy-generated response. The proxy only synthesises an error
response when *it* fails, connect refused, failfast, identity mismatch, and
so on. A *successful* HTTP transaction that happens to carry a 5xx status
code from the application doesn't match any of those failure modes, so the
proxy leaves the response alone.

## Diagnose

The "is it the app or the mesh?" decision tree:

1. **Curl through a meshed peer with `-v`.** Look for `l5d-proxy-error` on
   the response. Absent on a 5xx ⇒ app produced it.

  ```sh
  POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
  kubectl -n playground debug "$POD" --image=curlimages/curl --profile=general --quiet -i -- \
    curl -sv http://playground-server-http.playground.svc.cluster.local:8080/ 2>&1 | grep -E '< HTTP|< l5d|< x-'
  ```

  ```
  < HTTP/1.1 503 Service Unavailable
  < x-app-version: v1
  < x-mesh-client-id: playground-client.playground.serviceaccount.identity.linkerd.cluster.local
  < x-request-count: 65
  < x-served-by: playground-server-http-primary-9d9566587-xhsrl
  ```

  No `l5d-proxy-error` header in this output. That's the signature of an
  app-produced 5xx.

2. **Check proxy metrics.** Proxy-synthesised errors increment counters with
   distinct `error="..."` labels; app errors increment plain
   `response_total` rows with `classification="failure"` and no `error`
   label:

   ```sh
   linkerd diagnostics proxy-metrics -n playground deploy/playground-client \
     | grep -E '^response_total|^outbound_http_balancer_in_failfast' \
     | grep -v ' 0$' | head
   ```

  ```
  response_total{direction="outbound",authority="playground-server-http.playground.svc.cluster.local:8080",target_addr="10.42.1.24:8080",target_ip="10.42.1.24",target_port="8080",tls="true",server_id="playground-server-http-primary.playground.serviceaccount.identity.linkerd.cluster.local",dst_control_plane_ns="linkerd",dst_deployment="playground-server-http-primary",dst_namespace="playground",dst_pod="playground-server-http-primary-9d9566587-xhsrl",dst_pod_template_hash="9d9566587",dst_service="playground-server-http",dst_serviceaccount="playground-server-http-primary",dst_zone="",dst_zone_locality="unknown",status_code="503",classification="failure",grpc_status="",error=""} 65
  response_total{direction="outbound",authority="playground-server-http.playground.svc.cluster.local:8080",target_addr="10.42.0.23:8080",target_ip="10.42.0.23",target_port="8080",tls="true",server_id="playground-server-http-canary.playground.serviceaccount.identity.linkerd.cluster.local",dst_control_plane_ns="linkerd",dst_deployment="playground-server-http-canary",dst_namespace="playground",dst_pod="playground-server-http-canary-5597c667f6-4ttcq",dst_pod_template_hash="5597c667f6",dst_service="playground-server-http",dst_serviceaccount="playground-server-http-canary",dst_zone="",dst_zone_locality="unknown",status_code="503",classification="failure",grpc_status="",error=""} 7
  response_total{direction="inbound",target_addr="0.0.0.0:4191",target_ip="0.0.0.0",target_port="4191",tls="no_identity",no_tls_reason="no_tls_from_remote",srv_group="",srv_kind="default",srv_name="all-unauthenticated",srv_port="4191",route_group="",route_kind="default",route_name="default",authz_group="",authz_kind="default",authz_name="all-unauthenticated",status_code="503",classification="failure",grpc_status="",error=""} 1
  ```

  No `failfast`, no `error="..."` labels, only `classification="failure"`
  counts climbing. That's an app issue.

3. **Read the app's own logs** (above). The server is logging the error
   deliberately.

## Fix

Switch off the fault injection on both versions. Reset **both** knobs back
to defaults — leaving `ERROR_CODE=503` sticky from the Recreate step would
have the server log read `errorRate=0% errorCode=503` after the upgrade
(harmless because `errorRate=0` short-circuits the injection, but
misleading state to leave behind):

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.7 --reuse-values \
  --set http.primary.env.ERROR_RATE=0 \
  --set http.primary.env.ERROR_CODE=500 \
  --set http.canary.env.ERROR_RATE=0 \
  --set http.canary.env.ERROR_CODE=500
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

Verify with the server's startup log line:

```sh
kubectl -n playground logs deploy/playground-server-http-primary -c server --tail=1
```

```
2026/05/14 04:56:43 server listening :8080 — version=v1 response="hello from primary" latency=0ms+0ms errorRate=0% errorCode=500
```

In a real environment the fix is a workload deploy — the mesh did its job;
the workload didn't.

## Revert

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.0.7 --reset-values
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```
