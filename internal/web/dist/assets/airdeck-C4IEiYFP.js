var e=`/* Onyx — the default airdeck skin. Dark, high-contrast, emerald accent.
   Every rule is scoped to html[data-skin="airdeck"] so it only fires when
   active. Add more skins as sibling files in this directory. */

html[data-skin="airdeck"] {
  color-scheme: dark;
  background: #090b10;
  color: #f3f6fb;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

html[data-skin="airdeck"] body {
  background: #090b10;
}

html[data-skin="airdeck"] .controller-shell {
  --slot-accent: #6ee7b7;
  background: #090b10;
}

html[data-skin="airdeck"] .controller-frame {
  border: 1px solid #1a2535;
  border-radius: clamp(0.8rem, 3vw, 1.8rem);
  background: #0e141d;
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 2%),
    0 1rem 3rem rgb(0 0 0 / 20%);
}

html[data-skin="airdeck"] .controller-control {
  border: 2px solid #6b7d94;
  border-radius: 0.55rem;
  padding: 0.3rem;
  background: #18212e;
  color: #f3f6fb;
  font-weight: 800;
  letter-spacing: 0.04em;
}

html[data-skin="airdeck"] .controller-control:hover,
html[data-skin="airdeck"] .dpad-direction:hover {
  border-color: #c6d0dd;
}

html[data-skin="airdeck"] .controller-control.is-pressed {
  border-color: var(--slot-accent);
  background: color-mix(in srgb, var(--slot-accent) 32%, #18212e);
}

html[data-skin="airdeck"]
  .controller-control:not(.control-joystick):not(.controller-dpad).is-pressed {
  transform: scale(0.96);
}

html[data-skin="airdeck"] .control-joystick {
  border-radius: 50%;
  background: radial-gradient(circle at 42% 34%, #2b394d, #121a25 72%);
  box-shadow: inset 0 0 1.2rem rgb(0 0 0 / 45%);
}

html[data-skin="airdeck"] .control-joystick::after {
  border: 2px solid var(--slot-accent);
  background: #273447;
}

html[data-skin="airdeck"] .dpad-direction {
  border: 2px solid #6b7d94;
  border-radius: 12%;
  padding: 0;
  background: #18212e;
  color: #aeb9c9;
}

html[data-skin="airdeck"] .controller-dpad[data-direction="up"] .dpad-up,
html[data-skin="airdeck"] .controller-dpad[data-direction="right"] .dpad-right,
html[data-skin="airdeck"] .controller-dpad[data-direction="down"] .dpad-down,
html[data-skin="airdeck"] .controller-dpad[data-direction="left"] .dpad-left {
  border-color: var(--slot-accent);
  background: color-mix(in srgb, var(--slot-accent) 32%, #18212e);
  color: var(--slot-accent);
}

html[data-skin="airdeck"] .controller-label {
  color: #aeb9c9;
  font-size: clamp(0.55rem, calc(var(--control-min, 32px) * 0.32), 0.95rem);
}

html[data-skin="airdeck"] .controller-slot {
  color: var(--slot-accent);
}

html[data-skin="airdeck"] .controller-name {
  color: #f3f6fb;
}

html[data-skin="airdeck"] .controller-status {
  border: 1px solid #1a2535;
  background: #151b25;
  color: #d8e0eb;
}

html[data-skin="airdeck"] .icon-button {
  border: 1px solid #1a2535;
  background: #151b25;
  color: #c6d0dd;
}

html[data-skin="airdeck"] .icon-button:hover {
  border-color: #3f4a5c;
  color: #f3f6fb;
}

html[data-skin="airdeck"] .settings-backdrop {
  background: rgb(0 0 0 / 55%);
}

html[data-skin="airdeck"] .settings-sheet {
  border: 1px solid #1a2535;
  background: #10151d;
}

html[data-skin="airdeck"] .settings-row {
  color: #d8e0eb;
}

html[data-skin="airdeck"] .settings-row input[type="checkbox"] {
  accent-color: var(--slot-accent, #6ee7b7);
}

html[data-skin="airdeck"] .controller-layout-picker {
  border: 1px solid #3f4a5c;
  background: #151b25;
  color: #f3f6fb;
}

html[data-skin="airdeck"] .settings-value {
  color: #aeb9c9;
}

html[data-skin="airdeck"] .settings-capabilities {
  color: #8a98ab;
}

html[data-skin="airdeck"] .orientation-message {
  border: 1px solid #3f4a5c;
  background: #151b25;
  color: #d8e0eb;
}
`;export{e as default};