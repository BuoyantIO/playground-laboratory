package faults

import (
	"log"
	"math/rand"
	"sync/atomic"
	"time"
)

// Injector applies playground-style faults — latency, errors, crashes,
// readiness flaps — independent of the wire protocol the caller uses.
type Injector struct {
	LatencyMs          int
	LatencyJitterMs    int
	ErrorRate          int
	ErrorCode          int
	CrashAfterRequests int
	ReadinessFailRate  int

	requestCount uint64
}

// NextRequest atomically increments the request counter and terminates the
// process if CrashAfterRequests has been reached.
func (i *Injector) NextRequest() uint64 {
	n := atomic.AddUint64(&i.requestCount, 1)
	if i.CrashAfterRequests > 0 && n >= uint64(i.CrashAfterRequests) {
		log.Fatalf("CRASH_AFTER_REQUESTS=%d reached", i.CrashAfterRequests)
	}
	return n
}

// ApplyLatency sleeps for LatencyMs + rand(LatencyJitterMs) and returns the
// total latency applied, for log lines.
func (i *Injector) ApplyLatency() int {
	total := i.LatencyMs
	if i.LatencyJitterMs > 0 {
		total += rand.Intn(i.LatencyJitterMs)
	}
	if total > 0 {
		time.Sleep(time.Duration(total) * time.Millisecond)
	}
	return total
}

// ShouldError reports whether this request should be failed.
func (i *Injector) ShouldError() bool {
	return i.ErrorRate > 0 && rand.Intn(100) < i.ErrorRate
}

// ShouldFailReadiness reports whether a readiness probe should fail.
func (i *Injector) ShouldFailReadiness() bool {
	return i.ReadinessFailRate > 0 && rand.Intn(100) < i.ReadinessFailRate
}
