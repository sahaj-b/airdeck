var e=`/* Retro pixel — PICO-8-ish palette, Press Start 2P, hard offset shadows.
   Recipe: flat fill + 3px dark border + 4px 4px 0 shadow; press translates
   into the shadow (translate(4px,4px), shadow removed). */

html[data-skin="retro"] {
  --skin-accent: #ffcd75;
  --ink: #1a1c2c;
  --line: #0d0e17;
}

/* Keep the pixel font off the settings surface (it portals to <body> and
   would make the sheet unreadable). Scope it to the controller shell so the
   controls keep the retro identity but settings stay in the base font. */
html[data-skin="retro"] .controller-shell {
  font-family: "Press Start 2P", ui-monospace, monospace;
}

html[data-skin="retro"] body,
html[data-skin="retro"] .controller-shell {
  background: #10111c;
}

html[data-skin="retro"] .controller-frame {
  background:
    repeating-linear-gradient(
      to bottom,
      rgb(13 14 23 / 0.14) 0px,
      rgb(13 14 23 / 0.14) 1px,
      transparent 1px,
      transparent 3px
    ),
    #2b2250;
}

html[data-skin="retro"] .controller-name,
html[data-skin="retro"] .controller-slot {
  color: #f4f4f4;
  text-shadow: 2px 2px 0 var(--line);
}

html[data-skin="retro"] .controller-status {
  border: 3px solid var(--line);
  border-radius: 0;
  background: #293049;
  color: #f4f4f4;
  box-shadow: 3px 3px 0 var(--line);
}

html[data-skin="retro"] .controller-control {
  border: 3px solid var(--line);
  border-radius: 6px;
  color: #f4f4f4;
  text-shadow: 2px 2px 0 var(--line);
  background: #5d6285;
  box-shadow: 4px 4px 0 var(--line);
  transition:
    transform 70ms steps(2, end),
    box-shadow 70ms steps(2, end),
    background-color 70ms steps(2, end);
}

/* NES-flavored face colors */
html[data-skin="retro"] [data-command="south"] {
  background: #38b764;
}
html[data-skin="retro"] [data-command="east"] {
  background: #eb4b3c;
}
html[data-skin="retro"] [data-command="west"] {
  background: #41a6f6;
}
html[data-skin="retro"] [data-command="north"] {
  background: #ef7d57;
}

html[data-skin="retro"]
  .controller-control:not(.control-joystick):not(.controller-dpad).is-pressed {
  transform: translate(4px, 4px);
  box-shadow: none;
  filter: brightness(1.15);
}

html[data-skin="retro"] .control-joystick {
  border: 3px solid var(--line);
  background: #33364f;
  box-shadow: inset 3px 3px 0 rgb(13 14 23 / 0.6);
}

html[data-skin="retro"] .control-joystick::after {
  width: 48%;
  height: 48%;
  border: 3px solid var(--line);
  border-radius: 6px;
  background: #ffcd75;
  box-shadow: 3px 3px 0 var(--line);
}

html[data-skin="retro"] .control-joystick.is-dragging::after {
  transform: translate(-50%, -50%) scale(0.94);
  box-shadow: none;
  filter: brightness(1.12);
}

html[data-skin="retro"] .dpad-direction {
  border: 3px solid var(--line);
  border-radius: 4px;
  background: #5d6285;
  box-shadow: 4px 4px 0 var(--line);
  color: rgb(244 244 244 / 0.9);
  transition:
    transform 70ms steps(2, end),
    box-shadow 70ms steps(2, end),
    color 70ms steps(2, end),
    filter 70ms steps(2, end);
}

html[data-skin="retro"] .controller-dpad[data-direction="up"] .dpad-up,
html[data-skin="retro"] .controller-dpad[data-direction="right"] .dpad-right,
html[data-skin="retro"] .controller-dpad[data-direction="down"] .dpad-down,
html[data-skin="retro"] .controller-dpad[data-direction="left"] .dpad-left {
  color: var(--skin-accent);
}

html[data-skin="retro"] .icon-button {
  border: 3px solid var(--line);
  border-radius: 0;
  background: #5d6285;
  color: #f4f4f4;
  box-shadow: 3px 3px 0 var(--line);
  text-shadow: 2px 2px 0 var(--line);
}

html[data-skin="retro"] .icon-button:hover {
  filter: brightness(1.15);
}

html[data-skin="retro"] .settings-backdrop {
  background: rgb(0 0 0 / 55%);
}

html[data-skin="retro"] .settings-sheet {
  border: 3px solid var(--line);
  border-radius: 0;
  background: #2b2250;
  color: #f4f4f4;
  text-shadow: 2px 2px 0 var(--line);
}

html[data-skin="retro"] .settings-row {
  color: #f4f4f4;
}

html[data-skin="retro"] .controller-layout-picker {
  border: 3px solid var(--line);
  border-radius: 0;
  background: #5d6285;
  color: #f4f4f4;
  text-shadow: 2px 2px 0 var(--line);
}

html[data-skin="retro"] .settings-value {
  color: var(--skin-accent);
}

html[data-skin="retro"] .settings-capabilities {
  color: rgb(244 244 244 / 0.6);
}

html[data-skin="retro"] .orientation-message {
  border: 3px solid var(--line);
  border-radius: 0;
  background: #2b2250;
  color: #f4f4f4;
  text-shadow: 2px 2px 0 var(--line);
}

/* Hitfill extends its parent touch area — it must never paint. The skin’s
   .controller-control rules (background/border/shadow) must not apply to it,
   so hide it outright. Pointer hits stay on the parent hit target. */
html[data-skin="retro"] .controller-control.hit-only {
  visibility: hidden;
}
`;export{e as default};