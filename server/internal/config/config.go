package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port               string
	ResponseText       string
	AppVersion         string
	LatencyMs          int
	LatencyJitterMs    int
	ErrorRate          int
	ErrorCode          int
	FailOnStartup      bool
	CrashAfterRequests int
	ReadinessFailRate  int
}

func Load(defaultPort string) Config {
	return Config{
		Port:               getEnv("PORT", defaultPort),
		ResponseText:       getEnv("RESPONSE_TEXT", "test"),
		AppVersion:         getEnv("APP_VERSION", "v1"),
		LatencyMs:          getEnvInt("LATENCY_MS", 0),
		LatencyJitterMs:    getEnvInt("LATENCY_JITTER_MS", 0),
		ErrorRate:          getEnvInt("ERROR_RATE", 0),
		ErrorCode:          getEnvInt("ERROR_CODE", 500),
		FailOnStartup:      getEnvBool("FAIL_ON_STARTUP", false),
		CrashAfterRequests: getEnvInt("CRASH_AFTER_REQUESTS", 0),
		ReadinessFailRate:  getEnvInt("READINESS_FAIL_RATE", 0),
	}
}

func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getEnvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getEnvBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
