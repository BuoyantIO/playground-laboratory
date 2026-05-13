# Local development

Run the server and client directly on your machine — no cluster required.

## Prerequisites

- Go 1.22+
- Node.js 20+
- npm (ships with Node.js)

## 1. Run the server

```sh
cd server
go run .
```

Listens on `:8080` by default. Verify:

```sh
curl http://localhost:8080
# test
```

### Inject failures via env vars

All knobs are env-driven, so prefix the command:

```sh
LATENCY_MS=500 LATENCY_JITTER_MS=200 ERROR_RATE=30 ERROR_CODE=503 go run .
```

| Variable               | Default | Meaning                                   |
| ---------------------- | ------- | ----------------------------------------- |
| `PORT`                 | `8080`  | Listen port                               |
| `RESPONSE_TEXT`        | `test`  | Body returned on success                  |
| `LATENCY_MS`           | `0`     | Fixed sleep before responding (ms)        |
| `LATENCY_JITTER_MS`    | `0`     | Random extra latency `[0, jitter)` (ms)   |
| `ERROR_RATE`           | `0`     | Percent (0–100) of requests that fail     |
| `ERROR_CODE`           | `500`   | Status code returned when failing         |
| `FAIL_ON_STARTUP`      | `false` | Exit immediately — simulates crash loop   |
| `CRASH_AFTER_REQUESTS` | `0`     | Exit after N requests (0 = never)         |
| `READINESS_FAIL_RATE`  | `0`     | Percent of `/healthz` probes that fail    |

## 2. Run the client

In a second terminal:

```sh
cd client
npm install            # first time only
SERVER_URL=http://localhost:8080 npm run dev
```

Open <http://localhost:3000>. The dashboard polls `/api/ping` every second; the Next.js dev server proxies each call to `SERVER_URL`.

If `SERVER_URL` is unset, the client falls back to the in-cluster DNS name `http://sma-server.sma.svc.cluster.local:8080`, which will fail outside Kubernetes.

## 3. End-to-end check

With server and client both running, the dashboard should show a steady stream of `200` responses at low latency. Restart the server with `LATENCY_MS=2000` and watch the latency column climb; add `ERROR_RATE=50` and watch the success rate fall.

## Docker (optional)

To exercise the production images locally:

```sh
docker build -t sma-server:dev server/
docker build -t sma-client:dev client/

docker network create sma-dev
docker run --rm -d --name sma-server --network sma-dev \
  -e LATENCY_MS=100 sma-server:dev
docker run --rm -d --name sma-client --network sma-dev \
  -e SERVER_URL=http://sma-server:8080 -p 3000:3000 sma-client:dev
```

Open <http://localhost:3000>. Tear down with `docker rm -f sma-client sma-server && docker network rm sma-dev`.
