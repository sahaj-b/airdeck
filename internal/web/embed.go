package web

import (
	"embed"
	"io/fs"
)

//go:embed dist
var embedded embed.FS

func FS() fs.FS { return embedded }
