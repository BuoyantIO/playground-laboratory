# Troubleshooting runbooks

A set of failure scenarios you can reproduce against the SMA example app on a
fresh k3d cluster running Linkerd Enterprise. Each runbook is self-contained:
spin up a cluster, drive one failure, walk the audience through the
diagnosis, then tear down (or revert).

These runbooks are deliberately about **problems**, not features. They
showcase what goes wrong, what the mesh says about it, and how an SRE
distinguishes mesh-side failures from app-side failures with nothing more
than `kubectl`, `curl` and the proxy admin server. **No `linkerd viz`
required anywhere.**

## How to use this directory

1. **Start with [00-setup.md](00-setup.md):** k3d cluster, Linkerd
   Enterprise install, SMA app deploy, dashboard port-forward. Each
   subsequent runbook assumes the baseline from this file: green `200`s
   in the UI with green `mTLS` badges on every sample and both `v1` and
   `v2` versions appearing in roughly equal proportions.

2. **Pick a runbook** by failure mode (table below). Run its "Recreate"
   step, walk through "What you'll see" and "Diagnose", apply "Fix",
   then "Revert" to return to baseline.

3. **Reset between sessions** when something gets stuck: `k3d cluster
   delete sma` and re-run `00-setup.md`. It takes ~90 seconds.

## The dashboard

The SMA app's home page is your training visual. It polls the apex
`sma-server` Service every second and surfaces five signals you'll be
teaching against:

- **Status code** per request, in a pill.
- **Latency** of the last fetch.
- **Version** (v1 / v2) of the backend that served the response, the
  chart deploys both versions behind the same apex Service, so by default
  kube-proxy alternates between them.
- **mTLS column:** green `mTLS` if the response included an
  `x-mesh-client-id` header (the inbound proxy intercepted and forwarded
  the verified peer identity), red `plain` otherwise.
- **client-id** value in the topology footer.

The Topology now shows the client on the left, a fork in the middle, and
**two** server nodes (v1 and v2) on the right. The pulse animates to
whichever version served the latest request, and per-version hit counters
sit on each node.

## The error-code → trigger cheat-sheet

| Symptom | Likely cause | Runbook |
| --- | --- | --- |
| Bunch of `503` with no `l5d-proxy-error` | App returned it deliberately | [01](01-app-injected-503.md) |
| `504` + `l5d-proxy-error: failfast`, duration ≈ 3 s | No ready endpoints; balancer in failfast | [02](02-failfast-no-endpoints.md) |
| `502` + `l5d-proxy-error: Connection refused`, near-instant | Service `targetPort` mismatch; app not on that port | [03](03-connection-refused-502.md) |
| Persistent `504 failfast` + pod in `CrashLoopBackOff` | Server crashes on startup; endpoints never become ready | [04](04-crashloop-failfast.md) |
| `403` + `l5d-proxy-error: unauthorized request on route` | AuthorizationPolicy doesn't match caller identity | [05](05-authorization-403.md) |
| `502` + `l5d-proxy-error: identity required` | `l5d-require-id` pinned to the wrong SA | [06](06-mtls-identity-required.md) |
| `502` + `Connection refused` to `:4143` in proxy logs | NetworkPolicy blocks the inbound proxy port | [07](07-networkpolicy-blocks-proxy.md) |
| `200` but no HTTP metrics / no route policy firing | HTTP port mis-marked as opaque | [08](08-opaque-port-mishap.md) |
| New pods can't admit; `x509: certificate has expired` in events | Webhook caBundle is expired / invalid | [09](09-webhook-cabundle-expired.md) |
| Client UI shows `ERR` (status 0), server logs the 200 a moment later | Client tore down the mTLS connection before the server replied | [10](10-client-tls-terminated.md) |
| `nc` from a meshed pod hangs ~10 s and disconnects with no banner | Outbound protocol-detection timeout | [11](11-protocol-detection-timeout.md) |
| `502` from the proxy, control plane logs `TokenReview failed` | SA deleted/recreated; workload cert renewal fails | [12](12-sa-recreated-cert-renewal-fails.md) |
| `200`s with **mTLS column red `plain`** in the UI | linkerd-cni race, iptables redirect rules never installed | [13](13-cni-race-condition.md) |
| All-cluster `502` with `unknown issuer` in proxy logs | Trust anchor rotated without a bundle | [14](14-trust-anchor-rotation.md) |
| UI stuck on only v1 (or only v2) despite an HTTPRoute that says otherwise | ServiceProfile with `dstOverrides` is silently overriding the HTTPRoute | [15](15-serviceprofile-vs-httproute.md) |

## The diagnostic toolkit (no viz)

Every runbook leans on these five techniques. Memorise them and you don't
need viz:

```sh
# 1. Proxy logs, always the authoritative source.
kubectl -n sma logs deploy/sma-client -c linkerd-proxy --tail=50 -f
kubectl -n sma logs deploy/sma-server-v1 -c linkerd-proxy --tail=50 -f
kubectl -n sma logs deploy/sma-server-v2 -c linkerd-proxy --tail=50 -f

# 2. Raise proxy log level at runtime (no restart).
kubectl -n sma exec deploy/sma-client -c linkerd-proxy -- \
  curl -sS -X PUT -d 'linkerd=debug,info' http://localhost:4191/proxy-log-level

# 3. Proxy metrics from the admin endpoint :4191
kubectl -n sma exec deploy/sma-client -c linkerd-proxy -- \
  curl -s http://localhost:4191/metrics \
  | grep -E 'failfast|response_total|endpoints|detect'

# 4. Endpoint membership the destination controller is pushing.
linkerd diagnostics endpoints sma-server.sma.svc.cluster.local:8080

# 5. Curl from inside a meshed peer with -v to see the response headers
#    the proxy added. Look for: l5d-proxy-error, l5d-proxy-connection,
#    x-mesh-client-id, x-app-version.
kubectl -n sma exec deploy/sma-client -c client -- \
  curl -sv http://sma-server.sma.svc.cluster.local:8080/ 2>&1 | tail -20
```

## Reading the proxy's "language"

### `l5d-proxy-error` response header

When the proxy synthesises an error response *itself* (the request never made
it to the application or the response never came back), it sets:

```
l5d-proxy-error: <reason>
l5d-proxy-connection: close      # only when close_connection = true
```

The header is only emitted when the receiver is a meshed peer (mTLS
established), see
[linkerd/app/core/src/errors/respond.rs](../../buoyant/buoyant-proxy/linkerd/app/core/src/errors/respond.rs).
In practice that means `curl` from inside a meshed pod sees it; `curl` from
your laptop via port-forward typically does not.

If `l5d-proxy-error` is **absent** and you got a 5xx, the application
produced the error. If it's **present**, the proxy did.

### `x-mesh-client-id` response header (added by the SMA server)

The SMA Go server echoes the `l5d-client-id` header it received as
`x-mesh-client-id` on every response (see
[server/main.go](../server/main.go)). The Next.js client surfaces this in
the UI as the `mTLS` badge and the `client-id` value at the bottom of the
topology.

- **Present** ⇒ mTLS happened; the inbound proxy intercepted the request
  and reported the verified caller identity.
- **Empty** ⇒ traffic bypassed the proxy (runbook 13) *or* the response
  came from the proxy itself before the request reached the app (runbooks
  02/03/06/etc.).

### `x-app-version` response header (added by the SMA server)

Echoes the server's `APP_VERSION` env var (`v1` or `v2`). The UI uses it
to colour the **Version** column in the Recent samples table and to
animate the pulse to the right server node. Critical for runbook 15
(ServiceProfile vs HTTPRoute) and useful for any traffic-shaping demo.

## Helm chart knobs (no rebuilds required)

All failure modes are driven through Helm values. You never have to rebuild
an image to swap scenarios:

| Knob | Read in | Used by |
| --- | --- | --- |
| `server.env.LATENCY_MS` | [server/main.go](../server/main.go) | 10, 11 |
| `server.env.LATENCY_JITTER_MS` | server/main.go | (general) |
| `server.env.ERROR_RATE` / `ERROR_CODE` | server/main.go | 01 |
| `server.env.FAIL_ON_STARTUP` | server/main.go | 04 |
| `server.env.CRASH_AFTER_REQUESTS` | server/main.go | (general) |
| `server.env.READINESS_FAIL_RATE` | server/main.go | (general) |
| `server.serviceAccount.name` / `serverV2.serviceAccount.name` / `client.serviceAccount.name` | helm chart (drives mesh identity) | 05, 06, 12 |
| `server.podAnnotations` | helm chart | 08 |
| `server.version`, `serverV2.version` | helm chart | 15 |
| `serverV2.env.RESPONSE_TEXT` | server/main.go | 15 |
| `client.env.FETCH_TIMEOUT_MS` | [client/app/api/ping/route.ts](../client/app/api/ping/route.ts) | 10 |

## Reset between runbooks

```sh
# Drop policy/route/profile/network resources.
kubectl -n sma delete httproute,authorizationpolicy,meshtlsauthentication,\
networkauthentication,server.policy.linkerd.io,serviceprofile,networkpolicy \
  --all --ignore-not-found

# Reset the Helm release.
helm upgrade --install sma helm/sma --reset-values
kubectl -n sma rollout status deploy/sma-server-v1 deploy/sma-server-v2 \
  deploy/sma-client
```

When in doubt: `k3d cluster delete sma` and run [00-setup.md](00-setup.md).
