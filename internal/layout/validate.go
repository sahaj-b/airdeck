package layout

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"strings"

	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed schema.json
var schemaBytes []byte

var compiledSchema = compileSchema()

func compileSchema() *jsonschema.Schema {
	doc, err := jsonschema.UnmarshalJSON(strings.NewReader(string(schemaBytes)))
	if err != nil {
		panic(fmt.Sprintf("layout schema: decode: %v", err))
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("layout.schema.json", doc); err != nil {
		panic(fmt.Sprintf("layout schema: add: %v", err))
	}
	schema, err := compiler.Compile("layout.schema.json")
	if err != nil {
		panic(fmt.Sprintf("layout schema: compile: %v", err))
	}
	return schema
}

func ValidateJSON(data []byte) (Document, error) {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return Document{}, fmt.Errorf("decode layout: %w", err)
	}
	if err := compiledSchema.Validate(value); err != nil {
		return Document{}, fmt.Errorf("layout schema: %w", err)
	}
	var document Document
	if err := json.Unmarshal(data, &document); err != nil {
		return Document{}, fmt.Errorf("decode layout document: %w", err)
	}
	if err := ValidateDocument(document); err != nil {
		return Document{}, err
	}
	return document, nil
}

func ValidateDocument(document Document) error {
	if document.SchemaVersion != 1 {
		return fmt.Errorf("unsupported layout schema version %d", document.SchemaVersion)
	}
	if document.ID == "" || document.Name == "" {
		return errors.New("layout id and name are required")
	}
	if document.DefaultOrientation != "landscape" && document.DefaultOrientation != "portrait" {
		return fmt.Errorf("unsupported default orientation %q", document.DefaultOrientation)
	}
	ids := make(map[string]string)
	checkID := func(id, kind string) error {
		if id == "" {
			return fmt.Errorf("%s id is required", kind)
		}
		if previous, ok := ids[id]; ok {
			return fmt.Errorf("duplicate id %q used by %s and %s", id, previous, kind)
		}
		ids[id] = kind
		return nil
	}
	if err := checkID(document.ID, "document"); err != nil {
		return err
	}
	assetIDs := make(map[string]struct{}, len(document.Assets))
	for _, asset := range document.Assets {
		if err := checkID(asset.ID, "asset"); err != nil {
			return err
		}
		if _, ok := assetIDs[asset.ID]; ok {
			return fmt.Errorf("duplicate asset id %q", asset.ID)
		}
		assetIDs[asset.ID] = struct{}{}
		if err := validateAssetPath(asset.Path); err != nil {
			return fmt.Errorf("asset %q: %w", asset.ID, err)
		}
	}
	for _, section := range document.Sections {
		if err := checkID(section.ID, "section"); err != nil {
			return err
		}
		if err := validateRect(section.Rect); err != nil {
			return fmt.Errorf("section %q: %w", section.ID, err)
		}
		for _, control := range section.Controls {
			if err := checkID(control.ID, "control"); err != nil {
				return err
			}
			if err := validateControl(control, assetIDs); err != nil {
				return fmt.Errorf("control %q: %w", control.ID, err)
			}
		}
	}
	return nil
}

func validateControl(control Control, assetIDs map[string]struct{}) error {
	switch control.Type {
	case "button", "dpad", "joystick", "trigger", "label", "image":
	default:
		return fmt.Errorf("unsupported control type %q", control.Type)
	}
	switch control.Shape {
	case "", "circle", "pill", "rect":
	default:
		return fmt.Errorf("unsupported control shape %q", control.Shape)
	}
	if err := validateControlRect(control.Rect); err != nil {
		return err
	}
	if control.Type == "joystick" || control.Type == "dpad" {
		if !isSquare(control.Rect) {
			return errors.New("joystick and d-pad controls must be square")
		}
		if control.Orientations != nil {
			for name, rect := range map[string]*Rect{
				"portrait":  control.Orientations.Portrait,
				"landscape": control.Orientations.Landscape,
			} {
				if rect != nil && !isSquare(*rect) {
					return fmt.Errorf("%s override must be square", name)
				}
			}
		}
	}
	if control.Type == "image" {
		if control.Asset == "" {
			return errors.New("image control requires an asset")
		}
		if _, ok := assetIDs[control.Asset]; !ok {
			return fmt.Errorf("asset %q is not declared", control.Asset)
		}
	}
	if control.Type == "label" && control.Binding != "" {
		return errors.New("label controls cannot bind input")
	}
	if control.Binding != "" {
		if _, ok := protocol.KnownCommands[protocol.Command(control.Binding)]; !ok {
			return fmt.Errorf("unknown semantic command %q", control.Binding)
		}
	}
	if control.Bindings != nil {
		for _, binding := range []string{control.Bindings.Up, control.Bindings.Down, control.Bindings.Left, control.Bindings.Right} {
			if binding == "" {
				continue
			}
			if binding != string(protocol.CommandDPadUp) && binding != string(protocol.CommandDPadDown) && binding != string(protocol.CommandDPadLeft) && binding != string(protocol.CommandDPadRight) {
				return fmt.Errorf("invalid d-pad command %q", binding)
			}
		}
	}
	if control.Type == "dpad" {
		if control.Bindings == nil {
			return errors.New("d-pad controls require four bindings")
		}
		if control.Bindings.Up == "" || control.Bindings.Down == "" || control.Bindings.Left == "" || control.Bindings.Right == "" {
			return errors.New("d-pad controls require four bindings")
		}
	}
	if control.Type == "joystick" && control.Binding != string(protocol.CommandLeftStick) && control.Binding != string(protocol.CommandRightStick) {
		return errors.New("joystick controls require a stick binding")
	}
	if control.Type == "trigger" && control.Binding != string(protocol.CommandLeftTrigger) && control.Binding != string(protocol.CommandRightTrigger) {
		return errors.New("trigger controls require a trigger binding")
	}
	if control.Orientations != nil {
		if control.Orientations.Portrait != nil {
			if err := validateControlRect(*control.Orientations.Portrait); err != nil {
				return fmt.Errorf("portrait override: %w", err)
			}
		}
		if control.Orientations.Landscape != nil {
			if err := validateControlRect(*control.Orientations.Landscape); err != nil {
				return fmt.Errorf("landscape override: %w", err)
			}
		}
	}
	return nil
}

func validateRect(rect Rect) error {
	if rect.X < 0 || rect.Y < 0 || rect.Width <= 0 || rect.Height <= 0 || rect.X+rect.Width > 1 || rect.Y+rect.Height > 1 {
		return fmt.Errorf("geometry is outside normalized bounds")
	}
	return nil
}

// Control width is a fraction of section height while x spans the section
// width, so horizontal containment cannot be validated numerically.
func validateControlRect(rect Rect) error {
	if rect.X < 0 || rect.X > 1 || rect.Y < 0 || rect.Width <= 0 || rect.Height <= 0 || rect.Y+rect.Height > 1 {
		return fmt.Errorf("geometry is outside normalized bounds")
	}
	return nil
}

func isSquare(rect Rect) bool {
	const epsilon = 1e-9
	return math.Abs(rect.Width-rect.Height) < epsilon
}

func validateAssetPath(path string) error {
	if path == "" || filepath.IsAbs(path) || filepath.Clean(path) != path || strings.HasPrefix(path, "../") || path == ".." || strings.Contains(path, `\`) {
		return errors.New("unsafe asset path")
	}
	return nil
}

func assetWithin(root, path string) (string, error) {
	if err := validateAssetPath(path); err != nil {
		return "", err
	}
	candidate := filepath.Join(root, filepath.FromSlash(path))
	rel, err := filepath.Rel(root, candidate)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("asset escapes preset directory")
	}
	return candidate, nil
}
