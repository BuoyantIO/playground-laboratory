package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"playground-server/internal/config"
	"playground-server/internal/faults"
)

func main() {
	cfg := config.Load("8080")

	if cfg.FailOnStartup {
		log.Fatal("FAIL_ON_STARTUP=true — exiting before serve")
	}

	fx := &faults.Injector{
		LatencyMs:          cfg.LatencyMs,
		LatencyJitterMs:    cfg.LatencyJitterMs,
		ErrorRate:          cfg.ErrorRate,
		ErrorCode:          cfg.ErrorCode,
		CrashAfterRequests: cfg.CrashAfterRequests,
		ReadinessFailRate:  cfg.ReadinessFailRate,
	}

	hostname, _ := os.Hostname()

	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if fx.ShouldFailReadiness() {
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprint(w, "not ready")
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		n := fx.NextRequest()
		latency := fx.ApplyLatency()

		// Echo the inbound proxy's verified peer identity back to the client.
		// Present on meshed inbound traffic, absent when the proxy was bypassed
		// (e.g. CNI race condition, NetworkPolicy on 4143, plaintext caller).
		meshClientID := r.Header.Get("l5d-client-id")

		w.Header().Set("X-Served-By", hostname)
		w.Header().Set("X-Request-Count", strconv.FormatUint(n, 10))
		w.Header().Set("X-Mesh-Client-Id", meshClientID)
		w.Header().Set("X-App-Version", cfg.AppVersion)

		if fx.ShouldError() {
			w.WriteHeader(cfg.ErrorCode)
			fmt.Fprintf(w, "injected error %d\n", cfg.ErrorCode)
			log.Printf("%d %s — request %d, version=%s, latency %dms, client-id=%q", cfg.ErrorCode, http.StatusText(cfg.ErrorCode), n, cfg.AppVersion, latency, meshClientID)
			return
		}

		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintln(w, cfg.ResponseText)
		log.Printf("200 OK — request %d, version=%s, latency %dms, client-id=%q", n, cfg.AppVersion, latency, meshClientID)
	})

	log.Printf("server listening :%s — version=%s response=%q latency=%dms+%dms errorRate=%d%% errorCode=%d", cfg.Port, cfg.AppVersion, cfg.ResponseText, cfg.LatencyMs, cfg.LatencyJitterMs, cfg.ErrorRate, cfg.ErrorCode)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		log.Fatal(err)
	}
}
