var e=`/* OLED true black — pure #000, minimal surfaces, visible borders.
   Everything is ink-on-void. Zero gradients, zero shadows.
   Optimized for OLED panels where black = pixel off. */

html[data-skin="oled"] {
  --skin-accent: #4fc3f7;
  --void: #000000;
  --surface: #0a0a0a;
  --edge: #999999;
  --text: #e0e0e0;
  --skin-muted: #777777;
}

html[data-skin="oled"] body,
html[data-skin="oled"] .controller-shell {
  background: var(--void);
}

html[data-skin="oled"] .controller-frame {
  background: var(--void);
}

html[data-skin="oled"] .controller-name {
  color: var(--text);
}

html[data-skin="oled"] .controller-slot {
  color: var(--skin-accent);
}

html[data-skin="oled"] .controller-control {
  border: 1.5px solid var(--edge);
  border-radius: 0.5rem;
  background: var(--void);
  color: var(--edge);
  transition:
    border-color 120ms ease,
    color 120ms ease;
}

html[data-skin="oled"] [data-command="south"] {
  color: #66bb6a;
}
html[data-skin="oled"] [data-command="east"] {
  color: #ef5350;
}
html[data-skin="oled"] [data-command="west"] {
  color: #42a5f5;
}
html[data-skin="oled"] [data-command="north"] {
  color: #ffca28;
}

html[data-skin="oled"] .controller-control.is-pressed {
  background: var(--surface);
  border-color: var(--skin-accent);
  color: var(--text);
}

html[data-skin="oled"] .control-joystick {
  border: 1.5px solid var(--edge);
  background: var(--void);
  transition: border-color 120ms ease;
}

html[data-skin="oled"] .control-joystick[data-shape="round"] {
  border-radius: 50%;
}

html[data-skin="oled"] .control-joystick[data-shape="rect"] {
  border-radius: 0.5rem;
}

html[data-skin="oled"] .control-joystick.is-active {
  border-color: var(--skin-accent);
}

html[data-skin="oled"] .control-joystick::after {
  width: 36%;
  height: 36%;
  border: 1.5px solid var(--edge);
  background: var(--void);
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

html[data-skin="oled"] .control-joystick.is-dragging::after {
  background: var(--skin-accent);
  border-color: var(--skin-accent);
}

html[data-skin="oled"] .dpad-direction {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--edge);
  transition: color 100ms ease;
}

html[data-skin="oled"] .dpad-direction svg {
  width: 44%;
  height: 44%;
}

html[data-skin="oled"] .controller-dpad[data-direction="up"] .dpad-up {
  background: transparent !important;
  border: 1.5px solid var(--skin-accent) !important;
  border-bottom: 0 !important;
  box-shadow: none !important;
  color: var(--skin-accent);
}

html[data-skin="oled"] .controller-dpad[data-direction="down"] .dpad-down {
  background: transparent !important;
  border: 1.5px solid var(--skin-accent) !important;
  border-top: 0 !important;
  box-shadow: none !important;
  color: var(--skin-accent);
}

html[data-skin="oled"] .controller-dpad[data-direction="left"] .dpad-left {
  background: transparent !important;
  border: 1.5px solid var(--skin-accent) !important;
  border-right: 0 !important;
  box-shadow: none !important;
  color: var(--skin-accent);
}

html[data-skin="oled"] .controller-dpad[data-direction="right"] .dpad-right {
  background: transparent !important;
  border: 1.5px solid var(--skin-accent) !important;
  border-left: 0 !important;
  box-shadow: none !important;
  color: var(--skin-accent);
}

html[data-skin="oled"] .controller-status {
  border: 1.5px solid var(--edge);
  background: var(--void);
  color: var(--edge);
}

html[data-skin="oled"] .icon-button {
  border: 1.5px solid var(--edge);
  background: var(--void);
  color: var(--edge);
}

html[data-skin="oled"] .icon-button:hover {
  border-color: var(--skin-accent);
  color: var(--text);
}

html[data-skin="oled"] .settings-backdrop {
  background: rgb(0 0 0 / 80%);
}

html[data-skin="oled"] .settings-sheet {
  border: 1.5px solid var(--edge);
  background: var(--void);
}

html[data-skin="oled"] .settings-row {
  color: var(--text);
}

html[data-skin="oled"] .controller-layout-picker {
  border: 1.5px solid var(--edge);
  background: var(--void);
  color: var(--text);
}

html[data-skin="oled"] .settings-value {
  color: var(--skin-accent);
}

html[data-skin="oled"] .settings-capabilities {
  color: var(--skin-muted);
}

html[data-skin="oled"] .orientation-message {
  border: 1.5px solid var(--edge);
  background: var(--void);
  color: var(--text);
}

/* Hitzone extends its parent touch area — it must never paint. The skin’s
   .controller-control rules (background/border/shadow) must not apply to it,
   so hide it outright. Pointer hits stay on the parent hit target. */
html[data-skin="oled"] .controller-control.hit-only {
  visibility: hidden;
}
`;export{e as default};