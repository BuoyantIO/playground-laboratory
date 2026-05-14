# 08 — ServiceProfile overrides HTTPRoute (silent, and sticky)

Linkerd supports two routing CRDs against the same Service:

- `ServiceProfile`, the legacy API. Routes, retry budgets, response 
  classes, traffic splitting via `dstOverrides`.
- `HTTPRoute` (`policy.linkerd.io` or upstream Gateway API),
  the modern API. Route matches, `backendRefs` with weights, timeouts,
  `RequestHeaderModifier` filters.

**When both attach to the same destination, the proxy uses the
ServiceProfile and ignores the HTTPRoute.** No error is raised. No event
is emitted. The HTTPRoute simply has no effect.

This is a classic migration trap: an operator adds an HTTPRoute to perform
a canary, but a stale ServiceProfile from the v1alpha2 era is still in
place and traffic keeps flowing per the old config.

**Worse, the choice is sticky.** Once an outbound proxy's per-destination
sidecar has committed to the ServiceProfile path (because the SP existed
and had routes/dstOverrides when the sidecar was first built), deleting
the ServiceProfile later does **not** transition the sidecar back to the
HTTPRoute path. The sidecar stays on the profile path with default
(no-op) routes until it is rebuilt, which in practice means a proxy
restart.

This runbook covers both the steady-state override and the sticky
post-deletion behaviour. It uses the two server versions the chart
deploys (v1 from `playground-server-http-primary`, v2 from
`playground-server-http-canary`) behind the apex `playground-server-http`
service.

## Setup

Follow [00-setup.md](00-setup.md) for a fresh cluster, Linkerd Enterprise,
and the playground app. You should see green `200`s with `mTLS` badges
in the UI before proceeding. The UI should be alternating between `v1`
(primary) and `v2` (canary) in the Version column as kube-proxy
round-robins between the two backends behind the apex service.

## Symptom

There are two distinct symptoms; both come from the same underlying
mechanism.

### Symptom A: HTTPRoute appears inert from day one

- The UI keeps showing **only v1** (primary) in the Version column.
- The v1 counter climbs; the v2 counter is frozen.
- The HTTPRoute *says* `weight: 100` for the canary backend and gets
  completely ignored.
- `kubectl describe httproute playground-server-canary` shows no Linkerd
  errors, no conflict warnings.

### Symptom B: HTTPRoute starts working only after a restart

- Operator notices Symptom A.
- Operator deletes the ServiceProfile, expecting traffic to shift to
  HTTPRoute.
- Nothing changes. The UI still shows only v1.
- A few hours pass, no improvement.
- Operator finally restarts (or rolls) the client deployment, only
  *then* does v2 start appearing.

## Recreate

This walk-through produces both symptoms in sequence. Each step has a
verification that confirms what the proxy is actually doing before
moving to the next. Keep the UI open in one tab and a terminal handy
for the kubectl commands.

First, apply a ServiceProfile that pins all traffic to v1

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

Wait ~5 s for the destination controller to push the profile to the
client proxy. The UI's Version column should converge to **only v1**.

Verify with the same 20-request sample:

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

The ServiceProfile is in effect. Underlying mechanism: at this point
the client's outbound sidecar for `playground-server-http` was built
(either at proxy start or earlier, while the SP was already present)
and is on the **ServiceProfile path** the proxy is watching the
profile receiver and applying `dstOverrides`.

If you want to confirm this from the policy.

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

The operator decides to canary all traffic to v2 and applies an
HTTPRoute, unaware that a ServiceProfile is still in the way:

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

Wait ~5 s. The HTTPRoute claims 100 % to v2, but the UI **still shows
only v1**.

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

Confirm both resources happily coexist with no error event:

```sh
kubectl -n playground get serviceprofile,httproute
```

```
NAME                                                                            AGE
serviceprofile.linkerd.io/playground-server-http.playground.svc.cluster.local   7m54s

NAME                                                           HOSTNAMES   AGE
httproute.gateway.networking.k8s.io/playground-server-canary               6s
```

**This is Symptom A: HTTPRoute silently ignored while a SP with routes
or `dstOverrides` is present.**

The operator notices Symptom A and concludes "I just need to remove
the ServiceProfile and the HTTPRoute will take over." Delete it:

```sh
kubectl -n playground delete serviceprofile \
  playground-server-http.playground.svc.cluster.local
```

Wait ~10 s for the destination controller to push the "no profile"
update and re-run the sample:

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

The HTTPRoute that says `weight: 100 → canary` is still inert. The
ServiceProfile is gone, but the proxy hasn't switched paths.

## Why this happens

The outbound proxy subscribes to *both* the ServiceProfile stream (from
the destination controller) and the OutboundPolicy stream (from the
policy controller, where HTTPRoute lives) for every destination. The
two arrive at the proxy in parallel.

When building the per-destination HTTP sidecar, the proxy chooses
**one** source.

**1. ServiceProfile wins if it has routes or `dstOverrides`.** An empty
ServiceProfile (no routes, no `dstOverrides`) does **not** override the
policy, those are safe to leave around. The trap is specifically
ServiceProfiles that *do* carry routing logic.

**2. The choice is made once, at sidecar construction.** If the
ServiceProfile path is chosen, and the logic is **not** re-evaluated. 
The sidecar is permanently subscribed to the profile receiver and ignores
the policy receiver for the rest of its life.

When the ServiceProfile is later deleted the sidecar serves traffic using 
the default routes and **not** the HTTPRoute. The routing decision is re-evaluates
when: 

- **Proxy restart**: every destination's sidecar is reconstructed.
  This is the reliable trigger.
- **Per-destination cache eviction**: If a destination is idle long enough,
  the cache entry is evicted; the next request to that destination
  builds a fresh sidecar with the current state. Under continuous
  traffic (which is the SMA setup), this eviction never happens.

So the operationally accurate rule is: **after removing a
ServiceProfile to activate an HTTPRoute, roll the proxies that were
sending to that destination.**

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
  | grep -E 'Using ServiceProfile|Using ClientPolicy'

# 4. If you've already deleted the ServiceProfile but traffic still
#    looks like Symptom B (sticky), check whether the proxy has
#    re-decided:
kubectl -n playground logs deploy/playground-client -c linkerd-proxy --since=5m \
  | grep -E 'Using ServiceProfile|Using ClientPolicy'
# If the most recent line for the destination is still "Using ServiceProfile",
# the sidecar hasn't been rebuilt, roll the client.
```

## Fix

Delete the ServiceProfile **and** roll the clients sending to that
destination. Both steps are required:

```sh
kubectl -n playground delete serviceprofile \
  playground-server-http.playground.svc.cluster.local

kubectl -n playground rollout restart deploy/playground-client
kubectl -n playground rollout status deploy/playground-client
```

Watch the UI: after the rollout, v2 starts appearing in the Version
column. After 30 seconds, v2 should dominate (per the HTTPRoute's
`weight: 100`).

If multiple workloads send to the affected destination, roll all of
them, every client proxy independently committed to ServiceProfile and
each one needs its sidecar rebuilt.