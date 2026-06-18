# 08 - ServiceProfile overrides HTTPRoute (silent, and sticky)

Linkerd supports two routing CRDs against the same Service:

- `ServiceProfile`, the legacy API. Routes, retry budgets, response 
  classes, traffic splitting via `dstOverrides`.
- `HTTPRoute` (`policy.linkerd.io` or upstream Gateway API),
  the modern API. Route matches, `backendRefs` with weights, timeouts,
  `RequestHeaderModifier` filters.

**When both attach to the same destination, the proxy uses the
ServiceProfile and ignores the HTTPRoute.** No error is raised, no event
is emitted.

This is a common migration trap: an operator adds an HTTPRoute for a canary, but a stale ServiceProfile is still in place and traffic keeps flowing per the old config.

**The choice is also sticky.** Once an outbound proxy's per-destination sidecar commits to the ServiceProfile path, deleting the ServiceProfile later does **not** transition the sidecar to the HTTPRoute path. The sidecar stays on the profile path with default (no-op) routes until it is rebuilt, which means a proxy restart.

This runbook covers both the steady-state override and the sticky post-deletion behaviour. It uses the two server versions the chart deploys (v1 from `playground-server-http-primary`, v2 from `playground-server-http-canary`) behind the apex `playground-server-http` service.

## Setup

Follow [00-setup.md](00-setup.md) for a fresh cluster, Linkerd Enterprise, and the playground app. Confirm green `200`s with `mTLS` badges in the UI before proceeding. The Version column should alternate between `v1` (primary) and `v2` (canary) as kube-proxy round-robins between the two backends.

## Symptom

Both symptoms stem from the same underlying mechanism.

### Symptom A: HTTPRoute appears inert from day one

- The UI shows **only v1** (primary) in the Version column.
- The v1 counter climbs; the v2 counter is frozen.
- The HTTPRoute specifies `weight: 100` for the canary backend and is silently ignored.
- `kubectl describe httproute playground-server-canary` shows no Linkerd errors or conflict warnings.

### Symptom B: HTTPRoute starts working only after a restart

- Operator notices Symptom A and deletes the ServiceProfile, expecting traffic to shift to the HTTPRoute.
- Nothing changes; the UI still shows only v1.
- Hours pass with no improvement.
- Only after restarting (or rolling) the client deployment does v2 start appearing.

## Recreate

This walk-through produces both symptoms in sequence, with a verification after each step. Keep the UI open in one tab and a terminal ready.

First, apply a ServiceProfile that pins all traffic to v1:

```sh
kubectl apply -f - <<'EOF'
apiVersion: linkerd.io/v1alpha2
kind: ServiceProfile
metadata:
  name: playground-server-http.playground.svc.cluster.local
  namespace: playground
spec:
  routes: []
  dstOverrides:
    - authority: playground-server-http-primary.playground.svc.cluster.local.:8080
      weight: 1000
    - authority: playground-server-http-canary.playground.svc.cluster.local.:8080
      weight: 0
EOF
kubectl rollout restart deploy -n playground -l app=playground-client
```

Wait ~5 s for the destination controller to push the profile to the client proxy. The UI's Version column should converge to **only v1**.

Verify with a 20-request sample:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl -n playground debug "$POD" \
  --image=curlimages/curl --profile=general --quiet -i -- \
  sh -c 'for i in $(seq 1 20); do
    curl -s -D - -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ \
      | grep -i x-app-version
  done | sort | uniq -c'
# 20 x-app-version: v1
# (no v2)
```

The ServiceProfile is in effect. The client's outbound sidecar for `playground-server-http` was built while the SP was present and is on the **ServiceProfile path**, watching the profile receiver and applying `dstOverrides`.

To confirm from the policy:

```sh
linkerd diagnostics profile playground-server-http.playground.svc.cluster.local
```

```
{
  "fully_qualified_name": "playground-server-http.playground.svc.cluster.local",
  "retry_budget": {
    "retry_ratio": 0.2,
    "min_retries_per_second": 10,
    "ttl": {
      "seconds": 10
    }
  },
  "dst_overrides": [
    {
      "authority": "playground-server-http-primary.playground.svc.cluster.local.:8080",
      "weight": 10000000
    },
    {
      "authority": "playground-server-http-canary.playground.svc.cluster.local.:8080"
    }
  ],
  "parent_ref": {
    "Kind": {
      "Resource": {
        "group": "core",
        "kind": "Service",
        "name": "playground-server-http",
        "namespace": "playground",
        "port": 80
      }
    }
  },
  "profile_ref": {
    "Kind": {
      "Resource": {
        "group": "linkerd.io",
        "name": "playground-server-http.playground.svc.cluster.local",
        "namespace": "playground"
      }
    }
  }
}
```

The operator now applies an HTTPRoute to canary all traffic to v2, unaware that the ServiceProfile is still in the way:

```sh
kubectl apply -f - <<'EOF'
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: playground-server-canary
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
      backendRefs:
        - name: playground-server-http-primary
          port: 8080
          weight: 0
        - name: playground-server-http-canary
          port: 8080
          weight: 100
EOF
```

Wait ~5 s. The HTTPRoute claims 100% to v2, but the UI **still shows only v1**.

Re-run the sample:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl -n playground debug "$POD" \
  --image=curlimages/curl --profile=general --quiet -i -- \
  sh -c 'for i in $(seq 1 20); do
    curl -s -D - -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ \
      | grep -i x-app-version
  done | sort | uniq -c'
# 20 x-app-version: v1
# (no v2)
```

Confirm both resources coexist with no error event:

```sh
kubectl -n playground get serviceprofile,httproute
```

```
NAME                                                                            AGE
serviceprofile.linkerd.io/playground-server-http.playground.svc.cluster.local   7m54s

NAME                                                           HOSTNAMES   AGE
httproute.gateway.networking.k8s.io/playground-server-canary               6s
```

**This is Symptom A: HTTPRoute silently ignored while a SP with routes or `dstOverrides` is present.**

The operator concludes that removing the ServiceProfile will let the HTTPRoute take over. Delete it:

```sh
kubectl -n playground delete serviceprofile \
  playground-server-http.playground.svc.cluster.local
```

Wait ~10 s for the destination controller to push the "no profile" update, then re-run the sample:

```sh
kubectl -n playground debug "$POD" \
  --image=curlimages/curl --profile=general --quiet -i -- \
  sh -c 'for i in $(seq 1 20); do
    curl -s -D - -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ \
      | grep -i x-app-version
  done | sort | uniq -c'
      9 x-app-version: v1
     11 x-app-version: v2
```

The HTTPRoute (`weight: 100 → canary`) is still inert. The ServiceProfile is gone, but the proxy has not switched paths.

## Why this happens

The outbound proxy subscribes to both the ServiceProfile stream (from the destination controller) and the OutboundPolicy stream (from the policy controller, where HTTPRoute lives) for every destination. When building the per-destination HTTP sidecar, it chooses **one** source.

**1. ServiceProfile wins if it has routes or `dstOverrides`.** An empty ServiceProfile (no routes, no `dstOverrides`) does **not** override policy and is safe to leave in place. The trap is specifically ServiceProfiles that carry routing logic.

**2. The choice is made once, at sidecar construction.** Once the ServiceProfile path is chosen, it is **not** re-evaluated. The sidecar is permanently subscribed to the profile receiver and ignores the policy receiver for the rest of its life.

When the ServiceProfile is later deleted, the sidecar serves traffic using default routes, **not** the HTTPRoute. The routing decision is re-evaluated when:

- **Proxy restart**: every destination's sidecar is reconstructed. This is the reliable trigger.
- **Per-destination cache eviction**: if a destination is idle long enough, the cache entry is evicted and the next request builds a fresh sidecar from current state. Under continuous traffic, this eviction never happens.

The operationally accurate rule: **after removing a ServiceProfile to activate an HTTPRoute, roll the proxies that were sending to that destination.**

## Diagnose

```sh
# 1. Is there a ServiceProfile for the destination?
kubectl -n playground get serviceprofile

# 2. Does it have routes or dstOverrides? Those are what trigger the
#    override. An empty-routes ServiceProfile does not.
kubectl -n playground get serviceprofile \
  playground-server-http.playground.svc.cluster.local -o yaml 2>/dev/null \
  | grep -A3 -E 'routes:|dstOverrides:'

# 3. Bump proxy log level and check which decision the sidecar took.
#    Remember: each line fires once per destination, at sidecar build time.
kubectl port-forward -n playground deploy/playground-client 4191
curl -v --data 'linkerd=debug' -X PUT localhost:4191/proxy-log-level

kubectl -n playground logs deploy/playground-client -c linkerd-proxy \
  | grep -E 'Using ServiceProfile|Using ClientPolicy routes'

# 4. If you've already deleted the ServiceProfile but traffic still
#    looks like Symptom B (sticky), check whether the proxy has
#    re-decided:
kubectl -n playground logs deploy/playground-client -c linkerd-proxy --since=5m \
  | grep -E 'Using ServiceProfile|Using ClientPolicy routes'
# If the most recent line for the destination is still "Using ServiceProfile",
# the sidecar hasn't been rebuilt, roll the client.
```

## Fix

Delete the ServiceProfile **and** roll the clients sending to that destination. Both steps are required:

```sh
kubectl -n playground delete serviceprofile \
  playground-server-http.playground.svc.cluster.local

kubectl -n playground rollout restart deploy/playground-client
kubectl -n playground rollout status deploy/playground-client
```

After the rollout, v2 starts appearing in the Version column. After 30 seconds, v2 should dominate per the HTTPRoute's `weight: 100`.

If multiple workloads send to the affected destination, roll all of them. Each client proxy independently committed to ServiceProfile and each needs its sidecar rebuilt.