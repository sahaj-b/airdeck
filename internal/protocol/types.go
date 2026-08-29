package protocol

type LayoutSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Capabilities struct {
	Sound       bool `json:"sound"`
	WakeLock    bool `json:"wakeLock"`
	Fullscreen  bool `json:"fullscreen"`
	Orientation bool `json:"orientation"`
}

type Hello struct {
	Type           string       `json:"type" tstype:"'hello'"`
	SessionCode    string       `json:"sessionCode"`
	DisplayName    string       `json:"displayName,omitempty"`
	ReconnectID    string       `json:"reconnectId,omitempty"`
	ClientVersion  string       `json:"clientVersion"`
	SelectedLayout string       `json:"selectedLayout,omitempty"`
	Capabilities   Capabilities `json:"capabilities"`
}

type Welcome struct {
	Type             string          `json:"type" tstype:"'welcome'"`
	PlayerID         string          `json:"playerId"`
	Slot             int             `json:"slot"`
	DisplayName      string          `json:"displayName"`
	Accent           string          `json:"accent"`
	ReconnectID      string          `json:"reconnectId"`
	ProtocolVersion  uint8           `json:"protocolVersion"`
	FrameSize        int             `json:"frameSize"`
	TargetInputRate  int             `json:"targetInputRate"`
	SelectedLayout   string          `json:"selectedLayout"`
	AvailableLayouts []LayoutSummary `json:"availableLayouts"`
}

type Ping struct {
	Type  string `json:"type" tstype:"'ping'"`
	ID    string `json:"id"`
	Sent  uint64 `json:"sent"`
	RttMs int64  `json:"rttMs,omitempty"`
}

type Pong struct {
	Type string `json:"type" tstype:"'pong'"`
	ID   string `json:"id"`
}

type LayoutSelect struct {
	Type string `json:"type" tstype:"'layout.select'"`
	ID   string `json:"id"`
}

type LayoutMessage struct {
	Type   string `json:"type" tstype:"'layout'"`
	ID     string `json:"id"`
	Layout any    `json:"layout"`
}

type Rumble struct {
	Type   string `json:"type" tstype:"'rumble'"`
	Strong uint16 `json:"strong"`
	Weak   uint16 `json:"weak"`
	Active bool   `json:"active"`
}

type ErrorMessage struct {
	Type    string `json:"type" tstype:"'error'"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type CloseMessage struct {
	Type   string `json:"type" tstype:"'close'"`
	Reason string `json:"reason,omitempty"`
}

type ResetMessage struct {
	Type string `json:"type" tstype:"'session.reset'"`
}

type DebugInputTrace struct {
	Type       string `json:"type" tstype:"'debug.inputTrace'"`
	Sequence   uint32 `json:"sequence"`
	ClientTime uint64 `json:"clientTime"`
}
