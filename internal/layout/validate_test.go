package layout

import (
	"encoding/json"
	"testing"
)

func baseGeometry() Geometry {
	return Geometry{
		Position: Point{X: 0, Y: 0},
		Size:     Size{Width: 0.2, Height: 0.2},
	}
}

func baseSection(id string, width float64) Section {
	if id == "center" {
		m := 0.38
		return Section{
			ID: id, RelativeWidth: width, RelativeMinWidth: &m,
			Controls: []Control{{
				ID: id + "-btn", Type: "button", Geometry: baseGeometry(), Label: "A", Binding: "south",
			}},
		}
	}
	return Section{
		ID: id, RelativeWidth: width,
		Controls: []Control{{
			ID: id + "-btn", Type: "button", Geometry: baseGeometry(), Label: "A", Binding: "south",
		}},
	}
}

func baseDocument() Document {
	return Document{
		ID: "test", Name: "Test", SchemaVersion: 1,
		Sections: []Section{
			baseSection("left", 0.86),
			baseSection("center", 0.5),
			baseSection("right", 0.94),
		},
	}
}

func TestBuiltInLayoutsValidate(t *testing.T) {
	documents, err := LoadBuiltins()
	if err != nil {
		t.Fatal(err)
	}
	if len(documents) == 0 {
		t.Fatal("no built-in layouts loaded")
	}
}

func TestValidateRejectsUnsafeAndDuplicateDocuments(t *testing.T) {
	base := baseDocument()
	duplicate := baseGeometry()
	duplicate.Position.X = 0.2
	// duplicate control id within same doc (left-btn already exists, reuse)
	base.Sections[0].Controls = append(base.Sections[0].Controls, Control{
		ID: "left-btn", Type: "button", Geometry: duplicate, Label: "B", Binding: "east",
	})
	if err := ValidateDocument(base); err == nil {
		t.Fatal("duplicate control id was accepted")
	}
}

func TestValidateRejectsInvalidIDs(t *testing.T) {
	tests := []struct {
		name string
		edit func(*Document)
	}{
		{"document path", func(doc *Document) { doc.ID = "../escape" }},
		{"control path", func(doc *Document) { doc.Sections[0].Controls[0].ID = "bad/id" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			doc := baseDocument()
			test.edit(&doc)
			if err := ValidateDocument(doc); err == nil {
				t.Fatal("invalid id was accepted")
			}
		})
	}
}

func TestValidateRejectsIncompleteDPad(t *testing.T) {
	doc := baseDocument()
	doc.Sections[0].Controls = []Control{{
		ID: "dpad", Type: "dpad", Geometry: Geometry{
			Position: Point{}, Size: Size{Width: 0.5, Height: 0.5},
		}, Label: "D-pad", Bindings: &DPadBindings{Up: "dpadUp"},
	}}
	if err := ValidateDocument(doc); err == nil {
		t.Fatal("incomplete d-pad was accepted")
	}
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateJSON(data); err == nil {
		t.Fatal("schema accepted incomplete d-pad")
	}
}

func TestValidateRejectsNonFixedDPadBindings(t *testing.T) {
	doc := baseDocument()
	doc.Sections[0].Controls = []Control{{
		ID: "dpad", Type: "dpad", Geometry: Geometry{
			Position: Point{}, Size: Size{Width: 0.5, Height: 0.5},
		}, Label: "D-pad", Bindings: &DPadBindings{
			Up: "dpadDown", Down: "dpadUp", Left: "dpadLeft", Right: "dpadRight",
		},
	}}
	if err := ValidateDocument(doc); err == nil {
		t.Fatal("non-fixed d-pad bindings were accepted")
	}
}

func TestValidateFixedSections(t *testing.T) {
	doc := baseDocument()
	doc.Sections = doc.Sections[:2]
	if err := ValidateDocument(doc); err == nil {
		t.Fatal("2 sections was accepted")
	}
	doc = baseDocument()
	doc.Sections[0].ID = "wrong"
	if err := ValidateDocument(doc); err == nil {
		t.Fatal("wrong section order was accepted")
	}
	doc = baseDocument()
	doc.Sections[1].RelativeWidth = 0
	if err := ValidateDocument(doc); err == nil {
		t.Fatal("zero relativeWidth was accepted")
	}
}

func TestValidateControlShapesAndSquareJoystick(t *testing.T) {
	newDoc := func(size Size, shape string) Document {
		doc := baseDocument()
		doc.Sections[0].Controls = []Control{{
			ID: "stick", Type: "joystick", Geometry: Geometry{
				Position: Point{}, Size: size,
			}, Label: "Left stick", Binding: "leftStick", Shape: shape,
		}}
		return doc
	}
	// Oval sticks are rejected, epsilon-close sizes still count as square.
	if err := ValidateDocument(newDoc(Size{Width: 0.4, Height: 0.2}, "")); err == nil {
		t.Fatal("non-square joystick was accepted")
	}
	if err := ValidateDocument(newDoc(Size{Width: 0.336, Height: 0.34}, "round")); err == nil {
		t.Fatal("oval stick was accepted")
	}
	if err := ValidateDocument(newDoc(Size{Width: 0.336, Height: 0.336}, "round")); err != nil {
		t.Fatalf("square joystick was rejected: %v", err)
	}
	if err := ValidateDocument(newDoc(Size{Width: 0.336, Height: 0.3365}, "round")); err != nil {
		t.Fatalf("epsilon square rejected: %v", err)
	}
	raw := `{"id":"test","name":"Test","schemaVersion":1,"sections":[{"id":"left","relativeWidth":0.86,"controls":[{"id":"stick","type":"joystick","geometry":{"position":{"x":0,"y":0},"size":{"width":0.336,"height":0.336}},"label":"Left stick","binding":"leftStick"}]},{"id":"center","relativeWidth":0.5,"controls":[]},{"id":"right","relativeWidth":0.94,"controls":[]}]}`
	if _, err := ValidateJSON([]byte(raw)); err != nil {
		t.Fatalf("square joystick rejected: %v", err)
	}
	if err := ValidateDocument(newDoc(Size{Width: 0.4, Height: 0.4}, "triangle")); err == nil {
		t.Fatal("unknown control shape was accepted")
	}
	if err := ValidateDocument(newDoc(Size{Width: 0.4, Height: 0.4}, "round")); err != nil {
		t.Fatalf("round shape was rejected: %v", err)
	}
	if err := ValidateDocument(newDoc(Size{Width: 0.4, Height: 0.4}, "rect")); err != nil {
		t.Fatalf("rect shape was rejected: %v", err)
	}
	// old circle should be rejected
	if err := ValidateDocument(newDoc(Size{Width: 0.4, Height: 0.4}, "circle")); err == nil {
		t.Fatal("old circle shape was accepted")
	}
	outside := newDoc(Size{Width: 0.4, Height: 0.4}, "round")
	outside.Sections[0].Controls[0].Geometry.Position.X = 0.8
	if err := ValidateDocument(outside); err == nil {
		t.Fatal("control outside the authored section was accepted")
	}
}

func TestValidateRejectsLegacyFields(t *testing.T) {
	// JSON with legacy aspectRatio should be rejected by schema
	raw := `{"id":"test","name":"Test","schemaVersion":1,"sections":[{"id":"left","aspectRatio":0.86,"minWidth":0.65,"maxWidth":0.86,"flexGrow":0,"flexShrink":1,"protected":true,"padding":{"left":0,"right":0,"top":0,"bottom":0},"controls":[]},{"id":"center","aspectRatio":0.5,"minWidth":0.38,"maxWidth":4,"flexGrow":1,"flexShrink":1,"protected":false,"padding":{"left":0,"right":0,"top":0,"bottom":0},"controls":[]},{"id":"right","aspectRatio":0.94,"minWidth":0.67,"maxWidth":0.94,"flexGrow":0,"flexShrink":1,"protected":true,"padding":{"left":0,"right":0,"top":0,"bottom":0},"controls":[]}]}`
	if _, err := ValidateJSON([]byte(raw)); err == nil {
		t.Fatal("legacy fields were accepted by schema")
	}
}

func TestValidateSubLabel(t *testing.T) {
	section := Section{ID: "left", RelativeWidth: 0.86}
	button := Control{
		ID: "a", Type: "button", Geometry: baseGeometry(), Label: "A", Binding: "south",
	}
	button.SubLabel = "Dash"
	if err := validateControl(button, section); err != nil {
		t.Fatalf("valid subLabel was rejected: %v", err)
	}
	button.SubLabel = ""
	if err := validateControl(button, section); err != nil {
		t.Fatalf("empty subLabel was rejected: %v", err)
	}
	button.SubLabel = "🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥"
	if err := validateControl(button, section); err != nil {
		t.Fatalf("20-emoji subLabel was rejected: %v", err)
	}
	button.SubLabel += "🔥"
	if err := validateControl(button, section); err == nil {
		t.Fatal("21-emoji subLabel was accepted")
	}
	button.SubLabel = "way too long for a hint label"
	if err := validateControl(button, section); err == nil {
		t.Fatal("overlong subLabel was accepted")
	}
	label := Control{
		ID: "l", Type: "label", Geometry: baseGeometry(), Label: "Hint", SubLabel: "Dash",
	}
	if err := validateControl(label, section); err == nil {
		t.Fatal("label subLabel was accepted")
	}
	hitzone := Control{
		ID: "h", Type: "hitzone", Geometry: baseGeometry(), Label: "",
		ParentID: "a", SubLabel: "Dash",
	}
	if err := validateControl(hitzone, section); err == nil {
		t.Fatal("hitzone subLabel was accepted")
	}
	// schema-level: label controls must reject subLabel in raw JSON
	raw := `{"id":"test","name":"Test","schemaVersion":1,"sections":[{"id":"left","relativeWidth":0.86,"controls":[{"id":"note","type":"label","geometry":{"position":{"x":0,"y":0},"size":{"width":0.2,"height":0.2}},"label":"Hint","subLabel":"Dash"}]},{"id":"center","relativeWidth":0.5,"controls":[]},{"id":"right","relativeWidth":0.94,"controls":[]}]}`
	if _, err := ValidateJSON([]byte(raw)); err == nil {
		t.Fatal("schema accepted label subLabel")
	}
}
