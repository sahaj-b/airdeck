package layout

import (
	"fmt"
	"sort"

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

type OrientationOverrides struct {
	Portrait  *Geometry `json:"portrait,omitempty"`
	Landscape *Geometry `json:"landscape,omitempty"`
}

type Padding struct {
	Left   float64 `json:"left"`
	Right  float64 `json:"right"`
	Top    float64 `json:"top"`
	Bottom float64 `json:"bottom"`
}

type DPadBindings struct {
	Up    string `json:"up,omitempty" tstype:"'dpadUp'"`
	Down  string `json:"down,omitempty" tstype:"'dpadDown'"`
	Left  string `json:"left,omitempty" tstype:"'dpadLeft'"`
	Right string `json:"right,omitempty" tstype:"'dpadRight'"`
}

type Control struct {
	ID           string                `json:"id"`
	Type         string                `json:"type" tstype:"'button' | 'dpad' | 'joystick' | 'trigger' | 'label' | 'image'"`
	Geometry     Geometry              `json:"geometry"`
	Label        string                `json:"label"`
	Visible      bool                  `json:"visible"`
	HitOnly      bool                  `json:"hitOnly,omitempty"`
	Shape        string                `json:"shape,omitempty" tstype:"'circle' | 'pill' | 'rect'"`
	Binding      protocol.Command      `json:"binding,omitempty"`
	Bindings     *DPadBindings         `json:"bindings,omitempty"`
	Orientations *OrientationOverrides `json:"orientations,omitempty"`
	Asset        string                `json:"asset,omitempty"`
}

type Section struct {
	ID          string    `json:"id"`
	AspectRatio float64   `json:"aspectRatio"`
	MinWidth    float64   `json:"minWidth"`
	MaxWidth    float64   `json:"maxWidth"`
	FlexGrow    float64   `json:"flexGrow"`
	FlexShrink  float64   `json:"flexShrink"`
	Protected   bool      `json:"protected"`
	Padding     Padding   `json:"padding"`
	Controls    []Control `json:"controls"`
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
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Library struct {
	docs      map[string]Document
	defaultID string
}

func NewLibrary(docs []Document, defaultID string) (*Library, error) {
	library := &Library{docs: make(map[string]Document), defaultID: defaultID}
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

func (l *Library) Default() Document { return l.docs[l.defaultID] }

func (l *Library) Get(id string) (Document, bool) {
	doc, ok := l.docs[id]
	return doc, ok
}

func (l *Library) Summaries() []Summary {
	out := make([]Summary, 0, len(l.docs))
	for _, doc := range l.docs {
		out = append(out, Summary{ID: doc.ID, Name: doc.Name})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
