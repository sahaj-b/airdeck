package httpserver

import (
	"io/fs"
	"net/http"
	"strings"
)

func (s *Server) staticHandler(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	switch path {
	case "", "join":
		path = "join.html"
	case "dashboard":
		path = "dashboard.html"
	case "editor":
		path = "editor.html"
	}
	if (path == "dashboard.html" || path == "editor.html") && !isLoopbackRequest(r) {
		http.Error(w, "dashboard is local to the host", http.StatusForbidden)
		return
	}
	if _, err := fs.Stat(s.static, path); err != nil {
		http.NotFound(w, r)
		return
	}
	http.ServeFileFS(w, r, s.static, path)
}
