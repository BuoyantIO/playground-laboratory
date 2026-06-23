# 13: Linkerd CNI race: pod starts before iptables rules are installed

When you use the **linkerd-cni** plugin instead of the init-container path,
a DaemonSet on every node installs Linkerd's CNI binary into the chained
CNI configuration. The plugin runs on every pod creation and installs the
iptables redirect rules that funnel traffic through the proxy.

The race: if a meshed pod is scheduled to a node **before** the linkerd-cni
DaemonSet pod is `Ready` on that node, the kubelet creates the pod without
Linkerd's CNI step ever running. The pod comes up looking normal, sidecar
attached, app running, but **no iptables rules**. Traffic from the app
bypasses the proxy completely. Plaintext. No mTLS. No HTTP metrics. No
policy enforcement.

This is what the **mTLS badge on the Live traffic dashboard exists for**.
When the badge flips to red "plain" on a meshed pod, you're in this
scenario (or runbook 14).

## Setup

Use the **CNI variant** of [00-setup.md](00-setup.md):

```sh
k3d cluster create sma --servers 1 --agents 1 \
  --image rancher/k3s:v1.30.1-k3s1 --k3s-arg '--disable=traefik@server:*'

# Install linkerd-cni first
linkerd install-cni | kubectl apply -f -
kubectl -n linkerd-cni rollout status ds/linkerd-cni

# Then control plane with the cni-enabled flag
linkerd enterprise install --crds | kubectl apply -f -
linkerd enterprise install --linkerd-cni-enabled | kubectl apply -f -
linkerd enterprise check --pre
linkerd enterprise check

docker build -t sma-server:dev server/ && docker build -t sma-client:dev client/
k3d image import sma-server:dev sma-client:dev -c sma
helm upgrade --install sma helm/sma
kubectl -n sma rollout status deploy/sma-server-v1 deploy/sma-server-v2 deploy/sma-client

kubectl -n sma port-forward svc/sma-client 3000:3000 &
open http://localhost:3000
```

Baseline: UI shows green `mTLS verified` badge and the protocol banner
reads `HTTP/1.1 · mTLS`. The `client-id` field shows the
`sma-server-v1.sma.serviceaccount.identity.linkerd.cluster.local`.

## Symptom

After triggering the race:

- Client UI keeps showing `200`s, normal latency.
- **`mTLS` column flips to red `plain`** on every new row.
- Topology protocol banner turns red and reads `HTTP/1.1 · plaintext`.
- The `client-id` field at the bottom of the topology shows `-`.
- Application *thinks* everything is fine because TCP works.
- Inbound proxy HTTP metrics on the server pod stop incrementing: the proxy
  is sitting on `:4143` waiting for connections that never arrive.

This is the exact failure mode you don't want in production. mTLS silently
absent.

## Recreate

Force a race by parking the linkerd-cni DaemonSet, then rolling the server:

```sh
# 1. Pin linkerd-cni off all nodes via an impossible nodeSelector
kubectl -n linkerd-cni patch ds linkerd-cni \
  --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/nodeSelector","value":{"linkerd-cni":"absent"}}]'

# 2. Wait for the CNI pods to be terminated on all nodes
kubectl -n linkerd-cni get pods -w   # Ctrl-C once you see no pods left

# 3. Restart the server deployment: new pods admit, but the CNI chain has
# no linkerd step on these nodes, so no iptables rules are installed.
kubectl -n sma rollout restart deploy/sma-server-v1
kubectl -n sma rollout status deploy/sma-server-v1
```

## What you'll see

The dashboard. The mTLS column should flip from green `mTLS` to red `plain`
within a poll or two, and the topology protocol banner turns red.

Verify with curl:

```sh
kubectl -n sma exec deploy/sma-client -c client -- \
  curl -sv -o /dev/null http://sma-server.sma.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< x-mesh-client-id|< l5d'
```

```
< HTTP/1.1 200 OK
< x-mesh-client-id:          ← empty value! mTLS did not happen.
< x-served-by: sma-server-...
```

That empty `x-mesh-client-id` is the dead giveaway: the request reached the
app, but it didn't traverse the inbound proxy, so the proxy never injected
its `l5d-client-id` header for the server to echo back.

Look at iptables inside the broken server pod (use `nsenter` or
`crictl exec`, `kubectl exec` runs in the pod's namespace already):

```sh
kubectl -n sma exec deploy/sma-server-v1 -c linkerd-proxy --  \
  iptables -t nat -L PROXY_INIT_REDIRECT 2>&1 | head -10
```

```
iptables: No chain/target/match by that name.
```

Compare to a properly-meshed pod (one created when linkerd-cni was Ready):

```
Chain PROXY_INIT_REDIRECT (1 references)
target     prot opt source               destination
RETURN     tcp  --  anywhere             anywhere   ... dpt:4143
...
REDIRECT   tcp  --  anywhere             anywhere   ... redir ports 4143
```

Server-side inbound proxy:

```sh
kubectl -n sma logs deploy/sma-server-v1 -c linkerd-proxy --tail=20
```

```
# Silent: the proxy is listening on :4143 but no connections arrive because
# nothing in the pod's network namespace is redirecting to it.
```

Server-side proxy admin metrics confirm no inbound requests:

```sh
kubectl -n sma exec deploy/sma-server-v1 -c linkerd-proxy -- \
  curl -s http://localhost:4191/metrics \
  | grep -E '^inbound_http_request_total' | head -3
# (zeros or stale values)
```

## Why this happens

The Linux CNI chain is called by kubelet once per pod, in order. The
`linkerd-cni` plugin is one stage in that chain. Two things must hold for it
to run on a given pod creation:

1. The `linkerd-cni` binary must be present on the node (installed by the
   DaemonSet).
2. The chained CNI config file (`/etc/cni/net.d/*-linkerd-cni-kubeconfig`)
   must be present.

Both are installed by the linkerd-cni DaemonSet pod when it starts on a
node. If kubelet schedules a meshed app pod onto a node before the
DaemonSet pod has run, the CNI chain runs without the Linkerd step, the
pod is admitted by the proxy-injector (which sees the namespace
annotation), the sidecar starts, but no iptables redirects exist,
traffic from the app container goes out the pod's network as plaintext,
direct to the Service VIP.

This race is most common at:

- Cluster bootstrap (DaemonSets and Deployments rolling at the same time).
- Adding a new node to the cluster (workloads scheduled while linkerd-cni
  is still pulling its image).
- DaemonSet crashes / image-pull failures that leave a node without the
  plugin for any window of time.

Linkerd's documented mitigation is to use the
`linkerd-cni-disabled` annotation plus an init-container fallback, or to
pre-schedule the DaemonSet via a `priorityClassName` and an
`InitContainer` that blocks on its readiness.

## Diagnose

```sh
# 1. The dashboard's mTLS column is the first signal, that's what it's
#    there for.

# 2. Inspect any "meshed but bypassed" pod's iptables.
POD=$(kubectl -n sma get pod -l app=sma-server -o jsonpath='{.items[0].metadata.name}')
kubectl -n sma exec "$POD" -c linkerd-proxy -- \
  iptables -t nat -L 2>&1 | grep -E 'PROXY_INIT|4143' || \
  echo "NO iptables rules, CNI race confirmed"

# 3. Is linkerd-cni running on the node where the pod is?
NODE=$(kubectl -n sma get pod "$POD" -o jsonpath='{.spec.nodeName}')
kubectl -n linkerd-cni get pods -o wide | grep "$NODE" \
  || echo "linkerd-cni missing on node $NODE"

# 4. Confirm: hit the server through the meshed client, empty
#    x-mesh-client-id header.
kubectl -n sma exec deploy/sma-client -c client -- \
  curl -sv -o /dev/null http://sma-server.sma.svc.cluster.local:8080/ 2>&1 \
  | grep -i x-mesh-client-id
```

## Fix

Get the CNI plugin back, then re-roll any pods that were created without it.
The pods can never become meshed retroactively: they need to be replaced:

```sh
# 1. Un-park the DaemonSet
kubectl -n linkerd-cni patch ds linkerd-cni \
  --type=json -p='[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n linkerd-cni rollout status ds/linkerd-cni

# 2. Roll the affected workloads, once CNI is on the node, new pods get
#    iptables rules properly.
kubectl -n sma rollout restart deploy/sma-server-v1
kubectl -n sma rollout status deploy/sma-server-v1
```

UI flips back to green `mTLS verified`.

## Revert

(Same as Fix, already restored the cluster to a healthy state.)
