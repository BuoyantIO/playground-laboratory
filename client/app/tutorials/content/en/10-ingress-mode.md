# 10 - Meshing an ingress without bypassing Linkerd routing (`service-upstream`, `routingType` & ingress mode)

Linkerd doesn't ship an ingress controller. You mesh the one you already
run (ingress-nginx, Traefik, Envoy Gateway, kgateway, …) by injecting the
`linkerd-proxy` sidecar like any other workload. The catch is in **how an
ingress controller reaches its backends.**

Most controllers do their *own* endpoint selection: they watch the target
Service's `Endpoints`, pick a pod, and connect **directly to that pod's IP**,
never to the Service's ClusterIP. When the meshed controller's outbound proxy
sees a connection addressed to a pod IP, it treats it as a single fixed
endpoint and forwards straight there. Everything attached to the **Service**
is silently skipped:

- `HTTPRoute`s, and their weights, timeouts, retries, header filters.
- `ServiceProfile`s.
- Traffic splits / canary weighting.
- Linkerd's own load balancing across the endpoint set.

mTLS still happens (it sits below L7, and the destination controller can still
map the pod IP to a workload identity), so the failure is invisible: `200`s,
green badges, normal latency, and a canary `HTTPRoute` that does **nothing**.

Two fix families exist; which applies depends on whether the controller can
be told to dial the **Service** instead of the pods:

- **Point the controller at the Service / ClusterIP.** The proxy sees the
  ClusterIP, resolves the logical Service, and applies all policy. Inject the
  controller **normally** (`linkerd.io/inject: enabled`). Every modern
  controller has a knob for this; the bulk of this runbook covers those knobs.
- **Ingress mode** (`linkerd.io/inject: ingress`). For controllers that
  can't dial a ClusterIP, the proxy ignores the original destination IP and
  routes on the `l5d-dst-override` header instead, so a pod-IP connection
  still re-resolves to the logical Service. Set that header with a
  controller-specific mechanism (a Traefik `Middleware`, an nginx snippet, …)
  and **strip any client-supplied `l5d-dst-override`** to avoid turning the
  ingress into an open relay.

This runbook reproduces the bypass and fixes it across **ingress-nginx,
Traefik, Envoy Gateway, and kgateway**, then closes with Traefik in ingress
mode, using the two server versions the chart deploys (v1 from
`playground-server-http-primary`, v2 from `playground-server-http-canary`)
behind the apex `playground-server-http` Service.

| Controller | How to make it reach the **Service** | Inject mode |
|---|---|---|
| ingress-nginx | `nginx.ingress.kubernetes.io/service-upstream: "true"` on the Ingress | `enabled` |
| Traefik | `traefik.ingress.kubernetes.io/service.nativelb: "true"` on the Service | `enabled` |
| Envoy Gateway 1.7 | `spec.routingType: Service` on the `EnvoyProxy` | `enabled` |
| Envoy Gateway 1.8+ | `routingType: Service` on a `BackendTrafficPolicy` (⚠ needs Gateway API v1.5, conflicts with Linkerd today) | `enabled` |
| kgateway | a Static `Backend` whose host is the Service FQDN | `enabled` |
| Traefik (fallback, no ClusterIP knob) | ingress mode + `l5d-dst-override` per route | `ingress` |

## Setup

Follow [00-setup.md](00-setup.md) for the cluster, Linkerd Enterprise, and
the playground app. No cluster changes are needed: this runbook reaches the
ingress from your laptop on `localhost:8081`, and 00-setup's cluster already
maps that host port to the controller's `:80` (`--port '8081:80@loadbalancer'`,
with `--disable=traefik` keeping the host's `:80` free). Confirm green `200`s
with `mTLS` badges in the UI before proceeding.

Every controller below is tested with the **same** probe: an `HTTPRoute`
attached to the apex Service that pins **100 %** of traffic to the canary
(v2). Whether it takes effect *through the ingress* is the test. Apply it now:

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

Baseline check from **inside the mesh**: an in-mesh client dials the Service
and honors the route, converging to **v2 only**:

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

A client that dials the **Service** gets the HTTPRoute. Now watch what
happens when an ingress controller dials the **pods** instead.

For every test through the ingress we curl the host port the cluster exposes
and read the `X-App-Version` header (v1 = primary, v2 = canary). A helper
keeps the loops short:

```sh
# Print the version served through the ingress for a given path.
ver() { curl -s -D - -o /dev/null "http://localhost:8081$1" \
  | awk 'tolower($1)=="x-app-version:"{print $2}' | tr -d '\r'; }

# Live stream of who answers (Ctrl-C to stop).
while true; do echo "$(date '+%H:%M:%S')  $(ver /)"; sleep 1; done
```

> **One controller at a time.** Every controller below binds the host's
> `:8081 → :80`, so install, test, then **tear it down** (each section ends
> with its teardown) before moving to the next.

## ingress-nginx: `service-upstream`

Install ingress-nginx, meshed at the **pod** level (annotation on the pod, not the namespace, explained below):

```sh
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.replicaCount=1 \
  --set-string 'controller.podAnnotations.linkerd\.io/inject=enabled'
kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller
```

> **Annotate the pod, not the namespace.** ingress-nginx runs short-lived
> admission `Job`s (`ingress-nginx-admission-create` / `-patch`). A
> namespace-level `linkerd.io/inject` would mesh those too; their sidecars
> would never exit, hanging the Jobs. Pod-level annotation on the controller
> deployment avoids that.

Create the Ingress without the `service-upstream` annotation:

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
    - http:
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

Sample through it:

```sh
for i in $(seq 1 20); do ver /; done | sort | uniq -c
```

```
  11 v1
   9 v2
```

The HTTPRoute pins 100 % to v2, yet you get a near-even split: **nginx's**
own round-robin across the apex Service's two endpoints. Linkerd never saw
the Service, so its route never fired.

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

**Wire-level confirmation**: on the controller's outbound proxy, requests are
attributed to a synthetic `endpoint` route (direct pod-IP forwarding), not to
the `playground-server-canary` HTTPRoute, which never runs:

```sh
linkerd diagnostics proxy-metrics -n ingress-nginx deploy/ingress-nginx-controller \
  | grep '^outbound_http_route_backend_requests_total' \
  | sed -E 's/.*route_name="([^"]*)".*backend_name="([^"]*)".*\} ([0-9]+)/route=\1 backend=\2 reqs=\3/'
```

```
route=endpoint backend=unknown reqs=20
```

`tcp_open_total` is *not* a useful signal here: the proxy keeps TCP
connections open to every endpoint in both cases. The routing decision only
surfaces at the HTTP layer, in the metric above.

Add the `service-upstream` annotation so nginx dials the ClusterIP instead
of the endpoints:

```sh
kubectl -n playground annotate ingress playground \
  nginx.ingress.kubernetes.io/service-upstream=true --overwrite
```

Re-sample (no restart needed; nginx reloads the upstream within a second or
two):

```sh
for i in $(seq 1 20); do ver /; done | sort | uniq -c
```

```
  20 v2
```

nginx now hands the proxy the ClusterIP; the proxy resolves
`playground-server-http`, applies the HTTPRoute, and sends 100 % to the
canary. The wire-level view confirms:

```sh
linkerd diagnostics proxy-metrics -n ingress-nginx deploy/ingress-nginx-controller \
  | grep '^outbound_http_route_backend_requests_total' \
  | sed -E 's/.*route_name="([^"]*)".*backend_name="([^"]*)".*\} ([0-9]+)/route=\1 backend=\2 reqs=\3/'
```

```
route=playground-server-canary backend=playground-server-http-canary reqs=20
route=playground-server-canary backend=playground-server-http-primary reqs=0
```

These counters are cumulative, so a proxy that served the bypass phase still
shows the old `route=endpoint` line; the signal is `route_name` flipping from
`endpoint` to `playground-server-canary`.

Tear down before the next controller:

```sh
kubectl -n playground delete ingress playground --ignore-not-found
helm uninstall ingress-nginx -n ingress-nginx
kubectl delete ns ingress-nginx --ignore-not-found
```

## Traefik: ClusterIP via `service.nativelb`

Older guidance said Traefik had no `service-upstream` equivalent and required
ingress mode. It does now: `traefik.ingress.kubernetes.io/service.nativelb:
"true"` tells Traefik to send traffic to the Service's ClusterIP ("native"
load balancing) instead of resolving endpoints itself. Traefik then takes the
ClusterIP path and is injected **normally**.

Install Traefik, meshed `enabled` (its chart has no admission Jobs that would
hang, so a namespace annotation is fine):

```sh
helm repo add traefik https://traefik.github.io/charts
helm repo update
kubectl create namespace traefik
kubectl annotate namespace traefik linkerd.io/inject=enabled
helm install traefik traefik/traefik -n traefik
kubectl -n traefik rollout status deploy/traefik
```

Annotate the **apex Service** so Traefik dials its ClusterIP, then create the
route:

```sh
kubectl -n playground annotate service playground-server-http \
  traefik.ingress.kubernetes.io/service.nativelb=true --overwrite

kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: playground
  namespace: playground
spec:
  ingressClassName: traefik
  rules:
    - http:
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

```sh
for i in $(seq 1 20); do ver /; done | sort | uniq -c
# 20 v2
```

`nativelb` is Traefik's `service-upstream`: remove it (or set it to `false`)
and you're back to the 50/50 endpoint bypass. The same `proxy-metrics` check
works on `deploy/traefik` in `-n traefik`.

Tear down:

```sh
kubectl -n playground delete ingress playground --ignore-not-found
kubectl -n playground annotate service playground-server-http \
  traefik.ingress.kubernetes.io/service.nativelb- || true
helm uninstall traefik -n traefik
kubectl delete ns traefik --ignore-not-found
```

## Envoy Gateway 1.7: `routingType: Service`

Envoy Gateway is Gateway API-native; the controller is configured with an
`EnvoyProxy` resource (referenced by the `GatewayClass`) rather than
per-Ingress annotations. Two knobs matter: the proxy pod is meshed via
`envoyDeployment.pod.annotations`, and **`spec.routingType: Service`** is
Envoy Gateway's `service-upstream`, making the data plane dial the
Service/ClusterIP instead of endpoints.

Install the 1.7 CRDs (Envoy Gateway's own; **not** the Gateway API CRDs,
which 00-setup already installed) and the controller:

```sh
helm template eg-crds oci://docker.io/envoyproxy/gateway-crds-helm --version v1.7.0 \
  --set crds.gatewayAPI.enabled=false \
  --set crds.envoyGateway.enabled=true \
  | kubectl apply --server-side -f -

helm install eg oci://docker.io/envoyproxy/gateway-helm --version v1.7.0 \
  -n envoy-gateway-system --create-namespace --skip-crds
```

Wire up the meshed proxy, Gateway, and a route to the apex Service:

```sh
kubectl apply -f - <<'EOF'
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: EnvoyProxy
metadata: { name: linkerd, namespace: envoy-gateway-system }
spec:
  routingType: Service          # Envoy Gateway's service-upstream
  provider:
    type: Kubernetes
    kubernetes:
      envoyDeployment:
        pod:
          annotations:
            linkerd.io/inject: enabled
---
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata: { name: eg-linkerd }
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
  parametersRef:
    group: gateway.envoyproxy.io
    kind: EnvoyProxy
    name: linkerd
    namespace: envoy-gateway-system
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: { name: eg, namespace: envoy-gateway-system }
spec:
  gatewayClassName: eg-linkerd
  listeners:
    - { name: http, protocol: HTTP, port: 80, allowedRoutes: { namespaces: { from: All } } }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: playground-ingress, namespace: playground }
spec:
  parentRefs:
    - { name: eg, namespace: envoy-gateway-system }
  rules:
    - backendRefs:
        - { name: playground-server-http, port: 8080 }
EOF
```

```sh
for i in $(seq 1 20); do ver /; done | sort | uniq -c
# 20 v2
```

The Gateway's `HTTPRoute` sends traffic to the apex Service; `routingType:
Service` makes the meshed Envoy dial its ClusterIP; the proxy applies the
producer-side `playground-server-canary` route, sending 100 % to canary.
Remove `routingType: Service` and you get the 50/50 endpoint bypass again.

Tear down:

```sh
kubectl -n playground delete httproute playground-ingress --ignore-not-found
helm uninstall eg -n envoy-gateway-system
kubectl delete ns envoy-gateway-system --ignore-not-found
```

## Envoy Gateway 1.8+: `BackendTrafficPolicy` (not yet usable with Linkerd)

From 1.8, `routingType` moves from `EnvoyProxy` to a `BackendTrafficPolicy`
that targets the route:

```sh
# EnvoyProxy / GatewayClass / Gateway / HTTPRoute are identical to 1.7
# (minus routingType on EnvoyProxy), plus:
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata: { name: linkerd-clusterip, namespace: playground }
spec:
  routingType: Service
  targetRefs:
    - { group: gateway.networking.k8s.io, kind: HTTPRoute, name: playground-ingress }
```

> **⚠ Caveat.** Envoy Gateway 1.8 requires **Gateway API v1.5.0**, but this
> playground (and Linkerd) pins the v1.4.0 CRD set from 00-setup. Upgrading
> the Gateway API CRDs cluster-wide currently breaks the Linkerd combo, so
> **1.8+ is not usable with Linkerd here yet**. Stay on the 1.7
> `EnvoyProxy.routingType` path above until that settles.

## kgateway: a Static `Backend` to the Service

kgateway (also Gateway API-native) reaches the Service through a Static
`Backend` whose host is the **Service FQDN**. That name resolves to the
ClusterIP, so the meshed Envoy dials the Service and the route applies. The
proxy pod is meshed via `GatewayParameters`.

Install the CRDs and controller:

```sh
helm upgrade -i kgateway-crds oci://cr.kgateway.dev/kgateway-dev/charts/kgateway-crds \
    --create-namespace --namespace kgateway-system \
    --version v2.1.3
helm upgrade -i kgateway oci://cr.kgateway.dev/kgateway-dev/charts/kgateway \
    --namespace kgateway-system \
    --version v2.1.3 \
    --set controller.image.pullPolicy=Always
```

Wire up the meshed Gateway, a Static `Backend` to the apex Service, and a route:

```sh
kubectl apply -f - <<'EOF'
apiVersion: gateway.kgateway.dev/v1alpha1
kind: GatewayParameters
metadata: { name: meshed-gw-params, namespace: kgateway-system }
spec:
  kube:
    podTemplate:
      extraAnnotations:
        linkerd.io/inject: enabled
      extraVolumes:                          # k3d temp-file crash workaround
        - { name: envoy-tmp, emptyDir: {} }
    envoyContainer:
      env: [{ name: TMPDIR, value: /tmp }]
      extraVolumeMounts:
        - { name: envoy-tmp, mountPath: /tmp }
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: { name: http, namespace: kgateway-system }
spec:
  gatewayClassName: kgateway
  infrastructure:
    parametersRef: { name: meshed-gw-params, group: gateway.kgateway.dev, kind: GatewayParameters }
  listeners:
    - { name: http, protocol: HTTP, port: 80, allowedRoutes: { namespaces: { from: All } } }
---
apiVersion: gateway.kgateway.dev/v1alpha1
kind: Backend
metadata: { name: playground-apex, namespace: playground }
spec:
  type: Static
  static:
    hosts:
      - { host: playground-server-http.playground.svc.cluster.local, port: 8080 }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: playground-ingress, namespace: playground }
spec:
  parentRefs: [{ name: http, namespace: kgateway-system }]
  rules:
    - backendRefs:
        - { name: playground-apex, kind: Backend, group: gateway.kgateway.dev }
EOF
```

```sh
for i in $(seq 1 20); do ver /; done | sort | uniq -c
# 20 v2
```

> The `extraVolumes` / `TMPDIR` block is a workaround for an Envoy temp-file
> crash on k3d, not a meshing requirement; drop it on a normal cluster.

Tear down:

```sh
kubectl -n playground delete httproute playground-ingress --ignore-not-found
kubectl -n playground delete backend playground-apex --ignore-not-found
helm uninstall kgateway -n kgateway-system
helm uninstall kgateway-crds -n kgateway-system
kubectl delete ns kgateway-system --ignore-not-found
```

## Ingress mode: Traefik with `l5d-dst-override`

When a controller can't be pointed at a ClusterIP, switch the **proxy**
instead: inject it with `linkerd.io/inject: ingress`. In that mode the proxy
ignores the pod IP the controller dialed and resolves the logical Service from
the `l5d-dst-override` header. This section shows it with Traefik (the same
controller works either way) and a **multi-path** route where each path
overrides to a different Service.

Reinstall Traefik in **ingress** mode:

```sh
kubectl create namespace traefik
kubectl annotate namespace traefik linkerd.io/inject=ingress
helm install traefik traefik/traefik -n traefik
kubectl -n traefik rollout status deploy/traefik
```

Confirm the proxy came up in ingress mode. The injector sets a dedicated env
var for `ingress` (not present for `enabled`); the proxy image is distroless,
so read it from the pod spec:

```sh
kubectl -n traefik get pod -l app.kubernetes.io/name=traefik \
  -o jsonpath='{range .items[0].spec.containers[?(@.name=="linkerd-proxy")].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -i ingress
# LINKERD2_PROXY_INGRESS_MODE=true
```

Define two `Middleware`s that set `l5d-dst-override`: one to the apex Service
(which carries the canary split), one directly to the primary Service. Attach
each to its own path via an `IngressRoute`. Because `customRequestHeaders`
**overwrites** the header, it also strips any client-injected value, closing
the open-relay hole for each route:

```sh
kubectl apply -f - <<'EOF'
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata: { name: dst-apex, namespace: playground }
spec:
  headers:
    customRequestHeaders:
      l5d-dst-override: "playground-server-http.playground.svc.cluster.local:8080"
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata: { name: dst-primary, namespace: playground }
spec:
  headers:
    customRequestHeaders:
      l5d-dst-override: "playground-server-http-primary.playground.svc.cluster.local:8080"
---
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata: { name: multipath, namespace: playground }
spec:
  entryPoints: [web]
  routes:
    - match: PathPrefix(`/apex`)
      kind: Rule
      middlewares: [{ name: dst-apex }]
      services:
        - { name: playground-server-http, port: 8080 }
    - match: PathPrefix(`/primary`)
      kind: Rule
      middlewares: [{ name: dst-primary }]
      services:
        - { name: playground-server-http-primary, port: 8080 }
EOF
```

Probe both paths:

```sh
while true; do
  echo "$(date '+%H:%M:%S')  /apex=$(ver /apex)  /primary=$(ver /primary)"
  sleep 1
done
# 20:16:16  /apex=v2  /primary=v1
```

`/apex` re-resolves to the apex Service, so the `playground-server-canary`
HTTPRoute fires, returning **v2**. `/primary` re-resolves to the primary
Service directly, returning **v1**. Traefik dialed pod IPs in both cases; the
proxy ignored them and routed on the header.

**Optional wire-level confirmation.** Watch the header on Traefik's
*outbound* proxy port (`4140`) from the node, then curl a path in another
terminal:

```sh
POD=$(kubectl -n traefik get pod -l app.kubernetes.io/name=traefik -o jsonpath='{.items[0].metadata.name}')
NODE=$(kubectl -n traefik get pod "$POD" -o jsonpath='{.spec.nodeName}')
kubectl debug node/$NODE -it --image=nicolaka/netshoot --profile=sysadmin
# inside the debug pod:
pid=$(pgrep -x traefik | head -1)
nsenter -t "$pid" -n ngrep -d any -W byline -q -i 'l5d-dst-override' 'tcp port 4140'
# in another terminal:  curl -s localhost:8081/apex
```

You should see `l5d-dst-override:
playground-server-http.playground.svc.cluster.local:8080` on the wire: the
value the Middleware injected, which is what the proxy routes on.

Tear down:

```sh
kubectl -n playground delete ingressroute multipath --ignore-not-found
kubectl -n playground delete middleware dst-apex dst-primary --ignore-not-found
helm uninstall traefik -n traefik
kubectl delete ns traefik --ignore-not-found
```

## Why this happens

The outbound proxy decides where to send a connection from its **original
destination address**, by asking the destination controller:

- **ClusterIP** (or a name that resolves to one): the controller returns the
  **logical Service**, its endpoint set (for load balancing), `HTTPRoute`s,
  `ServiceProfile`, traffic splits, and retries. The proxy runs the full L7
  stack.
- **Pod IP**: the controller returns that **single endpoint**. Nothing to
  balance, no Service-attached policy. The proxy forwards directly to that pod.

Ingress controllers default to the second path: they resolve the Service to
its `Endpoints` themselves and dial pod IPs. A meshed controller out of the
box therefore drops to bare endpoint-forwarding and skips every Service-level
feature, silently, because mTLS and `200`s are unaffected.

The two fix families address different ends of the same connection:

- **Dial the Service** (`service-upstream`, `nativelb`, `routingType:
  Service`, a Static `Backend` to the FQDN) changes the **controller**: hand
  the proxy a ClusterIP and the first bullet applies. Normal injection, nothing
  special on the proxy.
- **Ingress mode** changes the **proxy**: ignore the original dst IP and
  resolve the logical Service from `l5d-dst-override` instead (falling back to
  the original destination if that header is absent). The controller can keep
  dialing pod IPs; the proxy re-resolves to the Service anyway.

**Security.** In ingress mode the proxy routes wherever `l5d-dst-override`
says. If an external client can set that header, they can make the ingress
relay to **any** cluster-internal (or external) address, an SSRF-grade open
relay. Always overwrite or strip `l5d-dst-override` on the way in; Traefik's
`customRequestHeaders` does this automatically (it overwrites), but **every**
route must do it. This is also why ingress mode belongs on the controller
**pod** only, never on a whole namespace whose other workloads should mesh
normally.

## Diagnose

```sh
# 1. Is the controller meshed, and in which mode? (swap the label per controller)
kubectl -n ingress-nginx get pod -l app.kubernetes.io/component=controller   # READY 2/2
kubectl -n traefik       get pod -l app.kubernetes.io/name=traefik           # READY 2/2
# Ingress mode sets this env on the proxy; "enabled" does not. The proxy is
# distroless (no `env` binary), so read it from the pod spec:
kubectl -n traefik get pod -l app.kubernetes.io/name=traefik \
  -o jsonpath='{range .items[0].spec.containers[?(@.name=="linkerd-proxy")].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -i ingress
# LINKERD2_PROXY_INGRESS_MODE=true   (only in ingress mode)

# 2. Behavioral probe (the unambiguous test): does the canary HTTPRoute take
#    effect *through the ingress*?
for i in $(seq 1 20); do ver /; done | sort | uniq -c
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

An HTTP/gRPC ingress must reach its backends **through the Service**. Pick
the per-controller knob that does it, keep normal injection, and fall back to
ingress mode only when no such knob exists:

| Controller | Fix | Inject mode |
|---|---|---|
| ingress-nginx | `nginx.ingress.kubernetes.io/service-upstream: "true"` on the Ingress | `enabled` |
| Traefik | `traefik.ingress.kubernetes.io/service.nativelb: "true"` on the Service | `enabled` |
| Envoy Gateway 1.7 | `spec.routingType: Service` on the `EnvoyProxy` | `enabled` |
| kgateway | Static `Backend` whose host is the Service FQDN | `enabled` |
| Kong / Contour / Gloo / HAProxy / GCE / EnRoute, or any controller without a ClusterIP knob | ingress mode + `l5d-dst-override: <svc>.<ns>.svc.cluster.local:<port>` per route (overwrite to strip inbound values) | `ingress` |

Re-run the behavioral probe after the fix: the canary `HTTPRoute` should
return **v2 only** through the ingress.

## Revert

```sh
# Ingress / route objects (whichever controller you ran)
kubectl -n playground delete ingress playground --ignore-not-found
kubectl -n playground delete ingressroute multipath --ignore-not-found
kubectl -n playground delete middleware dst-apex dst-primary l5d-dst-override --ignore-not-found
kubectl -n playground delete httproute playground-ingress --ignore-not-found
kubectl -n playground delete backend playground-apex --ignore-not-found
kubectl -n playground annotate service playground-server-http \
  traefik.ingress.kubernetes.io/service.nativelb- 2>/dev/null || true

# The probe route
kubectl -n playground delete httproute playground-server-canary --ignore-not-found

# Controllers
helm uninstall ingress-nginx -n ingress-nginx 2>/dev/null || true
helm uninstall traefik -n traefik 2>/dev/null || true
helm uninstall eg -n envoy-gateway-system 2>/dev/null || true
helm uninstall kgateway -n kgateway-system 2>/dev/null || true
helm uninstall kgateway-crds -n kgateway-system 2>/dev/null || true
kubectl delete ns ingress-nginx traefik envoy-gateway-system kgateway-system --ignore-not-found
```
