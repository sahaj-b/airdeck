package layout

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
)

//go:embed presets/*.json
var builtinFS embed.FS

const maxPresetBytes = 512 * 1024

func LoadBuiltins() ([]Document, error) {
	entries, err := fs.ReadDir(builtinFS, "presets")
	if err != nil {
		return nil, fmt.Errorf("read built-in layouts: %w", err)
	}
	var documents []Document
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := fs.ReadFile(builtinFS, path.Join("presets", entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("read built-in layout %q: %w", entry.Name(), err)
		}
		doc, err := ValidateJSON(data)
		if err != nil {
			return nil, fmt.Errorf("built-in layout %q: %w", entry.Name(), err)
		}
		documents = append(documents, doc)
	}
	return documents, nil
}

func LoadUser(dir string) ([]Document, error) {
	if dir == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read user layouts: %w", err)
	}
	var documents []Document
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		document, err := loadUserFile(dir, entry)
		if err != nil {
			log.Printf("airdeck: skipping user layout %q: %v", path, err)
			continue
		}
		documents = append(documents, document)
	}
	return documents, nil
}

func loadUserFile(dir string, entry os.DirEntry) (Document, error) {
	path := filepath.Join(dir, entry.Name())
	info, err := entry.Info()
	if err != nil {
		return Document{}, fmt.Errorf("stat: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || info.Size() > maxPresetBytes {
		return Document{}, errors.New("symlink or exceeds the size limit")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Document{}, fmt.Errorf("read: %w", err)
	}
	doc, err := ValidateJSON(data)
	if err != nil {
		return Document{}, err
	}
	return doc, nil
}

func LoadDefault(userDir, defaultID string) (*Library, error) {
	builtins, err := LoadBuiltins()
	if err != nil {
		return nil, err
	}
	users, err := LoadUser(userDir)
	if err != nil {
		return nil, err
	}
	documents := append(builtins, users...)
	if defaultID == "" {
		defaultID = "xbox-default"
	}
	library, err := NewLibrary(documents, defaultID)
	if err != nil {
		return nil, err
	}
	builtinsSet := make(map[string]struct{}, len(builtins))
	for _, doc := range builtins {
		builtinsSet[doc.ID] = struct{}{}
	}
	library.setSource(userDir, builtinsSet)
	return library, nil
}
