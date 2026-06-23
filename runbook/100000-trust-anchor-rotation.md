# 14: Trust anchor rotated without a bundle → mesh-wide mTLS break

Linkerd's mTLS hierarchy is:

```
trust anchor (root CA, baked into every proxy's config)
  └─ identity issuer (intermediate CA, owned by linkerd-identity)
       └─ workload cert (issued per pod, short-lived)
```

When you rotate the trust anchor, every proxy needs to trust both the old
and the new root for the cutover window. The standard way to manage that
is **trust-manager** (or the equivalent bundle workflow), which publishes
a multi-cert bundle so all proxies trust both roots during rotation.

If you rotate the trust anchor *without* the bundle (the operator
hot-swaps the configmap with only the new root), proxies pick up the new
root on restart but immediately fail to validate any peer whose cert was
signed by the old chain, and vice versa. mTLS handshakes start failing
across the mesh.

This runbook is meant to be terminal: once you trip it on a cluster, the
cleanest recovery is `k3d cluster delete sma`. Don't run this against a
shared dev cluster.

## Setup

Use the **manual trust anchor variant** of [00-setup.md](00-setup.md):

```sh
brew install step                  # or: choose your CA tooling

# Generate root + intermediate (call these "old")
step certificate create root.linkerd.cluster.local \
  ca-old.crt ca-old.key --profile root-ca \
  --no-password --insecure --not-after=87600h

step certificate create identity.linkerd.cluster.local \
  issuer-old.crt issuer-old.key --profile intermediate-ca \
  --not-after 8760h --no-password --insecure \
  --ca ca-old.crt --ca-key ca-old.key

# Cluster
k3d cluster create sma --servers 1 --agents 1 \
  --image rancher/k3s:v1.30.1-k3s1 --k3s-arg '--disable=traefik@server:*'

# Linkerd Enterprise with our hand-rolled identity chain
linkerd enterprise install --crds | kubectl apply -f -
linkerd enterprise install \
  --identity-trust-anchors-file=ca-old.crt \
  --identity-issuer-certificate-file=issuer-old.crt \
  --identity-issuer-key-file=issuer-old.key \
  | kubectl apply -f -
linkerd enterprise check

# SMA
docker build -t sma-server:dev server/ && docker build -t sma-client:dev client/
k3d image import sma-server:dev sma-client:dev -c sma
helm upgrade --install sma helm/sma
kubectl -n sma rollout status deploy/sma-server-v1 deploy/sma-server-v2 deploy/sma-client

kubectl -n sma port-forward svc/sma-client 3000:3000 &
```

UI should show green `mTLS verified` baseline.

## Symptom

After rotating the trust anchor incorrectly:

- Client UI: every poll red `502`, mTLS badge red `plain`.
- All inter-pod mTLS handshakes fail.
- `linkerd-identity` logs are clean: it's still issuing certs, just with a
  root the rest of the mesh no longer trusts.
- Proxy logs are full of `certificate verify failed`-style errors.

## Recreate

Step 1: generate the **new** trust anchor + intermediate, *not* bundled
with the old:

```sh
step certificate create root.linkerd.cluster.local \
  ca-new.crt ca-new.key --profile root-ca \
  --no-password --insecure --not-after=87600h

step certificate create identity.linkerd.cluster.local \
  issuer-new.crt issuer-new.key --profile intermediate-ca \
  --not-after 8760h --no-password --insecure \
  --ca ca-new.crt --ca-key ca-new.key
```

Step 2: replace the trust anchor in the cluster *without* the bundle.
This is the mistake; the correct workflow is to first publish a bundle of
`(ca-old.crt + ca-new.crt)` and wait for every proxy to roll, then swap.

```sh
# Replace trust roots configmap with ONLY the new root
NEW_ROOT=$(cat ca-new.crt)
kubectl -n linkerd patch configmap linkerd-identity-trust-roots \
  --type=merge -p "{\"data\":{\"ca-bundle.crt\":\"$(echo "$NEW_ROOT" | awk '{printf "%s\\n", $0}')\"}}"

# Replace the issuer secret with the new intermediate
kubectl -n linkerd create secret tls linkerd-identity-issuer \
  --cert=issuer-new.crt --key=issuer-new.key \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart linkerd-identity so it picks up the new issuer
kubectl -n linkerd rollout restart deploy/linkerd-identity
kubectl -n linkerd rollout status deploy/linkerd-identity
```

Step 3: restart the server so its proxy renews using the new chain. The
*client* pod is still untouched and continues to trust only the OLD root:

```sh
kubectl -n sma rollout restart deploy/sma-server-v1
kubectl -n sma rollout status deploy/sma-server-v1
```

Now the server-side proxy presents a cert signed by the new chain. The
client-side proxy still has the OLD root in `LINKERD2_PROXY_IDENTITY_TRUST_ANCHORS`.
mTLS handshake fails.

## What you'll see

UI flips to all-red `502` rows.

Curl from the meshed client:

```sh
kubectl -n sma exec deploy/sma-client -c client -- \
  curl -sv -o /dev/null http://sma-server.sma.svc.cluster.local:8080/ 2>&1 \
  | grep -E '< HTTP|< l5d'
```

```
< HTTP/1.1 502 Bad Gateway
< l5d-proxy-error: connection error: unable to verify certificate / unknown issuer
< l5d-proxy-connection: close
```

Client-side outbound proxy logs:

```sh
kubectl -n sma logs deploy/sma-client -c linkerd-proxy --tail=30
```

```
WARN outbound: linkerd_proxy_tls::client: TLS handshake failed
  error=invalid peer certificate: UnknownIssuer
WARN outbound:rescue{...}: HTTP/1.1 request failed
  error=connect error: invalid peer certificate: UnknownIssuer
```

Server-side proxy logs (a mirror of the same problem on inbound from any
peer that hasn't rotated):

```sh
kubectl -n sma logs deploy/sma-server-v1 -c linkerd-proxy --tail=20
```

```
INFO inbound:accept: linkerd_proxy_tls::server: TLS handshake failed
  client.addr=10.244.0.21:... error=peer terminated handshake
```

`linkerd enterprise check` flags the mismatch:

```sh
linkerd enterprise check --proxy 2>&1 | grep -A2 -i 'trust\|root'
```

```
× control plane proxies and CLI versions match
× trust roots are using a valid set of root certificates
    proxy in pod sma-client-... trusts a different root than the
    identity issuer is signing with
```

## Why this happens

Each proxy receives the trust anchor at pod creation time via env var:

```yaml
- name: LINKERD2_PROXY_IDENTITY_TRUST_ANCHORS
  valueFrom:
    configMapKeyRef:
      name: linkerd-identity-trust-roots
      key: ca-bundle.crt
```

Env vars are evaluated **at container start**. Updating the configmap does
*not* propagate to running pods, only to pods that start after the update.

So after step 2:

- `linkerd-identity` issues new workload certs signed by `ca-new`.
- Any pod that *restarts* picks up `ca-new` as its sole trust anchor.
- Any pod that *doesn't restart* still has `ca-old` baked in.

When pod A (old root) and pod B (new root) try to mTLS:

- Pod A presents a cert signed by `ca-new` (issued after the swap and
  renewed). Pod B's outbound TLS stack rejects it: "unknown issuer".
- Pod A's outbound TLS stack rejects pod B's cert for the same reason.

The proxy maps TLS verification failures to `bad_gateway` via the same
rescue chain that handles connection-refused (runbook 03), synthesiser is
`bad_gateway` in
[linkerd/app/core/src/errors/respond.rs:88-96](../../buoyant/buoyant-proxy/linkerd/app/core/src/errors/respond.rs).

The correct way to do this rotation is the bundle workflow:

1. Publish a configmap containing `ca-old.crt` *concatenated with*
   `ca-new.crt`.
2. Wait for every proxy in the mesh to roll (or restart them all). Now
   every proxy trusts both roots.
3. Switch the identity issuer to the new intermediate. New certs are now
   signed by `ca-new`, but everyone still trusts `ca-old` *and* `ca-new`.
4. After the old workload certs have all rotated out (max one
   `issuance-lifetime` later), publish a configmap containing only
   `ca-new.crt`. Restart proxies one more time to drop the old root.

`trust-manager` automates this by maintaining the bundle as a separate
resource, but the manual workflow is the same shape.

## Diagnose

```sh
# 1. What trust anchor is each proxy actually using?
for pod in $(kubectl -n sma get pods -o name); do
  echo "=== $pod ==="
  kubectl -n sma exec "$pod" -c linkerd-proxy -- env \
    | grep TRUST_ANCHORS | head -1
done
# Compare the env var values between the broken (old) and re-rolled (new)
# pods.

# 2. What's in the current configmap?
kubectl -n linkerd get cm linkerd-identity-trust-roots \
  -o jsonpath='{.data.ca-bundle\.crt}' \
  | openssl x509 -noout -subject -dates

# 3. linkerd's own check covers this:
linkerd enterprise check --proxy

# 4. From the data plane: TLS handshake failures with "unknown issuer".
kubectl -n sma logs deploy/sma-client -c linkerd-proxy --tail=20 \
  | grep -i 'unknown issuer\|verify failed\|handshake'
```

## Fix

You're not going to recover this cluster without restarting every meshed
pod. The path back to green:

```sh
# 1. Replace the configmap with a BUNDLE of both roots
cat ca-old.crt ca-new.crt > ca-bundle.crt
kubectl -n linkerd create configmap linkerd-identity-trust-roots \
  --from-file=ca-bundle.crt=ca-bundle.crt \
  --dry-run=client -o yaml | kubectl apply -f -

# 2. Roll every meshed pod so they all pick up the bundle
kubectl -n sma rollout restart deploy/sma-server-v1 deploy/sma-server-v2 deploy/sma-client
kubectl -n linkerd rollout restart deploy   # control plane proxies too
kubectl -n sma rollout status deploy/sma-server-v1 deploy/sma-server-v2 deploy/sma-client

# 3. Verify
linkerd enterprise check
```

Or, more honestly: blow the cluster away and start fresh.

```sh
k3d cluster delete sma
```

## Revert

See above: `k3d cluster delete sma` is the cleanest "revert".
