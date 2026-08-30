package layout

import (
	"fmt"
	"sort"
	"sync"

	"github.com/sahaj-b/airdeck/internal/protocol"
)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Size struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type Geometry struct {
	Position Point `json:"position"`
	Size     Size  `json:"size"`
}

type DPadBindings struct {
	Up    string `json:"up,omitempty" tstype:"'dpadUp'"`
	Down  string `json:"down,omitempty" tstype:"'dpadDown'"`
	Left  string `json:"left,omitempty" tstype:"'dpadLeft'"`
	Right string `json:"right,omitempty" tstype:"'dpadRight'"`
}

type Control struct {
	ID       string           `json:"id"`
	Type     string           `json:"type" tstype:"'button' | 'dpad' | 'joystick' | 'trigger' | 'label' | 'image'"`
	Geometry Geometry         `json:"geometry"`
	Label    string           `json:"label"`
	Visible  bool             `json:"visible"`
	HitOnly  bool             `json:"hitOnly,omitempty"`
	Shape    string           `json:"shape,omitempty" tstype:"'round' | 'rect'"`
	Binding  protocol.Command `json:"binding,omitempty"`
	Bindings *DPadBindings    `json:"bindings,omitempty"`
	Asset    string           `json:"asset,omitempty"`
}

type Section struct {
	ID               string    `json:"id"`
	RelativeWidth    float64   `json:"relativeWidth"`
	RelativeMinWidth *float64  `json:"relativeMinWidth,omitempty"`
	Controls         []Control `json:"controls"`
}

type Asset struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

type Document struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	SchemaVersion      int       `json:"schemaVersion" tstype:"1"`
	DefaultOrientation string    `json:"defaultOrientation" tstype:"'landscape' | 'portrait'"`
	Sections           []Section `json:"sections"`
	Assets             []Asset   `json:"assets"`
}

type Summary struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Builtin bool   `json:"builtin"`
}

type Library struct {
	mu        sync.RWMutex
	docs      map[string]Document
	defaultID string
	builtins  map[string]struct{}
	userDir   string
}

func NewLibrary(docs []Document, defaultID string) (*Library, error) {
	library := &Library{docs: make(map[string]Document), defaultID: defaultID, builtins: make(map[string]struct{})}
	for _, doc := range docs {
		if err := ValidateDocument(doc); err != nil {
			return nil, fmt.Errorf("layout %q: %w", doc.ID, err)
		}
		if _, exists := library.docs[doc.ID]; exists {
			return nil, fmt.Errorf("duplicate layout id %q", doc.ID)
		}
		library.docs[doc.ID] = doc
	}
	if _, ok := library.docs[defaultID]; !ok {
		return nil, fmt.Errorf("default layout %q is not available", defaultID)
	}
	return library, nil
}

func (l *Library) Default() Document {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.docs[l.defaultID]
}

func (l *Library) DefaultID() string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.defaultID
}

func (l *Library) UserDir() string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.userDir
}

func (l *Library) IsBuiltin(id string) bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	_, ok := l.builtins[id]
	return ok
}

func (l *Library) Get(id string) (Document, bool) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	doc, ok := l.docs[id]
	return doc, ok
}

func (l *Library) Summaries() []Summary {
	l.mu.RLock()
	defer l.mu.RUnlock()
	out := make([]Summary, 0, len(l.docs))
	for _, doc := range l.docs {
		_, builtin := l.builtins[doc.ID]
		out = append(out, Summary{ID: doc.ID, Name: doc.Name, Builtin: builtin})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (l *Library) setSource(userDir string, builtins map[string]struct{}) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.userDir = userDir
	if builtins == nil {
		l.builtins = make(map[string]struct{})
	} else {
		l.builtins = builtins
	}
}
