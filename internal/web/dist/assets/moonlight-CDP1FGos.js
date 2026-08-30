var e=`/* Moonlight — deep cool blue-gray, premium feel.
   Inspired by Sony DualSense and PlayStation dark mode.
   Subtle gradients, silver-blue accent, no harsh glow. */

html[data-skin="moonlight"] {
  --skin-accent: #7ba4d6;
  --accent-bright: #a8c8f0;
  --bg: #0c1220;
  --surface: #141d2e;
  --panel: #1a2640;
  --edge: #243352;
  --text: #c8d6e8;
  --skin-muted: #5c7090;
}

html[data-skin="moonlight"] body,
html[data-skin="moonlight"] .controller-shell {
  background: #080e18;
}

html[data-skin="moonlight"] .controller-frame {
  border-radius: clamp(0.8rem, 3vw, 1.8rem);
  background:
    radial-gradient(
      80% 65% at 50% 90%,
      rgba(123, 164, 214, 0.06) 0%,
      transparent 55%
    ),
    linear-gradient(180deg, #10192a 0%, #0c1220 50%, #080e18 100%);
}

html[data-skin="moonlight"] .controller-name {
  color: #e0ecf8;
}

html[data-skin="moonlight"] .controller-slot {
  color: var(--skin-accent);
}

html[data-skin="moonlight"] .controller-control {
  border: 1px solid rgba(123, 164, 214, 0.12);
  border-radius: 0.85rem;
  background: linear-gradient(
    180deg,
    rgba(26, 38, 64, 0.9) 0%,
    rgba(20, 29, 46, 0.95) 100%
  );
  color: var(--text);
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.4),
    0 1px 2px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(123, 164, 214, 0.08);
  transition:
    box-shadow 120ms ease,
    border-color 120ms ease,
    transform 120ms ease;
}

html[data-skin="moonlight"] [data-command="south"] {
  color: #68d89e;
}
html[data-skin="moonlight"] [data-command="east"] {
  color: #e88080;
}
html[data-skin="moonlight"] [data-command="west"] {
  color: #80b8f0;
}
html[data-skin="moonlight"] [data-command="north"] {
  color: #e8c868;
}

html[data-skin="moonlight"]
  .controller-control:not(.control-joystick):not(.controller-dpad).is-pressed {
  border-color: var(--skin-accent);
  box-shadow:
    0 0 20px rgba(123, 164, 214, 0.12),
    inset 0 2px 8px rgba(0, 0, 0, 0.4);
  transform: scale(0.97);
}

html[data-skin="moonlight"] .control-trigger {
  border-top: 1px solid rgba(123, 164, 214, 0.2);
}

html[data-skin="moonlight"] .control-joystick {
  border: 1px solid rgba(123, 164, 214, 0.12);
  background: radial-gradient(
    circle at 50% 40%,
    var(--panel) 0%,
    var(--surface) 70%
  );
  box-shadow:
    inset 0 4px 10px rgba(0, 0, 0, 0.5),
    inset 0 -2px 6px rgba(123, 164, 214, 0.04);
  transition:
    box-shadow 120ms ease,
    border-color 120ms ease;
}

html[data-skin="moonlight"] .control-joystick.is-active {
  border-color: rgba(123, 164, 214, 0.35);
  box-shadow:
    inset 0 4px 10px rgba(0, 0, 0, 0.5),
    0 0 16px rgba(123, 164, 214, 0.12);
}

html[data-skin="moonlight"] .control-joystick::after {
  width: 50%;
  height: 50%;
  background: linear-gradient(160deg, #3a5070 0%, #1e2d44 60%, #141d2e 100%);
  border: 1px solid rgba(123, 164, 214, 0.2);
  box-shadow:
    0 4px 10px rgba(0, 0, 0, 0.5),
    inset 0 1px 2px rgba(123, 164, 214, 0.1);
}

html[data-skin="moonlight"] .control-joystick.is-dragging::after {
  background: linear-gradient(160deg, #4a6890 0%, #2a4060 60%, #1a2e48 100%);
  border-color: var(--skin-accent);
}

html[data-skin="moonlight"] .dpad-direction {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--skin-muted);
  transition: color 100ms ease;
}

html[data-skin="moonlight"] .dpad-direction svg {
  width: 42%;
  height: 42%;
}

html[data-skin="moonlight"] .controller-dpad[data-direction="up"] .dpad-up,
html[data-skin="moonlight"]
  .controller-dpad[data-direction="right"]
  .dpad-right,
html[data-skin="moonlight"] .controller-dpad[data-direction="down"] .dpad-down,
html[data-skin="moonlight"] .controller-dpad[data-direction="left"] .dpad-left {
  color: var(--accent-bright);
  background: transparent;
  border-radius: 0.75rem;
}

html[data-skin="moonlight"] .controller-status {
  border: 1px solid #1e2d44;
  background: rgba(12, 18, 32, 0.9);
  color: #8aa4c4;
}

html[data-skin="moonlight"] .icon-button {
  border: 1px solid #1e2d44;
  background: var(--panel);
  color: #c8d6e8;
}

html[data-skin="moonlight"] .icon-button:hover {
  border-color: var(--skin-accent);
  color: #e0ecf8;
}

html[data-skin="moonlight"] .settings-backdrop {
  background: rgb(0 0 0 / 55%);
}

html[data-skin="moonlight"] .settings-sheet {
  border: 1px solid #1e2d44;
  background: #10192a;
}

html[data-skin="moonlight"] .settings-row {
  color: var(--text);
}

html[data-skin="moonlight"] .controller-layout-picker {
  border: 1px solid #1e2d44;
  background: var(--panel);
  color: #e0ecf8;
}

html[data-skin="moonlight"] .settings-value {
  color: var(--skin-accent);
}

html[data-skin="moonlight"] .settings-capabilities {
  color: var(--skin-muted);
}

html[data-skin="moonlight"] .orientation-message {
  border: 1px solid #1e2d44;
  background: #10192a;
  color: var(--text);
}

/* Hitfill extends its parent touch area — it must never paint. The skin’s
   .controller-control rules (background/border/shadow) must not apply to it,
   so hide it outright. Pointer hits stay on the parent hit target. */
html[data-skin="moonlight"] .controller-control.hit-only {
  visibility: hidden;
}
`;export{e as default};