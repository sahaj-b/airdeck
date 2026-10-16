package main

import (
	"flag"
	"testing"
)

// optionalBool accepts exactly flag.Bool's values, so a typo fails the
// parse instead of silently enabling the flag, while bare --flag still
// enables (the flag package passes "true" through IsBoolFlag).
func TestOptionalBoolFlagValues(t *testing.T) {
	parse := func(args ...string) (optionalBool, error) {
		flags := flag.NewFlagSet("test", flag.ContinueOnError)
		var value optionalBool
		flags.Var(&value, "lan-only", "test flag")
		if err := flags.Parse(args); err != nil {
			return optionalBool{}, err
		}
		return value, nil
	}

	bare, err := parse("--lan-only")
	if err != nil || !bare.set || !bare.value {
		t.Fatalf("bare --lan-only = %+v, %v; want set true", bare, err)
	}
	off, err := parse("--lan-only=false")
	if err != nil || !off.set || off.value {
		t.Fatalf("--lan-only=false = %+v, %v; want set false", off, err)
	}
	unset, err := parse()
	if err != nil || unset.set || unset.value {
		t.Fatalf("no flag = %+v, %v; want unset", unset, err)
	}
	if _, err := parse("--lan-only=flase"); err == nil {
		t.Fatal("typo --lan-only=flase parsed without error")
	}
}
