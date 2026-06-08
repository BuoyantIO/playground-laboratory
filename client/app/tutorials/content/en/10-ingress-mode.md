# 10 - Meshed ingress bypasses Linkerd routing (ingress mode & `service-upstream`)

Linkerd doesn't ship an ingress controller. You mesh the one you already
run (ingress-nginx, Traefik, Kong, …) by injecting the `linkerd-proxy`
sidecar like any other workload. The catch is in **how an ingress
controller reaches its backends.**

Most controllers do their *own* endpoint selection: they watch the target
Service's `Endpoints`, pick a pod, and open the connection **directly to
that pod's IP**, never to the Service's ClusterIP. When the meshed
controller's outbound proxy sees a connection addressed to a pod IP, it
treats it as a single fixed endpoint and forwards straight there.
Everything that attaches to the **Service** is silently skipped:

- `HTTPRoute`s, and their weights, timeouts, retries, header filters.
- `ServiceProfile`s.
- Traffic splits / canary weighting.
- Linkerd's own load balancing across the endpoint set.

mTLS still happens (it sits below L7, and the destination controller can
still map the pod IP to a workload identity), so the failure is invisible:
`200`s, green badges, normal latency, and a canary `HTTPRoute` that does
**nothing**.

There are two fixes, and which one you use depends on the controller:

- **Point the controller at the ClusterIP.** ingress-nginx supports this
  with the `nginx.ingress.kubernetes.io/service-upstream: "true"`
  annotation. The proxy then sees the ClusterIP, resolves the logical
  Service, and applies all of its policy. The controller is injected
  **normally** (`linkerd.io/inject: enabled`).
- **Ingress mode** (`linkerd.io/inject: ingress`). For controllers you
  can't point at a ClusterIP (Traefik, Kong, Contour, Gloo, HAProxy, GCE,
  EnRoute), the proxy ignores the original destination IP and instead routes
  on the `l5d-dst-override` header, so a pod-IP connection still re-resolves
  to the logical Service. You set
  that header with a controller-specific mechanism (a Traefik `Middleware`,
  an nginx snippet, …) and you **must strip any client-supplied
  `l5d-dst-override`** to avoid turning the ingress into an open relay.

This runbook reproduces the bypass with ingress-nginx and fixes it with
`service-upstream`, then does the same with Traefik using ingress mode. It
reuses the two server versions the chart deploys (v1 from
`playground-server-http-primary`, v2 from `playground-server-http-canary`)
behind the apex `playground-server-http` Service.

## Setup

Follow [00-setup.md](00-setup.md) for a fresh cluster, Linkerd Enterprise,
and the playground app. You should see green `200`s with `mTLS` badges in
the UI before proceeding. Note that 00-setup already disables k3d's built-in
Traefik (`--disable=traefik`), so the host's `:80`/`:443` are free for the
controller we install here.

We expose `playground-server-http` (port 8080) through an ingress
controller. In every case we apply the **same** `HTTPRoute` that pins
**100 %** of traffic to the canary (v2); whether it takes effect through the
ingress is the test. Apply it now. It attaches to the apex Service and is
the probe we reuse throughout:

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
kubectl -n playground get httproute
```

Sanity check from **inside the mesh**, the in-mesh client honors the route,
so the dashboard converges to **v2 only**:

```sh
POD=$(kubectl -n playground get pod -l app=playground-client -o jsonpath='{.items[0].metadata.name}')
kubectl -n playground debug "$POD" \
  --image=curlimages/curl --profile=general --quiet -i -- \
  sh -c 'for i in $(seq 1 20); do
    curl -s -D - -o /dev/null http://playground-server-http.playground.svc.cluster.local:8080/ \
      | grep -i x-app-version
  done | sort | uniq -c'
# 20 x-app-version: v2
```

That's the baseline: a client that dials the **Service** gets the
HTTPRoute. Now watch what happens when an ingress controller dials the
**pods** instead.

## Symptom

- Requests through the ingress return `200`, latency normal, mTLS intact.
- The canary `HTTPRoute` says `weight: 100 → v2`, yet the version stream
  through the ingress keeps showing **both v1 and v2** (~50/50). The route
  is being ignored.
- Service-attached `ServiceProfile`s, timeouts and retries are likewise
  inert for ingress traffic.
- Direct in-mesh calls (above) **do** honor the route; only the path
  through the ingress is broken. **That asymmetry is the tell.**

## Two ways to integrate a meshed ingress

| Strategy | How the controller reaches the backend | Inject mode | What makes Service routing work |
|---|---|---|---|
| **`service-upstream`** (ingress-nginx) | Dials the Service **ClusterIP** | `enabled` (normal) | The proxy resolves the ClusterIP → logical Service → applies `HTTPRoute` / `ServiceProfile` / splits, and load-balances the endpoints itself |
| **Ingress mode** (Traefik, Kong, Contour, Gloo, HAProxy, GCE, EnRoute) | Dials a **pod IP**, but sets `l5d-dst-override` | `ingress` | The proxy ignores the dst IP and resolves the logical Service from the header instead |

The rest of the runbook walks one controller per strategy.

## Recreate

### 1. ingress-nginx: the trap, then `service-upstream`

Install ingress-nginx, meshed at the **pod** level:

```sh
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set-string 'controller.podAnnotations.linkerd\.io/inject=enabled' \
  --set controller.replicaCount=1
kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller
```

> **Annotate the pod, not the namespace.** ingress-nginx runs short-lived
> admission `Job`s (`ingress-nginx-admission-create` / `-patch`). A
> namespace-level `linkerd.io/inject` annotation would mesh those too, and
> their sidecars would never exit. The Jobs would hang forever. Pod-level
> annotation on the controller deployment avoids that.

Confirm the controller is meshed (`2/2`, nginx + `linkerd-proxy`):

```sh
kubectl -n ingress-nginx get pod -l app.kubernetes.io/component=controller
```

```
NAME                                        READY   STATUS    RESTARTS   AGE
ingress-nginx-controller-7c6f5d9b8c-h4n2t   2/2     Running   0          25s
```

Create the Ingress. Note there is **no** `service-upstream` annotation yet:

```sh
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: playground
  namespace: playground
spec:
  ingressClassName: nginx
  rules:
    - host: playground.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: playground-server-http
                port:
                  number: 8080
EOF
```

Sample 20 requests through it. Simulate external traffic by port-forwarding
the controller:

```sh
# Terminal 1: leave this running.
kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8080:80
```

```sh
# Terminal 2.
for i in $(seq 1 20); do
  curl -s -H 'Host: playground.example.com' -D - -o /dev/null http://localhost:8080/ \
    | grep -i x-app-version
done | sort | uniq -c
```

```
  11 x-app-version: v1
   9 x-app-version: v2
```

The HTTPRoute pins 100 % to v2, yet you get a near-even split. That split is
**nginx's** own round-robin across the apex Service's two endpoints.
Linkerd never saw the Service, so its route never fired.

The route is healthy and accepted; the gap is in routing, not config:

```sh
linkerd diagnostics policy -n playground svc/playground-server-http 8080 | head -25
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
              Resource:
                group: gateway.networking.k8s.io
                kind: HTTPRoute
                name: playground-server-canary
```

**Wire-level confirmation**: on the controller's outbound proxy, the HTTP
requests are attributed to a synthetic `endpoint` route (direct pod-IP
forwarding), not to the Service's `playground-server-canary` HTTPRoute, which
therefore never runs:

```sh
linkerd diagnostics proxy-metrics -n ingress-nginx deploy/ingress-nginx-controller \
  | grep '^outbound_http_route_backend_requests_total' \
  | sed -E 's/.*route_name="([^"]*)".*backend_name="([^"]*)".*\} ([0-9]+)/route=\1 backend=\2 reqs=\3/'
```

```
route=endpoint backend=unknown reqs=20
```

`tcp_open_total` is *not* a useful signal here: the proxy keeps TCP
connections open to every endpoint in both cases, so it shows both pods
whether or not the route is applied. The routing decision only surfaces at
the HTTP layer, in the metric above.

**Now apply the fix.** Add the `service-upstream` annotation so nginx dials
the ClusterIP instead of the endpoints:

```sh
kubectl -n playground annotate ingress playground \
  nginx.ingress.kubernetes.io/service-upstream=true --overwrite
```

Re-sample (no restart needed, nginx reloads the upstream within a second
or two):

```sh
for i in $(seq 1 20); do
  curl -s -H 'Host: playground.example.com' -D - -o /dev/null http://localhost:8080/ \
    | grep -i x-app-version
done | sort | uniq -c
```

```
  20 x-app-version: v2
```

nginx now hands the proxy the ClusterIP; the proxy resolves
`playground-server-http`, applies the HTTPRoute, and sends 100 % to the
canary. The wire-level view agrees: requests now flow through the
`playground-server-canary` route, 100 % to the canary backend, 0 to primary:

```sh
linkerd diagnostics proxy-metrics -n ingress-nginx deploy/ingress-nginx-controller \
  | grep '^outbound_http_route_backend_requests_total' \
  | sed -E 's/.*route_name="([^"]*)".*backend_name="([^"]*)".*\} ([0-9]+)/route=\1 backend=\2 reqs=\3/'
```

```
route=playground-server-canary backend=playground-server-http-canary reqs=20
route=playground-server-canary backend=playground-server-http-primary reqs=0
```

These counters are cumulative, so a proxy that also served the bypass phase
will still show the old `route=endpoint` line; restart the controller for a
clean read. The signal is that `route_name` flips from `endpoint` to
`playground-server-canary`.

Tear down before case 2 so the two stay independent:

```sh
kubectl -n playground delete ingress playground --ignore-not-found
helm uninstall ingress-nginx -n ingress-nginx
kubectl delete ns ingress-nginx --ignore-not-found
```

### 2. Traefik: ingress mode

Traefik also load-balances to pod IPs by default and has no
`service-upstream` equivalent on the standard Kubernetes path, so it's a
textbook ingress-mode controller. Install it meshed with
`linkerd.io/inject: **ingress**` (not `enabled`), again at the pod level:

```sh
helm repo add traefik https://traefik.github.io/charts
helm repo update
helm install traefik traefik/traefik \
  --namespace traefik --create-namespace \
  --set-string 'deployment.podAnnotations.linkerd\.io/inject=ingress'
kubectl -n traefik rollout status deploy/traefik
```

Verify the proxy came up in **ingress mode**: the injector sets a dedicated
env var when the annotation is `ingress` rather than `enabled`. The proxy
image is distroless (no shell or `env` binary), so read the variable from the
pod spec rather than with `exec`:

```sh
kubectl -n traefik get pod -l app.kubernetes.io/name=traefik \
  -o jsonpath='{range .items[0].spec.containers[?(@.name=="linkerd-proxy")].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -i ingress
# LINKERD2_PROXY_INGRESS_MODE=true
```

Route to the backend **without** the header first, to show that ingress mode
alone isn't enough. The proxy still needs `l5d-dst-override` to learn the
logical Service:

```sh
kubectl apply -f - <<'EOF'
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: playground
  namespace: playground
spec:
  entryPoints:
    - web
  routes:
    - match: Host(`playground.example.com`)
      kind: Rule
      services:
        - name: playground-server-http
          port: 8080
EOF
```

```sh
# Terminal 1.
kubectl -n traefik port-forward svc/traefik 8080:80
```

```sh
# Terminal 2.
for i in $(seq 1 20); do
  curl -s -H 'Host: playground.example.com' -D - -o /dev/null http://localhost:8080/ \
    | grep -i x-app-version
done | sort | uniq -c
```

```
  10 x-app-version: v1
  10 x-app-version: v2
```

Same bypass: Traefik dialed pod IPs, the proxy had no `l5d-dst-override` to
go on, and the HTTPRoute was skipped.

Now add a `Middleware` that sets `l5d-dst-override` to the Service FQDN and
attach it to the route. Because `customRequestHeaders` **overwrites** the
header, it also strips any value a client tried to inject, closing the
open-relay hole for this route:

```sh
kubectl apply -f - <<'EOF'
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: l5d-dst-override
  namespace: playground
spec:
  headers:
    customRequestHeaders:
      l5d-dst-override: "playground-server-http.playground.svc.cluster.local:8080"
---
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: playground
  namespace: playground
spec:
  entryPoints:
    - web
  routes:
    - match: Host(`playground.example.com`)
      kind: Rule
      services:
        - name: playground-server-http
          port: 8080
      middlewares:
        - name: l5d-dst-override
EOF
```

Re-sample:

```sh
for i in $(seq 1 20); do
  curl -s -H 'Host: playground.example.com' -D - -o /dev/null http://localhost:8080/ \
    | grep -i x-app-version
done | sort | uniq -c
```

```
  20 x-app-version: v2
```

The proxy ignored the pod IP Traefik dialed, read `l5d-dst-override`,
re-resolved it to the logical Service, applied the HTTPRoute, and sent
100 % to the canary.

> **Traefik CRD group.** Traefik v3 (and recent v2) use the
> `traefik.io/v1alpha1` API group shown above. Older Traefik v2 used
> `traefik.containo.us/v1alpha1`, same `Middleware` / `IngressRoute`
> shape, just a different `apiVersion`.

## Why this happens

The outbound proxy decides where to send a connection from its **original
destination address**, by asking the destination controller about it:

- **ClusterIP** (or a name that resolves to one) → the controller returns
  the **logical Service**: its endpoint set (for the proxy to load-balance),
  its `HTTPRoute`s, `ServiceProfile`, traffic splits and retries. The proxy
  runs the full L7 stack.
- **Pod IP** → the controller returns that **single endpoint**. There is
  nothing to balance and no Service-attached policy to apply. The proxy
  forwards to that one pod.

Ingress controllers default to the second path: they resolve the Service to
its `Endpoints` themselves and dial pod IPs. So a meshed controller, out of
the box, drops to bare endpoint-forwarding and skips every Service-level
feature, silently, because mTLS and `200`s are unaffected.

The two fixes attack different ends of the same connection:

- **`service-upstream`** changes the **controller**: dial the ClusterIP, and
  the first bullet applies again. Normal injection, nothing special on the
  proxy.
- **Ingress mode** changes the **proxy**: ignore the original dst IP and
  resolve the logical Service from the `l5d-dst-override` header instead (or
  the original destination if that header is absent). The controller can keep
  dialing pod IPs; the proxy re-resolves to the Service anyway.

**Security.** In ingress mode the proxy routes wherever `l5d-dst-override`
says. If an external client can set that header, they can make your ingress
relay to **any** cluster-internal (or external) address, an SSRF-grade open
relay. Always overwrite or strip `l5d-dst-override` on the way in; Traefik's
`customRequestHeaders` does this for free (it overwrites), but **every**
route must do it. This is also why ingress mode belongs on the controller
**pod** only, never on a whole namespace whose other workloads should mesh
normally.

## Diagnose

```sh
# 1. Is the controller meshed, and in which mode?
kubectl -n ingress-nginx get pod -l app.kubernetes.io/component=controller   # READY 2/2
kubectl -n traefik       get pod -l app.kubernetes.io/name=traefik           # READY 2/2
# Ingress mode sets this env on the proxy; "enabled" does not. The proxy is
# distroless (no `env` binary), so read it from the pod spec:
kubectl -n traefik get pod -l app.kubernetes.io/name=traefik \
  -o jsonpath='{range .items[0].spec.containers[?(@.name=="linkerd-proxy")].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -i ingress
# LINKERD2_PROXY_INGRESS_MODE=true

# 2. Behavioral probe (the unambiguous test): does the canary HTTPRoute take
#    effect *through the ingress*?
for i in $(seq 1 20); do
  curl -s -H 'Host: playground.example.com' -D - -o /dev/null http://localhost:8080/ \
    | grep -i x-app-version
done | sort | uniq -c
# both v1 and v2 -> Service routing bypassed
# only v2        -> Service routing is in effect

# 3. The route exists and the destination controller has picked it up, so the
#    gap is routing, not config. (Service-parented HTTPRoutes don't get a
#    status written, so check the policy the proxies actually receive.)
kubectl -n playground get httproute playground-server-canary
linkerd diagnostics policy -n playground svc/playground-server-http 8080 | head -25

# 4. At the HTTP layer, which route handled the requests? (swap ns/deploy.)
#    tcp_open_total is no help here: the proxy holds connections open to all
#    endpoints either way. Route attribution is the signal.
linkerd diagnostics proxy-metrics -n ingress-nginx deploy/ingress-nginx-controller \
  | grep '^outbound_http_route_backend_requests_total' \
  | sed -E 's/.*route_name="([^"]*)".*backend_name="([^"]*)".*\} ([0-9]+)/route=\1 backend=\2 reqs=\3/'
# route=endpoint ...                 = direct pod-IP forwarding (bypassed)
# route=playground-server-canary ... = Service HTTPRoute applied (fixed)

# 5. ingress-nginx specifically: is service-upstream set on the Ingress?
kubectl -n playground get ingress playground \
  -o jsonpath='{.metadata.annotations.nginx\.ingress\.kubernetes\.io/service-upstream}{"\n"}'
# (empty) = bypass;  true = fixed
```

## Fix

- **ingress-nginx (and any controller with a ClusterIP option):** keep
  normal injection (`linkerd.io/inject: enabled`) and add
  `nginx.ingress.kubernetes.io/service-upstream: "true"` to the Ingress so
  the controller dials the ClusterIP.

  ```sh
  kubectl -n playground annotate ingress playground \
    nginx.ingress.kubernetes.io/service-upstream=true --overwrite
  ```

- **Traefik / Kong / Contour / Gloo / HAProxy / GCE / EnRoute:** mesh the
  controller in **ingress mode** (`linkerd.io/inject: ingress`, pod-level)
  and set `l5d-dst-override: <svc>.<ns>.svc.cluster.local:<port>` on every
  route, overwriting (so also stripping) any inbound value.

- Re-run the behavioral probe: the canary `HTTPRoute` should now resolve to
  **v2 only** through the ingress.

The rule of thumb: an HTTP/gRPC ingress must reach its backends **through
the Service**: either by dialing the ClusterIP (`service-upstream`) or by
naming it in `l5d-dst-override` (ingress mode). Bare pod-IP forwarding is
exactly what strips Linkerd's L7 features.

## Revert

```sh
kubectl -n playground delete ingress playground --ignore-not-found
kubectl -n playground delete ingressroute playground --ignore-not-found
kubectl -n playground delete middleware l5d-dst-override --ignore-not-found
kubectl -n playground delete httproute playground-server-canary --ignore-not-found

helm uninstall ingress-nginx -n ingress-nginx 2>/dev/null || true
helm uninstall traefik -n traefik 2>/dev/null || true
kubectl delete ns ingress-nginx traefik --ignore-not-found
```
