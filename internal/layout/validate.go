package layout

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"regexp"
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

var parentIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)

func ValidateDocument(document Document) error {
	if document.SchemaVersion != 2 {
		return fmt.Errorf("unsupported layout schema version %d", document.SchemaVersion)
	}
	if document.ID == "" || document.Name == "" {
		return errors.New("layout id and name are required")
	}
	if document.DefaultOrientation != "landscape" && document.DefaultOrientation != "portrait" {
		return fmt.Errorf("unsupported default orientation %q", document.DefaultOrientation)
	}
	if len(document.Sections) != 3 {
		return errors.New("layout must contain exactly 3 sections")
	}
	expectedIDs := []string{"left", "center", "right"}
	for i, section := range document.Sections {
		if section.ID != expectedIDs[i] {
			return fmt.Errorf("section %d id must be %q, got %q", i, expectedIDs[i], section.ID)
		}
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
	// Second pass: hitfill parent relation validation (requires full id map)
	controlByID := make(map[string]Control)
	sectionByControlID := make(map[string]string)
	for _, section := range document.Sections {
		for _, control := range section.Controls {
			controlByID[control.ID] = control
			sectionByControlID[control.ID] = section.ID
		}
	}
	for _, section := range document.Sections {
		for _, control := range section.Controls {
			if control.Type == "hitfill" {
				if control.ParentID == control.ID {
					return fmt.Errorf("control %q: parentId must not be self", control.ID)
				}
				parent, ok := controlByID[control.ParentID]
				if !ok {
					return fmt.Errorf("control %q: parentId %q does not exist", control.ID, control.ParentID)
				}
				if sectionByControlID[control.ParentID] != section.ID {
					return fmt.Errorf("control %q: parentId %q must be in same section", control.ID, control.ParentID)
				}
				if parent.Type == "hitfill" {
					return fmt.Errorf("control %q: parentId %q must not reference another hitfill", control.ID, control.ParentID)
				}
			}
		}
	}
	return nil
}

func validateSection(section Section) error {
	if !finite(section.RelativeWidth) || section.RelativeWidth <= 0 || section.RelativeWidth > 4 {
		return errors.New("relativeWidth is invalid")
	}
	if section.RelativeMinWidth != nil {
		if !finite(*section.RelativeMinWidth) || *section.RelativeMinWidth <= 0 || *section.RelativeMinWidth > 4 {
			return errors.New("relativeMinWidth is invalid")
		}
	}
	return nil
}

func validateControl(control Control, section Section, assetIDs map[string]struct{}) error {
	switch control.Type {
	case "button", "dpad", "joystick", "trigger", "label", "image", "hitfill":
	default:
		return fmt.Errorf("unsupported control type %q", control.Type)
	}
	isHitfill := control.Type == "hitfill"
	if isHitfill {
		switch control.Shape {
		case "", "round", "rect":
		default:
			return fmt.Errorf("unsupported control shape %q", control.Shape)
		}
		switch control.HitShape {
		case "":
		default:
			return errors.New("hitfill must not have hitShape")
		}
		if control.ParentID == "" {
			return errors.New("hitfill requires parentId")
		}
		if !parentIDPattern.MatchString(control.ParentID) {
			return fmt.Errorf("invalid parentId %q", control.ParentID)
		}
		if control.Binding != "" {
			return errors.New("hitfill must not have a binding")
		}
		if control.Bindings != nil {
			return errors.New("hitfill must not have bindings")
		}
		if control.Asset != "" {
			return errors.New("hitfill must not have an asset")
		}
	} else {
		switch control.Shape {
		case "", "round", "rect":
		default:
			return fmt.Errorf("unsupported control shape %q", control.Shape)
		}
		switch control.HitShape {
		case "", "rect":
		default:
			return fmt.Errorf("unsupported hitShape %q", control.HitShape)
		}
		if control.ParentID != "" {
			return errors.New("only hitfill controls may have parentId")
		}
	}
	if err := validateGeometry(control.Geometry, section, "geometry"); err != nil {
		return err
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
		if _, ok := protocol.KnownCommands[control.Binding]; !ok {
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
	if control.Type == "joystick" && control.Binding != protocol.CommandLeftStick && control.Binding != protocol.CommandRightStick {
		return errors.New("joystick controls require a stick binding")
	}
	if control.Type == "trigger" && control.Binding != protocol.CommandLeftTrigger && control.Binding != protocol.CommandRightTrigger {
		return errors.New("trigger controls require a trigger binding")
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

	contentWidth := section.RelativeWidth
	contentHeight := 1.0
	centerX := contentWidth / 2
	centerY := contentHeight / 2
	// Midpoint check: center must be inside section, edges may overflow.
	centerPosX := centerX + geometry.Position.X
	centerPosY := centerY + geometry.Position.Y
	const epsilon = 1e-9
	if centerPosX < -epsilon || centerPosX > contentWidth+epsilon || centerPosY < -epsilon || centerPosY > contentHeight+epsilon {
		return fmt.Errorf("%s extends outside the authored section bounds", name)
	}
	return nil
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
