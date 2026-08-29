package httpserver

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxAssetBytes = 512 * 1024

func (s *Server) userAssetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	prefix := "/assets/user/"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		http.NotFound(w, r)
		return
	}
	assetPath := strings.TrimPrefix(r.URL.Path, prefix)
	if assetPath == "" || strings.HasPrefix(assetPath, "/") {
		http.NotFound(w, r)
		return
	}
	if filepath.IsAbs(assetPath) || filepath.Clean(assetPath) != assetPath || strings.Contains(assetPath, "\\") || strings.Contains(assetPath, "..") {
		http.NotFound(w, r)
		return
	}
	userDir := s.options.Layouts.UserDir()
	if userDir == "" {
		http.NotFound(w, r)
		return
	}
	candidate := filepath.Join(userDir, filepath.FromSlash(assetPath))
	rel, err := filepath.Rel(userDir, candidate)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		http.NotFound(w, r)
		return
	}
	info, err := os.Lstat(candidate)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if info.Mode()&os.ModeSymlink != 0 || info.Size() > maxAssetBytes || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, candidate)
}
