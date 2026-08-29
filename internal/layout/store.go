package layout

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

var (
	ErrBuiltinProtected = errors.New("builtin layouts cannot be modified")
	ErrLayoutExists     = errors.New("layout already exists")
	ErrLayoutNotFound   = errors.New("layout not found")
	ErrDefaultProtected = errors.New("cannot delete the active default layout")
)

// Reload atomically replaces the library's document map with the current
// built-in and user documents. A failure keeps the existing map unchanged.
func (l *Library) Reload() error {
	userDir := l.UserDir()
	builtins, err := LoadBuiltins()
	if err != nil {
		return err
	}
	users, err := LoadUser(userDir)
	if err != nil {
		return err
	}
	docs := make(map[string]Document, len(builtins)+len(users))
	for _, doc := range builtins {
		docs[doc.ID] = doc
	}
	for _, doc := range users {
		if _, exists := docs[doc.ID]; exists {
			return fmt.Errorf("duplicate layout id %q", doc.ID)
		}
		docs[doc.ID] = doc
	}
	// Ensure default still exists before swapping.
	l.mu.RLock()
	defaultID := l.defaultID
	l.mu.RUnlock()
	if _, ok := docs[defaultID]; !ok {
		return fmt.Errorf("default layout %q is not available", defaultID)
	}
	newBuiltins := make(map[string]struct{}, len(builtins))
	for _, doc := range builtins {
		newBuiltins[doc.ID] = struct{}{}
	}
	l.mu.Lock()
	l.docs = docs
	l.builtins = newBuiltins
	l.mu.Unlock()
	return nil
}

// Create validates and persists a new user layout. It returns 403 for builtin
// collisions, 409 for existing ids, and 400 for validation failures.
func (l *Library) Create(doc Document) error {
	if err := ValidateDocument(doc); err != nil {
		return err
	}
	if l.IsBuiltin(doc.ID) {
		return ErrBuiltinProtected
	}
	if _, ok := l.Get(doc.ID); ok {
		return ErrLayoutExists
	}
	if err := writeDocument(l.UserDir(), doc); err != nil {
		return err
	}
	if err := l.Reload(); err != nil {
		return err
	}
	return nil
}

// Update validates and persists an existing user layout.
func (l *Library) Update(doc Document) error {
	if err := ValidateDocument(doc); err != nil {
		return err
	}
	if l.IsBuiltin(doc.ID) {
		return ErrBuiltinProtected
	}
	if _, ok := l.Get(doc.ID); !ok {
		return ErrLayoutNotFound
	}
	if err := writeDocument(l.UserDir(), doc); err != nil {
		return err
	}
	if err := l.Reload(); err != nil {
		return err
	}
	return nil
}

// Delete removes a user layout file and reloads the library.
func (l *Library) Delete(id string) error {
	if l.IsBuiltin(id) {
		return ErrBuiltinProtected
	}
	if _, ok := l.Get(id); !ok {
		return ErrLayoutNotFound
	}
	l.mu.RLock()
	defaultID := l.defaultID
	l.mu.RUnlock()
	if id == defaultID {
		return ErrDefaultProtected
	}
	userDir := l.UserDir()
	if userDir == "" {
		return ErrLayoutNotFound
	}
	path := filepath.Join(userDir, id+".json")
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return ErrLayoutNotFound
		}
		return fmt.Errorf("remove layout: %w", err)
	}
	if err := l.Reload(); err != nil {
		return err
	}
	return nil
}

func writeDocument(dir string, doc Document) error {
	if dir == "" {
		return errors.New("user layouts directory is not configured")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create layouts directory: %w", err)
	}
	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("encode layout: %w", err)
	}
	data = append(data, '\n')
	tmp, err := os.CreateTemp(dir, ".layout-*")
	if err != nil {
		return fmt.Errorf("create temporary layout: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("set layout permissions: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write layout: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sync layout: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close layout: %w", err)
	}
	dest := filepath.Join(dir, doc.ID+".json")
	if err := os.Rename(tmpName, dest); err != nil {
		return fmt.Errorf("replace layout: %w", err)
	}
	return nil
}
