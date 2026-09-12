package roomcode

import (
	"strings"
	"testing"
)

func TestNormalize(t *testing.T) {
	cases := []struct{ in, want string }{
		{"abcdef", "ABCDEF"},
		{"  abc-def ", "ABCDEF"},
		{"AB CD-12", "ABCD12"},
		{"\tab-cd\n", "ABCD"},
		{"---", ""},
		{"", ""},
	}
	for _, tc := range cases {
		if got := Normalize(tc.in); got != tc.want {
			t.Fatalf("Normalize(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestValidateAcceptsGeneratedAndCustom(t *testing.T) {
	valid := []string{
		"ABCDEF",                // 6-char generated shape
		"ABCD",                  // 4-char custom minimum
		"abcdefgh",              // lowercase folds
		"ab-cd-ef",              // dashes strip
		"AB CD EF",              // spaces strip
		"23456789",              // digits 2-9
		strings.Repeat("A", 24), // custom maximum
	}
	for _, code := range valid {
		if err := Validate(code); err != nil {
			t.Fatalf("Validate(%q) = %v, want nil", code, err)
		}
	}
}

func TestValidateRejectsAmbiguousChars(t *testing.T) {
	// 0/O, 1/I/L are ambiguous and never valid, even though 0/1 look like digits.
	ambiguous := []string{"ABCD0E", "ABCDOE", "ABCD1E", "ABCDIE", "ABCDLE", "abcdle", "0042", "1234", "0000", "4821"}
	for _, code := range ambiguous {
		if err := Validate(code); err == nil {
			t.Fatalf("Validate(%q) accepted ambiguous char", code)
		}
	}
}

func TestValidateRejectsBadLengthAndCharset(t *testing.T) {
	invalid := []string{
		"",
		"ABC",                   // too short
		strings.Repeat("A", 25), // too long
		"AB!D",                  // punctuation
		"AB_D",                  // underscore
		"12x4",                  // x not in alphabet... also has 1
		"AB.C",                  // dot
	}
	for _, code := range invalid {
		if err := Validate(code); err == nil {
			t.Fatalf("Validate(%q) accepted, want error", code)
		}
	}
	// Dashes-only normalizes to empty, which is too short.
	if err := Validate("---"); err == nil {
		t.Fatal("Validate(\"---\") accepted, want error")
	}
}

func TestGenerate(t *testing.T) {
	seen := make(map[string]struct{})
	for i := 0; i < 100; i++ {
		code, err := Generate()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != GeneratedLength {
			t.Fatalf("Generate() length = %d, want %d", len(code), GeneratedLength)
		}
		if err := Validate(code); err != nil {
			t.Fatalf("Generate() produced invalid code %q: %v", code, err)
		}
		seen[code] = struct{}{}
	}
	if len(seen) < 90 {
		t.Fatalf("Generate() produced only %d unique codes in 100 draws, want >= 90", len(seen))
	}
}

func TestGenerateInstallationKey(t *testing.T) {
	first, err := GenerateInstallationKey()
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 64 {
		t.Fatalf("installation key length = %d, want 64 hex chars", len(first))
	}
	for _, r := range first {
		if !strings.ContainsRune("0123456789abcdef", r) {
			t.Fatalf("installation key %q contains non-lowercase-hex %q", first, r)
		}
	}
	second, err := GenerateInstallationKey()
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("two installation keys collided")
	}
}
