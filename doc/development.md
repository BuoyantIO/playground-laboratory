# Local development

Run the server, the dashboard, and the traffic generator directly on your
machine, no cluster required.

## Prerequisites

- Go 1.22+
- Node.js 20+
- npm (ships with Node.js)

## 1. Run the server

The server is now laid out for multiple binaries (HTTP today, gRPC later), the entrypoint lives under `cmd/http/`:

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
| `APP_VERSION`          | `v1`    | Echoed back as `X-App-Version` (used by the dashboard's fork visualization, set `v2` to simulate the canary) |
| `LATENCY_MS`           | `0`     | Fixed sleep before responding (ms)        |
| `LATENCY_JITTER_MS`    | `0`     | Random extra latency `[0, jitter)` (ms)   |
| `ERROR_RATE`           | `0`     | Percent (0–100) of requests that fail     |
| `ERROR_CODE`           | `500`   | Status code returned when failing         |
| `FAIL_ON_STARTUP`      | `false` | Exit immediately, simulates crash loop   |
| `CRASH_AFTER_REQUESTS` | `0`     | Exit after N requests (0 = never)         |
| `READINESS_FAIL_RATE`  | `0`     | Percent of `/healthz` probes that fail    |

The injection logic lives in `server/internal/faults/` and the env parsing in `server/internal/config/`, both protocol-agnostic so a future `cmd/grpc/` entrypoint reuses them as-is.

## 2. Run the dashboard

The dashboard is the Next.js UI. It serves the page, owns the live generator
config (`GET`/`POST /api/config`), receives samples from the generator
(`POST /api/ingest`), and streams them to the browser over SSE
(`/api/samples/stream`). **It does not generate traffic itself.**

```sh
cd client
npm install            # first time only
npm run dev            # UI + API on :3000
```

Open <http://localhost:3000>. With no generator running yet, the flow diagram
shows "no samples" and the generator-liveness chip stays red.

## 3. Run the generator

The generator is a separate headless process (the same codebase, a different
entrypoint). It pulls config from the dashboard, calls `SERVER_URL`, and pushes
each result back to the dashboard. It's bundled into the standalone output, so
build once, then run it pointed at the dashboard and server:

```sh
cd client
npm run build          # produces .next/standalone/generator/main.js
DASHBOARD_URL=http://localhost:3000 SERVER_URL=http://localhost:8080 \
  node .next/standalone/generator/main.js
```

The dashboard now shows a live flow. Change the interval, concurrency, target,
or headers in the UI and the generator adopts them within ~2s (`CONFIG_POLL_MS`).
Kill the dashboard and the generator keeps calling the server, it just can't
push samples until the dashboard returns.

### Generator env vars

These are only fallbacks used until the first successful config pull; after
that, the dashboard's config wins.

| Variable            | Default        | Meaning                                                |
| ------------------- | -------------- | ------------------------------------------------------ |
| `DASHBOARD_URL`     | in-cluster DNS | Where it pulls config and pushes samples               |
| `SERVER_URL`        | in-cluster DNS | Apex base the generator calls (target `apex`/`primary`/`canary` derive from it) |
| `CONFIG_POLL_MS`    | `2000`         | How often it re-pulls config from the dashboard        |
| `HEALTH_PORT`       | `4000`         | Port for the `/healthz` endpoint (k8s probes)          |
| `FETCH_TIMEOUT_MS`  | `0`            | Per-request timeout in ms (`0` disables)               |
| `POLL_INTERVAL_MS`  | `1000`         | Initial interval                                       |
| `POLL_ENABLED`      | `true`         | Initial pause/resume                                   |
| `CONCURRENCY`       | `1`            | Initial parallel request lanes                         |
| `TARGET_AUTHORITY`  | `apex`         | Initial target: `apex`/`primary`/`canary`/`custom`     |
| `TARGET_PATH`       | `/`            | Initial request path                                   |

### Dashboard env vars

The dashboard seeds its config store from the same set (`POLL_INTERVAL_MS`,
`POLL_ENABLED`, `CONCURRENCY`, `TARGET_AUTHORITY`, `TARGET_PATH`). Those seeds
become the source of truth the generator pulls.

## 4. End-to-end check

With server, dashboard, and generator running, the dashboard should show a
steady stream of `200` responses at low latency. Restart the server with
`LATENCY_MS=2000` and watch the latency column climb; add `ERROR_RATE=50` and
watch the success rate fall. Because the generator runs independently of the
browser, you can close the tab, reopen it, and see the accumulated history
without any gap in traffic.

To see the v1 / v2 fork light up, run a second server with
`APP_VERSION=v2 PORT=8081 go run ./cmd/http` and set the dashboard target to
**custom** with `http://localhost:8081`, or just use k3d, where the chart
deploys the primary/canary roles behind the apex Service.

## Docker (optional)

The dashboard and generator ship in **one image** (`playground-app`); the role
is selected by the container command.

### Build locally

```sh
docker build -t playground-server:dev server/      # defaults to CMD=http
docker build -t playground-app:dev    client/

docker network create playground-dev
docker run --rm -d --name playground-server --network playground-dev \
  -e LATENCY_MS=100 playground-server:dev
docker run --rm -d --name playground-dashboard --network playground-dev \
  -p 3000:3000 playground-app:dev
docker run --rm -d --name playground-client --network playground-dev \
  -e DASHBOARD_URL=http://playground-dashboard:3000 \
  -e SERVER_URL=http://playground-server:8080 \
  playground-app:dev node generator/main.js
```

The server Dockerfile takes `--build-arg CMD=http` (default) so a future `--build-arg CMD=grpc` will reuse the same pipeline.

### Pull from GHCR

```sh
docker network create playground-dev
docker run --rm -d --name playground-server --network playground-dev \
  -e LATENCY_MS=100 \
  ghcr.io/buoyantio/playground-laboratory/playground-server:latest
docker run --rm -d --name playground-dashboard --network playground-dev \
  -p 3000:3000 \
  ghcr.io/buoyantio/playground-laboratory/playground-app:latest
docker run --rm -d --name playground-client --network playground-dev \
  -e DASHBOARD_URL=http://playground-dashboard:3000 \
  -e SERVER_URL=http://playground-server:8080 \
  ghcr.io/buoyantio/playground-laboratory/playground-app:latest node generator/main.js
```

Open <http://localhost:3000>. Tear down with `docker rm -f playground-client playground-dashboard playground-server && docker network rm playground-dev`.

## k3d (optional)

Run the chart in a local cluster, matches what the runbooks target.

### Prerequisites

- [k3d](https://k3d.io), `kubectl`, `helm` 3
- (optional) [Linkerd CLI](https://linkerd.io/2/getting-started/), the chart's namespace already has `linkerd.io/inject: enabled`, so installing Linkerd into the cluster meshes everything automatically.

### Spin up with published images

```sh
k3d cluster create playground
helm install playground helm/playground
kubectl -n playground rollout status \
  deploy/playground-dashboard deploy/playground-client
```

The generator (`playground-client`) starts calling the server on boot and
pushing samples to the dashboard, so traffic is flowing before you open a browser.

### Open the dashboard

```sh
kubectl -n playground port-forward svc/playground-dashboard 3000:3000
```

Open <http://localhost:3000>. Port-forward is just the view, closing it doesn't stop the generator, and reopening it replays the dashboard's in-memory history.

### Use locally-built images

After editing code, rebuild and side-load. The dashboard and generator share
the one `playground-app` image:

```sh
docker build -t playground-server:dev server/
docker build -t playground-app:dev    client/
k3d image import playground-server:dev playground-app:dev -c playground

helm upgrade --install playground helm/playground \
  --set http.image.repository=playground-server   --set http.image.tag=dev --set http.image.pullPolicy=IfNotPresent \
  --set dashboard.image.repository=playground-app  --set dashboard.image.tag=dev --set dashboard.image.pullPolicy=IfNotPresent \
  --set client.image.repository=playground-app     --set client.image.tag=dev --set client.image.pullPolicy=IfNotPresent
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
