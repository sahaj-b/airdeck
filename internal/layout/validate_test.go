package layout

import (
	"encoding/json"
	"testing"
)

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
	base := Document{ID: "test", Name: "Test", SchemaVersion: 1, DefaultOrientation: "landscape", Sections: []Section{{ID: "section", Rect: Rect{X: 0, Y: 0, Width: 1, Height: 1}, Controls: []Control{{ID: "button", Type: "button", Rect: Rect{X: 0, Y: 0, Width: .2, Height: .2}, Label: "A", Visible: true, Binding: "south"}}}}, Assets: []Asset{{ID: "asset", Path: "../escape.png"}}}
	if err := ValidateDocument(base); err == nil {
		t.Fatal("unsafe asset path was accepted")
	}
	base.Assets[0].Path = "asset.png"
	base.Sections[0].Controls = append(base.Sections[0].Controls, Control{ID: "button", Type: "button", Rect: Rect{X: .2, Y: 0, Width: .2, Height: .2}, Label: "B", Visible: true, Binding: "east"})
	if err := ValidateDocument(base); err == nil {
		t.Fatal("duplicate control id was accepted")
	}
}

func TestValidateRejectsIncompleteDPad(t *testing.T) {
	doc := Document{ID: "test", Name: "Test", SchemaVersion: 1, DefaultOrientation: "landscape", Sections: []Section{{ID: "section", Rect: Rect{X: 0, Y: 0, Width: 1, Height: 1}, Controls: []Control{{ID: "dpad", Type: "dpad", Rect: Rect{X: 0, Y: 0, Width: .5, Height: .5}, Label: "D-pad", Visible: true, Bindings: &DPadBindings{Up: "dpadUp"}}}}}}
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
