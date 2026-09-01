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

func TestValidateControlShapesAndUnlockedJoystick(t *testing.T) {
	newDoc := func(size Size, shape string) Document {
		doc := baseDocument()
		doc.Sections[0].Controls = []Control{{
			ID: "stick", Type: "joystick", Geometry: Geometry{
				Position: Point{}, Size: size,
			}, Label: "Left stick", Binding: "leftStick", Shape: shape,
		}}
		return doc
	}
	// Non-square joystick must now be ACCEPTED (unlocked for gyro oval)
	if err := ValidateDocument(newDoc(Size{Width: 0.4, Height: 0.2}, "")); err != nil {
		t.Fatalf("non-square joystick was rejected but should be allowed: %v", err)
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
