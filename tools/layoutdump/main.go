package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/sahaj-b/airdeck/internal/layout"
)

func main() {
	docs, err := layout.LoadBuiltins()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	data, err := json.Marshal(docs[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Stdout.Write(data)
}
