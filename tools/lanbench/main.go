package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/diagnostics"
	"github.com/sahaj-b/airdeck/internal/protocol"
)

type hostDiagnostics struct {
	Summary diagnostics.Summary      `json:"summary"`
	Trace   []diagnostics.FrameTrace `json:"trace,omitempty"`
}

type result struct {
	Players      int              `json:"players"`
	Rate         int              `json:"rate"`
	Duration     string           `json:"duration"`
	FramesSent   uint64           `json:"framesSent"`
	DebugSamples uint64           `json:"debugSamples"`
	StartedAt    string           `json:"startedAt"`
	FinishedAt   string           `json:"finishedAt"`
	Host         *hostDiagnostics `json:"host,omitempty"`
	Errors       []string         `json:"errors,omitempty"`
}

func main() {
	advertised := flag.String("advertised-url", "", "advertised /join URL")
	code := flag.String("session-code", "", "session code")
	players := flag.Int("players", 1, "synthetic player count")
	duration := flag.Duration("duration", 5*time.Second, "benchmark duration")
	rate := flag.Int("rate", 60, "input frame rate")
	output := flag.String("output", "benchmarks/lanbench.json", "local JSON output path")
	adminURL := flag.String("admin-url", "", "host admin URL for diagnostics (loopback; derived from advertised-url when empty)")
	flag.Parse()
	if err := run(*advertised, *code, *players, *duration, *rate, *output, *adminURL); err != nil {
		fmt.Fprintln(os.Stderr, "lanbench:", err)
		os.Exit(1)
	}
}

func run(advertised, code string, players int, duration time.Duration, rate int, output, adminURL string) error {
	if advertised == "" || code == "" {
		return errors.New("advertised-url and session-code are required")
	}
	if players < 1 || players > 16 {
		return errors.New("players must be between 1 and 16")
	}
	if duration <= 0 || rate < 1 || rate > 240 {
		return errors.New("duration and rate are outside supported bounds")
	}
	wsURL, err := websocketURL(advertised)
	if err != nil {
		return err
	}
	if adminURL == "" {
		adminURL = deriveAdminURL(advertised)
	}
	started := time.Now()
	var totalFrames atomic.Uint64
	var totalSamples atomic.Uint64
	errorsCh := make(chan error, players)
	var group sync.WaitGroup
	for player := 0; player < players; player++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			frames, samples, err := runClient(wsURL, code, index, duration, rate)
			totalFrames.Add(frames)
			totalSamples.Add(samples)
			if err != nil {
				errorsCh <- err
			}
		}(player)
	}
	group.Wait()
	close(errorsCh)
	// Allow the host watchdog to expire and record any late timing.
	time.Sleep(500 * time.Millisecond)
	var messages []string
	for err := range errorsCh {
		messages = append(messages, err.Error())
	}
	finished := time.Now()
	var hostDiag *hostDiagnostics
	if diag, err := fetchDiagnostics(adminURL); err == nil {
		hostDiag = diag
	} else {
		messages = append(messages, "diagnostics: "+err.Error())
	}
	data, err := json.MarshalIndent(result{Players: players, Rate: rate, Duration: duration.String(), FramesSent: totalFrames.Load(), DebugSamples: totalSamples.Load(), StartedAt: started.UTC().Format(time.RFC3339Nano), FinishedAt: finished.UTC().Format(time.RFC3339Nano), Host: hostDiag, Errors: messages}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(output), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(output, append(data, '\n'), 0o600); err != nil {
		return err
	}
	if len(messages) > 0 {
		return fmt.Errorf("%d benchmark clients failed", len(messages))
	}
	return nil
}

func deriveAdminURL(advertised string) string {
	parsed, err := url.Parse(advertised)
	if err != nil || parsed.Host == "" {
		return ""
	}
	host := "127.0.0.1"
	port := parsed.Port()
	if port == "" {
		port = "80"
	}
	return fmt.Sprintf("http://%s:%s", host, port)
}

func fetchDiagnostics(adminURL string) (*hostDiagnostics, error) {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(adminURL + "/api/admin/diagnostics")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var diag hostDiagnostics
	if err := json.Unmarshal(data, &diag); err != nil {
		return nil, err
	}
	return &diag, nil
}

func websocketURL(advertised string) (string, error) {
	parsed, err := url.Parse(advertised)
	if err != nil || parsed.Host == "" {
		return "", errors.New("advertised-url must be an absolute URL")
	}
	scheme := "ws"
	if parsed.Scheme == "https" {
		scheme = "wss"
	}
	return scheme + "://" + parsed.Host + "/ws", nil
}

func runClient(wsURL, code string, index int, duration time.Duration, rate int) (uint64, uint64, error) {
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return 0, 0, err
	}
	defer conn.Close()
	if err := conn.WriteJSON(protocol.Hello{Type: protocol.MessageHello, SessionCode: code, DisplayName: fmt.Sprintf("Bench %d", index+1), ClientVersion: "lanbench", Capabilities: protocol.Capabilities{}}); err != nil {
		return 0, 0, err
	}
	if err := readWelcome(conn); err != nil {
		return 0, 0, err
	}
	if err := readLayout(conn); err != nil {
		return 0, 0, err
	}
	readDone := make(chan error, 1)
	pongCh := make(chan protocol.Pong, 4)
	go func() {
		for {
			typeID, data, err := conn.ReadMessage()
			if err != nil {
				readDone <- err
				return
			}
			if typeID != websocket.TextMessage {
				continue
			}
			if messageType, _ := protocol.MessageType(data); messageType == protocol.MessagePing {
				var ping protocol.Ping
				if json.Unmarshal(data, &ping) == nil {
					select {
					case pongCh <- protocol.Pong{Type: protocol.MessagePong, ID: ping.ID}:
					default:
					}
				}
			}
		}
	}()
	ticker := time.NewTicker(time.Second / time.Duration(rate))
	defer ticker.Stop()
	deadline := time.NewTimer(duration)
	defer deadline.Stop()
	var frames, samples uint64
	var sequence uint32
	for {
		select {
		case err := <-readDone:
			return frames, samples, err
		case pong := <-pongCh:
			if err := conn.WriteJSON(pong); err != nil {
				return frames, samples, err
			}
		case <-ticker.C:
			next := sequence + 1
			if next%60 == 0 {
				if err := conn.WriteJSON(protocol.DebugInputTrace{Type: protocol.MessageDebugTrace, Sequence: next, ClientTime: uint64(time.Now().UnixNano())}); err != nil {
					return frames, samples, err
				}
				samples++
			}
			sequence = next
			state := protocol.Frame{Seq: sequence, LX: int16((index + 1) * 1000), LY: int16(sequence % 2000), RT: uint8(sequence % 255)}
			if sequence%120 < 60 {
				state.Buttons = protocol.BitSouth
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, state.Encode()); err != nil {
				return frames, samples, err
			}
			frames++
		case <-deadline.C:
			return frames, samples, nil
		}
	}
}

func readWelcome(conn *websocket.Conn) error {
	typeID, data, err := conn.ReadMessage()
	if err != nil {
		return err
	}
	if typeID != websocket.TextMessage {
		return errors.New("benchmark received non-text welcome")
	}
	var welcome protocol.Welcome
	if err := json.Unmarshal(data, &welcome); err != nil {
		return err
	}
	if welcome.Type != protocol.MessageWelcome {
		return fmt.Errorf("benchmark received %q instead of welcome", welcome.Type)
	}
	return nil
}

func readLayout(conn *websocket.Conn) error {
	typeID, data, err := conn.ReadMessage()
	if err != nil {
		return err
	}
	if typeID != websocket.TextMessage {
		return errors.New("benchmark received non-text layout")
	}
	var layout protocol.LayoutMessage
	if err := json.Unmarshal(data, &layout); err != nil {
		return err
	}
	if layout.Type != protocol.MessageLayout {
		return fmt.Errorf("benchmark received %q instead of layout", layout.Type)
	}
	return nil
}
