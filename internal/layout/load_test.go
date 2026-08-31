package layout

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func baseDoc() Document {
	minLeft := 0.65
	minCenter := 0.38
	minRight := 0.67
	return Document{
		ID: "user-layout", Name: "User Layout", SchemaVersion: 1, DefaultOrientation: "landscape",
		Sections: []Section{
			{ID: "left", RelativeWidth: 0.86, RelativeMinWidth: &minLeft, Controls: []Control{{
				ID: "button", Type: "button", Geometry: baseGeometry(), Label: "A", Binding: "south",
			}}},
			{ID: "center", RelativeWidth: 0.5, RelativeMinWidth: &minCenter, Controls: []Control{}},
			{ID: "right", RelativeWidth: 0.94, RelativeMinWidth: &minRight, Controls: []Control{}},
		},
		Assets: []Asset{{ID: "asset", Path: "asset.png"}},
	}
}

func writeDoc(t *testing.T, path string, doc Document) {
	t.Helper()
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestLoadUserSkipsMalformedAndUnsafePresets(t *testing.T) {
	dir := t.TempDir()
	writeDoc(t, filepath.Join(dir, "valid.json"), baseDoc())
	if err := os.WriteFile(filepath.Join(dir, "asset.png"), []byte("png"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "malformed.json"), []byte(`{"id":`), 0o600); err != nil {
		t.Fatal(err)
	}
	future := baseDoc()
	future.SchemaVersion = 3
	writeDoc(t, filepath.Join(dir, "future.json"), future)
	traversal := baseDoc()
	traversal.Assets[0].Path = "../escape.png"
	writeDoc(t, filepath.Join(dir, "traversal.json"), traversal)
	if err := os.WriteFile(filepath.Join(dir, "huge.json"), bytes.Repeat([]byte(" "), maxPresetBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "valid.json"), filepath.Join(dir, "link.json")); err != nil {
		t.Fatal(err)
	}

	documents, err := LoadUser(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(documents) != 1 || documents[0].ID != "user-layout" {
		t.Fatalf("loaded %d documents: %+v, want only the valid preset", len(documents), documents)
	}
}

func TestLoadUserRejectsSymlinkedAndOversizedAssets(t *testing.T) {
	dir := t.TempDir()
	symlinkAsset := baseDoc()
	symlinkAsset.Assets[0].Path = "evil.png"
	writeDoc(t, filepath.Join(dir, "symlink-asset.json"), symlinkAsset)
	if err := os.Symlink("/etc/hostname", filepath.Join(dir, "evil.png")); err != nil {
		t.Fatal(err)
	}
	hugeAsset := baseDoc()
	hugeAsset.Assets[0].Path = "big.png"
	writeDoc(t, filepath.Join(dir, "huge-asset.json"), hugeAsset)
	if err := os.WriteFile(filepath.Join(dir, "big.png"), bytes.Repeat([]byte{1}, maxPresetBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}

	documents, err := LoadUser(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(documents) != 0 {
		t.Fatalf("loaded %d documents, want none", len(documents))
	}
}

func TestLoadDefaultRejectsMissingDefaultLayout(t *testing.T) {
	if _, err := LoadDefault("", "does-not-exist"); err == nil {
		t.Fatal("missing default layout was accepted")
	}
}

func TestLoadDefaultFallsBackToDefaultWhenIDEmpty(t *testing.T) {
	library, err := LoadDefault("", "")
	if err != nil {
		t.Fatal(err)
	}
	if library.Default().ID != "xbox-default" {
		t.Fatalf("default layout = %q, want xbox-default", library.Default().ID)
	}
}
