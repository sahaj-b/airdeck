package protocol

type LayoutSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Capabilities struct {
	Haptics     bool `json:"haptics"`
	Sound       bool `json:"sound"`
	WakeLock    bool `json:"wakeLock"`
	Fullscreen  bool `json:"fullscreen"`
	Orientation bool `json:"orientation"`
}

type Hello struct {
	Type           string       `json:"type"`
	SessionCode    string       `json:"sessionCode"`
	DisplayName    string       `json:"displayName,omitempty"`
	ReconnectID    string       `json:"reconnectId,omitempty"`
	ClientVersion  string       `json:"clientVersion"`
	SelectedLayout string       `json:"selectedLayout,omitempty"`
	Capabilities   Capabilities `json:"capabilities"`
}

type Welcome struct {
	Type             string          `json:"type"`
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
	Type string `json:"type"`
	ID   string `json:"id"`
	Sent uint64 `json:"sent"`
}

type Pong struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type LayoutSelect struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type LayoutMessage struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	Layout any    `json:"layout"`
}

type Rumble struct {
	Type   string `json:"type"`
	Strong uint16 `json:"strong"`
	Weak   uint16 `json:"weak"`
	Active bool   `json:"active"`
}

type ErrorMessage struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type CloseMessage struct {
	Type   string `json:"type"`
	Reason string `json:"reason,omitempty"`
}

type ResetMessage struct {
	Type string `json:"type"`
}

type DebugInputTrace struct {
	Type       string `json:"type"`
	Sequence   uint32 `json:"sequence"`
	ClientTime uint64 `json:"clientTime"`
}
