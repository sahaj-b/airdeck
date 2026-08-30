package layout

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestLibraryCreateDeleteAndReload(t *testing.T) {
	dir := t.TempDir()
	lib, err := LoadDefault(dir, "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	doc := baseDoc()
	doc.ID = "my-edit"
	doc.Name = "My edit"
	doc.Assets = []Asset{}
	if err := lib.Create(doc); err != nil {
		t.Fatalf("create: %v", err)
	}
	path := filepath.Join(dir, "my-edit.json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("perms = %o, want 600", info.Mode().Perm())
	}
	if _, ok := lib.Get("my-edit"); !ok {
		t.Fatal("created layout not in library")
	}
	// Update
	doc.Name = "My edit v2"
	if err := lib.Update(doc); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, _ := lib.Get("my-edit")
	if got.Name != "My edit v2" {
		t.Fatalf("update name = %q, want v2", got.Name)
	}
	// Delete
	if err := lib.Delete("my-edit"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, ok := lib.Get("my-edit"); ok {
		t.Fatal("deleted layout still present")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("file still exists after delete: %v", err)
	}
}

func TestLibraryBuiltinProtection(t *testing.T) {
	dir := t.TempDir()
	lib, err := LoadDefault(dir, "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	builtin, _ := lib.Get("xbox-default")
	builtin.Name = "Hacked"
	if err := lib.Update(builtin); !errors.Is(err, ErrBuiltinProtected) {
		t.Fatalf("update builtin err = %v, want builtin protected", err)
	}
	if err := lib.Delete("xbox-default"); !errors.Is(err, ErrBuiltinProtected) {
		t.Fatalf("delete builtin err = %v, want builtin protected", err)
	}
	dup := baseDoc()
	dup.ID = "xbox-default"
	dup.Name = "Duplicate"
	dup.Assets = []Asset{}
	if err := lib.Create(dup); !errors.Is(err, ErrBuiltinProtected) {
		t.Fatalf("create duplicate builtin err = %v, want builtin protected", err)
	}
}

func TestLibraryDeleteDefaultProtected(t *testing.T) {
	dir := t.TempDir()
	lib, err := LoadDefault(dir, "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	doc := baseDoc()
	doc.ID = "custom"
	doc.Name = "Custom"
	doc.Assets = []Asset{}
	if err := lib.Create(doc); err != nil {
		t.Fatal(err)
	}
	// A library whose default is a user document cannot delete it.
	lib2, err := LoadDefault(dir, "custom")
	if err != nil {
		t.Fatal(err)
	}
	if err := lib2.Delete("custom"); !errors.Is(err, ErrDefaultProtected) {
		t.Fatalf("delete default err = %v, want default protected", err)
	}
}

func TestLibraryReloadRetainsOldOnFailure(t *testing.T) {
	dir := t.TempDir()
	lib, err := LoadDefault(dir, "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	// Write an invalid user file manually.
	if err := os.WriteFile(filepath.Join(dir, "bad.json"), []byte(`{invalid`), 0o600); err != nil {
		t.Fatal(err)
	}
	// Reload should skip bad file and succeed, keeping existing docs.
	if err := lib.Reload(); err != nil {
		t.Fatalf("reload with bad file failed: %v", err)
	}
	if _, ok := lib.Get("xbox-default"); !ok {
		t.Fatal("default missing after reload")
	}
	// Now create a valid custom doc, then corrupt it to test that reload failure due to duplicate keeps old map.
	doc := baseDoc()
	doc.ID = "good"
	doc.Name = "Good"
	doc.Assets = []Asset{}
	if err := lib.Create(doc); err != nil {
		t.Fatal(err)
	}
	// Corrupt by writing a file with duplicate id that will cause duplicate between builtin and user? Instead write a duplicate id file with same id as builtin but different content, then reload should fail due to duplicate.
	// Create a file with id xbox-default manually.
	dupDoc := baseDoc()
	dupDoc.ID = "xbox-default"
	dupDoc.Name = "Dup"
	dupDoc.Assets = []Asset{}
	data, _ := marshalDoc(dupDoc)
	if err := os.WriteFile(filepath.Join(dir, "xbox-default.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := lib.Reload(); err == nil {
		t.Fatal("reload with duplicate should fail")
	}
	// Old map should still contain good.
	if _, ok := lib.Get("good"); !ok {
		t.Fatal("good layout missing after failed reload")
	}
	// Cleanup duplicate for other tests.
	_ = os.Remove(filepath.Join(dir, "xbox-default.json"))
	_ = lib.Reload()
}

func TestLibraryCreateConflict(t *testing.T) {
	dir := t.TempDir()
	lib, err := LoadDefault(dir, "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	doc := baseDoc()
	doc.ID = "conflict"
	doc.Name = "Conflict"
	doc.Assets = []Asset{}
	if err := lib.Create(doc); err != nil {
		t.Fatal(err)
	}
	if err := lib.Create(doc); !errors.Is(err, ErrLayoutExists) {
		t.Fatalf("second create err = %v, want exists", err)
	}
}

func marshalDoc(doc Document) ([]byte, error) {
	// helper to marshal without validation
	return []byte(`{"id":"` + doc.ID + `","name":"` + doc.Name + `","schemaVersion":2,"defaultOrientation":"landscape","sections":[{"id":"left","relativeWidth":0.86,"controls":[]},{"id":"center","relativeWidth":0.5,"controls":[]},{"id":"right","relativeWidth":0.94,"controls":[]}],"assets":[]}`), nil
}
