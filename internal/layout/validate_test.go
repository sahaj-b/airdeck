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

func baseSection() Section {
	return Section{
		ID: "section", AspectRatio: 1, MinWidth: 1, MaxWidth: 1,
		FlexGrow: 0, FlexShrink: 0, Protected: true,
		Padding: Padding{}, Controls: []Control{{
			ID: "button", Type: "button", Geometry: baseGeometry(), Label: "A", Visible: true, Binding: "south",
		}},
	}
}

func baseDocument() Document {
	return Document{
		ID: "test", Name: "Test", SchemaVersion: 1, DefaultOrientation: "landscape",
		Sections: []Section{baseSection()}, Assets: []Asset{{ID: "asset", Path: "asset.png"}},
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
	base.Assets[0].Path = "../escape.png"
	if err := ValidateDocument(base); err == nil {
		t.Fatal("unsafe asset path was accepted")
	}
	base.Assets[0].Path = "asset.png"
	duplicate := baseGeometry()
	duplicate.Position.X = 0.2
	base.Sections[0].Controls = append(base.Sections[0].Controls, Control{
		ID: "button", Type: "button", Geometry: duplicate, Label: "B", Visible: true, Binding: "east",
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
		}, Label: "D-pad", Visible: true, Bindings: &DPadBindings{Up: "dpadUp"},
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

func TestValidateControlShapesAndSquares(t *testing.T) {
	newDoc := func(size Size, shape string) Document {
		doc := baseDocument()
		doc.Sections[0].Controls = []Control{{
			ID: "stick", Type: "joystick", Geometry: Geometry{
				Position: Point{}, Size: size,
			}, Label: "Left stick", Visible: true, Binding: "leftStick", Shape: shape,
		}}
		return doc
	}
	if err := ValidateDocument(newDoc(Size{Width: 0.4, Height: 0.2}, "")); err == nil {
		t.Fatal("non-square joystick was accepted")
	}
	if err := ValidateDocument(newDoc(Size{Width: 0.4, Height: 0.4}, "triangle")); err == nil {
		t.Fatal("unknown control shape was accepted")
	}
	if err := ValidateDocument(newDoc(Size{Width: 0.4, Height: 0.4}, "circle")); err != nil {
		t.Fatalf("circle shape was rejected: %v", err)
	}

	outside := newDoc(Size{Width: 0.4, Height: 0.4}, "circle")
	outside.Sections[0].Controls[0].Geometry.Position.X = 0.8
	if err := ValidateDocument(outside); err == nil {
		t.Fatal("control outside the authored section was accepted")
	}
}
