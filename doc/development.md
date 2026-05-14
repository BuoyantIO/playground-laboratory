# Local development

Run the server and client directly on your machine — no cluster required.

## Prerequisites

- Go 1.22+
- Node.js 20+
- npm (ships with Node.js)

## 1. Run the server

The server is now laid out for multiple binaries (HTTP today, gRPC later) — the entrypoint lives under `cmd/http/`:

```sh
cd server
go run ./cmd/http
```

Listens on `:8080` by default. Verify:

```sh
curl http://localhost:8080
# test
```

### Inject failures via env vars

All knobs are env-driven, so prefix the command:

```sh
LATENCY_MS=500 LATENCY_JITTER_MS=200 ERROR_RATE=30 ERROR_CODE=503 go run ./cmd/http
```

| Variable               | Default | Meaning                                   |
| ---------------------- | ------- | ----------------------------------------- |
| `PORT`                 | `8080`  | Listen port                               |
| `RESPONSE_TEXT`        | `test`  | Body returned on success                  |
| `APP_VERSION`          | `v1`    | Echoed back as `X-App-Version` (used by the dashboard's fork visualization — set `v2` to simulate the canary) |
| `LATENCY_MS`           | `0`     | Fixed sleep before responding (ms)        |
| `LATENCY_JITTER_MS`    | `0`     | Random extra latency `[0, jitter)` (ms)   |
| `ERROR_RATE`           | `0`     | Percent (0–100) of requests that fail     |
| `ERROR_CODE`           | `500`   | Status code returned when failing         |
| `FAIL_ON_STARTUP`      | `false` | Exit immediately — simulates crash loop   |
| `CRASH_AFTER_REQUESTS` | `0`     | Exit after N requests (0 = never)         |
| `READINESS_FAIL_RATE`  | `0`     | Percent of `/healthz` probes that fail    |

The injection logic lives in `server/internal/faults/` and the env parsing in `server/internal/config/`, both protocol-agnostic so a future `cmd/grpc/` entrypoint reuses them as-is.

## 2. Run the client

In a second terminal:

```sh
cd client
npm install            # first time only
SERVER_URL=http://localhost:8080 npm run dev
```

Open <http://localhost:3000>. The Next.js process pings `SERVER_URL` on its own ticker — traffic starts at boot, independently of any browser. The dashboard subscribes to the resulting sample stream over SSE (`/api/samples/stream`), so opening the page shows whatever the pod has already been doing and stays live thereafter. The polling-interval dropdown is a remote control that POSTs to `/api/config` and mutates the server ticker.

If `SERVER_URL` is unset, the client falls back to the in-cluster DNS name `http://playground-server-http.playground.svc.cluster.local:8080`, which will fail outside Kubernetes.

### Client env vars

| Variable            | Default | Meaning                                                          |
| ------------------- | ------- | ---------------------------------------------------------------- |
| `SERVER_URL`        | in-cluster DNS | Upstream the ticker (and `/api/ping`) calls               |
| `FETCH_TIMEOUT_MS`  | `0`     | Per-request timeout in ms (`0` disables)                         |
| `POLL_INTERVAL_MS`  | `1000`  | Initial ticker cadence                                           |
| `POLL_ENABLED`      | `true`  | If `false`, the ticker boots paused (UI dropdown still works)    |

Both `POLL_INTERVAL_MS` and `POLL_ENABLED` are only consulted at process startup; further changes go through `POST /api/config` (which the UI dropdown uses).

## 3. End-to-end check

With server and client both running, the dashboard should show a steady stream of `200` responses at low latency. Restart the server with `LATENCY_MS=2000` and watch the latency column climb; add `ERROR_RATE=50` and watch the success rate fall. Because the client tickers itself, you can also close the browser tab, leave it for a minute, reopen it, and see the accumulated history without any gap in traffic to the server.

Run a second server instance on a different port with `APP_VERSION=v2 PORT=8081 go run ./cmd/http` to see the v1 / v2 fork light up in the topology diagram (point one client window at each).

## Docker (optional)

Two ways: build locally, or pull the published images from GHCR.

### Build locally

```sh
docker build -t playground-server:dev server/      # defaults to CMD=http
docker build -t playground-client:dev client/

docker network create playground-dev
docker run --rm -d --name playground-server --network playground-dev \
  -e LATENCY_MS=100 playground-server:dev
docker run --rm -d --name playground-client --network playground-dev \
  -e SERVER_URL=http://playground-server:8080 -p 3000:3000 playground-client:dev
```

The server Dockerfile takes `--build-arg CMD=http` (default) so a future `--build-arg CMD=grpc` will reuse the same pipeline.

### Pull from GHCR

```sh
docker network create playground-dev
docker run --rm -d --name playground-server --network playground-dev \
  -e LATENCY_MS=100 \
  ghcr.io/buoyantio/playground-laboratory/playground-server:latest
docker run --rm -d --name playground-client --network playground-dev \
  -e SERVER_URL=http://playground-server:8080 -p 3000:3000 \
  ghcr.io/buoyantio/playground-laboratory/playground-client:latest
```

Open <http://localhost:3000>. Tear down with `docker rm -f playground-client playground-server && docker network rm playground-dev`.

## k3d (optional)

Run the chart in a local cluster — matches what the runbooks target.

### Prerequisites

- [k3d](https://k3d.io), `kubectl`, `helm` 3
- (optional) [Linkerd CLI](https://linkerd.io/2/getting-started/) — the chart's namespace already has `linkerd.io/inject: enabled`, so installing Linkerd into the cluster meshes everything automatically.

### Spin up with published images

```sh
k3d cluster create playground
helm install playground helm/playground
kubectl -n playground rollout status deploy/playground-client
```

The client starts its in-pod ticker on boot (see `POLL_INTERVAL_MS` / `POLL_ENABLED` in `helm/playground/values.yaml`), so traffic is flowing through the cluster before you open a browser.

### Open the dashboard

```sh
kubectl -n playground port-forward svc/playground-client 3000:3000
```

Open <http://localhost:3000>. Port-forward is just the view — closing it doesn't stop the client from generating traffic, and reopening it replays the in-memory history.

### Use locally-built images

After editing code, rebuild and side-load:

```sh
docker build -t playground-server:dev server/
docker build -t playground-client:dev client/
k3d image import playground-server:dev playground-client:dev -c playground

helm upgrade --install playground helm/playground \
  --set http.image.repository=playground-server   --set http.image.tag=dev --set http.image.pullPolicy=IfNotPresent \
  --set client.image.repository=playground-client --set client.image.tag=dev --set client.image.pullPolicy=IfNotPresent
```

### Inject failures

Edit `helm/playground/values.yaml` and `helm upgrade`, or override on the fly:

```sh
helm upgrade playground helm/playground --reuse-values \
  --set http.primary.env.LATENCY_MS=500 \
  --set http.primary.env.ERROR_RATE=30
```

### Tear down

```sh
helm uninstall playground
k3d cluster delete playground
```
