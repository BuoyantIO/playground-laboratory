# 06 - Persistent failfast from a CrashLoopBackOff

A pathological readiness-flap variant: the server crashes on startup, kubelet
never marks it `Ready`, the Service stays permanently empty, and every
outbound request fails with `504 failfast`. The mesh-side symptom is
identical to [runbook 04](04-failfast-no-endpoints.md), but the operational
remediation is different; you can't just `scale --replicas=1`.

## Setup

Follow [00-setup.md](00-setup.md) to set up a fresh cluster, Linkerd Enterprise,
and the playground app. Confirm green `200`s with `mTLS` badges in the UI
before proceeding.

## Symptom

- Client UI: every poll red `504` from the moment you trigger.
- `kubectl get pods` shows `STATUS=CrashLoopBackOff` and `RESTARTS` rising.
- `kubectl get endpointslices` shows `<none>` for `playground-server-http`.

## Recreate

Set the startup-failure knob (see
[server/cmd/http/main.go:17-19](../server/cmd/http/main.go)):

```sh
helm uninstall demo
helm install demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0 \
  --set http.primary.env.FAIL_ON_STARTUP=true \
  --set http.canary.env.FAIL_ON_STARTUP=true
kubectl -n playground rollout status \
  deploy/playground-server-http-primary --timeout=10s || true
```

Both versions must crash. If only the primary is in `CrashLoopBackOff`,
kube-proxy keeps routing to the canary and failfast never appears.

The rollout will not converge. Within a minute, check pods:

```sh
kubectl -n playground get pods -l app=playground-server-http
```

```
NAME                                              READY   STATUS             RESTARTS      AGE
playground-server-http-primary-58dc4c65c6-4jwqt   1/2     CrashLoopBackOff   1 (11s ago)   16s
playground-server-http-canary-69bf7bf467-blgg5    1/2     CrashLoopBackOff   1 (11s ago)   16s
```

`1/2` because the sidecar is still running; only the `server` container is crashlooping.

## What you'll see

Curl from the client; same failfast response as runbook 04:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl -n playground debug "$POD" --image=curlimages/curl --profile=general --quiet -i -- \
  curl -sv -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< l5d'
```

```
< HTTP/1.1 504 Gateway Timeout
< l5d-proxy-error: logical service 10.43.140.232:8080: route default.http: backend Service.playground.playground-server-http:8080: Service.playground.playground-server-http:8080: service in fail-fast
< l5d-proxy-connection: close
```

Unlike a transient scale-to-zero, nothing tells the proxy endpoints are coming
back. Endpoints stay empty:

```sh
linkerd diagnostics endpoints playground-server-http.playground.svc.cluster.local:8080
# No endpoints found.
```

Pod events confirm the back-off:

```sh
kubectl -n playground describe pod -l app=playground-server-http | grep -A20 Events:
```

```
  Warning  BackOff    118s (x7 over 2m24s)  kubelet            Back-off restarting failed container server in pod playground-server-http-canary-69bf7bf467-ktfn6_playground(1cc5e5d2-fa8f-496f-afb9-3dbea6516221)
```

## Why this happens

Same outbound failfast path as runbook 04, but the failure is *durable*:
kubelet exponentially backs off restarts, so endpoints stay empty
indefinitely.

The key diagnostic is the pod lifecycle, not the mesh. The proxy is reacting
correctly; the workload is broken.

## Diagnose

```sh
# 1. Is the failure persistent or transient?
kubectl -n playground get pods -l app=playground-server-http
# CrashLoopBackOff with rising RESTARTS = persistent.

# 2. Why is it crashing?
kubectl -n playground logs deploy/playground-server-http-primary -c server --previous --tail=20
# Look for fatal errors / OOMKilled / non-zero exit codes.

# 3. Confirm endpoints empty (vs the readiness-flap scenario where they
# cycle).
kubectl -n playground get endpointslices \
  -l kubernetes.io/service-name=playground-server-http \
  -o jsonpath='{.items[*].endpoints}' | jq

# 4. No Endpoints:
linkerd diagnostics endpoints playground-server-http.playground.svc.cluster.local:8080
# No endpoints found.

# 5. Outbound balancer has zero endpoints and the error counter is flat:
POD=$(kubectl -n playground get pod -l app=playground-client \
        -o jsonpath='{.items[0].metadata.name}')
linkerd diagnostics proxy-metrics -n playground pod/"$POD" \
  | grep -E 'outbound_http_balancer_endpoints|outbound_http_errors_total' \
  | grep playground-server-http
# Counter not increasing and set to 0
```

## Fix

Stop the crashes on both versions:

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0 --reuse-values \
  --set http.primary.env.FAIL_ON_STARTUP=false \
  --set http.canary.env.FAIL_ON_STARTUP=false
kubectl -n playground rollout restart \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```

Common real-world causes:

- Missing ConfigMap / Secret mount.
- Bad image tag (`ImagePullBackOff` looks similar from the mesh's POV).
- Required env var missing.
- Init-container failure.

## Revert

```sh
helm upgrade demo \
  oci://ghcr.io/buoyantio/playground-laboratory/charts/playground \
  --version 1.1.0 --reset-values
kubectl -n playground rollout status \
  deploy/playground-server-http-primary deploy/playground-server-http-canary
```
