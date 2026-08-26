package diagnostics

import (
	"testing"
	"time"
)

func TestMetricsUseBoundedDurationSamples(t *testing.T) {
	metrics := &Metrics{}
	for i := 0; i < metricSampleCap+100; i++ {
		metrics.Apply(time.Duration(i) * time.Microsecond)
	}
	summary := metrics.Summary()
	if summary.Max != time.Duration(metricSampleCap+99)*time.Microsecond {
		t.Fatalf("max = %s, want newest sample", summary.Max)
	}
}

func TestTraceRingRetainsNewestEntries(t *testing.T) {
	trace := NewTrace(2)
	trace.Add(FrameTrace{Sequence: 1})
	trace.Add(FrameTrace{Sequence: 2})
	trace.Add(FrameTrace{Sequence: 3})
	entries := trace.Snapshot()
	if len(entries) != 2 || entries[0].Sequence != 2 || entries[1].Sequence != 3 {
		t.Fatalf("trace entries = %+v", entries)
	}
}
