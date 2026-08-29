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
	if len(document.Sections) == 0 || len(document.Sections) > 16 {
		return errors.New("layout must contain between 1 and 16 sections")
	}
	if len(document.Assets) > 64 {
		return errors.New("layout cannot contain more than 64 assets")
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
		if err := validateSection(section); err != nil {
			return fmt.Errorf("section %q: %w", section.ID, err)
		}
		if len(section.Controls) > 128 {
			return fmt.Errorf("section %q cannot contain more than 128 controls", section.ID)
		}
		for _, control := range section.Controls {
			if err := checkID(control.ID, "control"); err != nil {
				return err
			}
			if err := validateControl(control, section, assetIDs); err != nil {
				return fmt.Errorf("control %q: %w", control.ID, err)
			}
		}
	}
	return nil
}

func validateSection(section Section) error {
	for name, value := range map[string]float64{
		"aspect ratio":  section.AspectRatio,
		"minimum width": section.MinWidth,
		"maximum width": section.MaxWidth,
		"flex grow":     section.FlexGrow,
		"flex shrink":   section.FlexShrink,
	} {
		if !finite(value) || value < 0 {
			return fmt.Errorf("%s is invalid", name)
		}
	}
	if section.AspectRatio <= 0 || section.MinWidth <= 0 || section.MaxWidth <= 0 {
		return errors.New("section widths must be positive")
	}
	if section.AspectRatio > 4 || section.MinWidth > 4 || section.MaxWidth > 4 || section.FlexGrow > 100 || section.FlexShrink > 100 {
		return errors.New("section sizing values exceed their bounds")
	}
	if section.MaxWidth < section.MinWidth {
		return errors.New("maximum width is smaller than minimum width")
	}
	for name, value := range map[string]float64{
		"left": section.Padding.Left, "right": section.Padding.Right,
		"top": section.Padding.Top, "bottom": section.Padding.Bottom,
	} {
		if !finite(value) || value < 0 || value > 0.5 {
			return fmt.Errorf("section padding %s is invalid", name)
		}
	}
	if section.Padding.Left+section.Padding.Right >= section.MinWidth {
		return errors.New("horizontal padding leaves no minimum section content")
	}
	if section.Padding.Top+section.Padding.Bottom >= 1 {
		return errors.New("vertical padding leaves no section content")
	}
	return nil
}

func validateControl(control Control, section Section, assetIDs map[string]struct{}) error {
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
	if err := validateGeometry(control.Geometry, section, "geometry"); err != nil {
		return err
	}
	if control.Type == "joystick" || control.Type == "dpad" {
		if !isSquare(control.Geometry.Size) {
			return errors.New("joystick and d-pad controls must be square")
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
			if err := validateGeometry(*control.Orientations.Portrait, section, "portrait override"); err != nil {
				return err
			}
			if (control.Type == "joystick" || control.Type == "dpad") && !isSquare(control.Orientations.Portrait.Size) {
				return errors.New("portrait override must be square")
			}
		}
		if control.Orientations.Landscape != nil {
			if err := validateGeometry(*control.Orientations.Landscape, section, "landscape override"); err != nil {
				return err
			}
			if (control.Type == "joystick" || control.Type == "dpad") && !isSquare(control.Orientations.Landscape.Size) {
				return errors.New("landscape override must be square")
			}
		}
	}
	return nil
}

func validateGeometry(geometry Geometry, section Section, name string) error {
	if !finite(geometry.Position.X) || !finite(geometry.Position.Y) || geometry.Position.X < -2 || geometry.Position.X > 2 || geometry.Position.Y < -2 || geometry.Position.Y > 2 {
		return fmt.Errorf("%s position is invalid", name)
	}
	if !finite(geometry.Size.Width) || !finite(geometry.Size.Height) || geometry.Size.Width <= 0 || geometry.Size.Height <= 0 || geometry.Size.Width > 2 || geometry.Size.Height > 2 {
		return fmt.Errorf("%s size is invalid", name)
	}

	contentWidth := section.AspectRatio - section.Padding.Left - section.Padding.Right
	contentHeight := 1 - section.Padding.Top - section.Padding.Bottom
	centerX := section.Padding.Left + contentWidth/2
	centerY := section.Padding.Top + contentHeight/2
	left := centerX + geometry.Position.X - geometry.Size.Width/2
	right := left + geometry.Size.Width
	top := centerY + geometry.Position.Y - geometry.Size.Height/2
	bottom := top + geometry.Size.Height
	const epsilon = 1e-9
	if left < -epsilon || right > section.AspectRatio+epsilon || top < -epsilon || bottom > 1+epsilon {
		return fmt.Errorf("%s extends outside the authored section bounds", name)
	}
	return nil
}

func isSquare(size Size) bool {
	const epsilon = 1e-9
	return math.Abs(size.Width-size.Height) < epsilon
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

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
