var e=`/* Console 3D — skeuomorphic Xbox-style plastic. Techniques: radial-gradient
   spheres lit top-left, layered drop+inset shadows, translateY press that
   eats the drop shadow, recessed wells for stick pockets. */

html[data-skin="console"] {
  --skin-accent: #9ade3b;
  --plastic-hi: #4a4f58;
  --plastic: #34383f;
  --plastic-lo: #212429;
  --well: #191b1f;
  --dpad-fill: #2f343c;
  --dpad-border: #15171b;
}

html[data-skin="console"] body,
html[data-skin="console"] .controller-shell {
  background: #0d0e11;
}

html[data-skin="console"] .controller-frame {
  border-radius: clamp(0.8rem, 3vw, 1.8rem);
  background: radial-gradient(
    120% 140% at 50% 30%,
    #2b2f36 0%,
    #1a1d22 55%,
    #13151a 100%
  );
}

html[data-skin="console"] .controller-name {
  color: #e8ebf0;
}

html[data-skin="console"] .controller-slot {
  color: var(--skin-accent);
}

html[data-skin="console"] .controller-control {
  border: 0;
  border-radius: 0.7rem;
  color: #dfe3ea;
  font-weight: 700;
  background: linear-gradient(
    180deg,
    var(--plastic-hi) 0%,
    var(--plastic) 45%,
    var(--plastic-lo) 100%
  );
  box-shadow:
    0 4px 8px rgb(0 0 0 / 0.55),
    0 1px 2px rgb(0 0 0 / 0.5),
    inset 0 1px 1px rgb(255 255 255 / 0.22),
    inset 0 -3px 5px rgb(0 0 0 / 0.4);
  transition:
    transform 90ms ease,
    box-shadow 90ms ease,
    filter 90ms ease;
}

/* face buttons: Xbox-360 style graphite spheres, colored letters */
html[data-skin="console"] [data-command="south"],
html[data-skin="console"] [data-command="east"],
html[data-skin="console"] [data-command="west"],
html[data-skin="console"] [data-command="north"] {
  border: 0;
  background: radial-gradient(
    circle at 32% 26%,
    #565c66 0%,
    var(--plastic) 48%,
    var(--plastic-lo) 100%
  );
  box-shadow:
    0 5px 10px rgb(0 0 0 / 0.6),
    inset 0 2px 2px rgb(255 255 255 / 0.28),
    inset 0 -5px 8px rgb(0 0 0 / 0.5);
}

html[data-skin="console"] [data-command="south"] {
  color: #92d13d;
  text-shadow: 0 -1px 1px rgb(0 0 0 / 0.6);
}
html[data-skin="console"] [data-command="east"] {
  color: #eb4a41;
  text-shadow: 0 -1px 1px rgb(0 0 0 / 0.6);
}
html[data-skin="console"] [data-command="west"] {
  color: #3f8eeb;
  text-shadow: 0 -1px 1px rgb(0 0 0 / 0.6);
}
html[data-skin="console"] [data-command="north"] {
  color: #f2c73b;
  text-shadow: 0 -1px 1px rgb(0 0 0 / 0.6);
}

/* press: travel down into the shadow */
html[data-skin="console"]
.controller-control:not(.control-joystick):not(.controller-dpad).is-pressed {
  transform: translateY(3px);
  filter: brightness(0.88);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.55),
    inset 0 3px 6px rgb(0 0 0 / 0.55),
    inset 0 -1px 1px rgb(255 255 255 / 0.08);
}

html[data-skin="console"] [data-command="south"].is-pressed,
html[data-skin="console"] [data-command="east"].is-pressed,
html[data-skin="console"] [data-command="west"].is-pressed,
html[data-skin="console"] [data-command="north"].is-pressed {
  background: radial-gradient(
    circle at 32% 40%,
    #3d424a 0%,
    #2a2d33 55%,
    #1d2025 100%
  );
}

/* triggers get a brushed-metal top lip */
html[data-skin="console"] .control-trigger {
  border-top: 1px solid rgb(255 255 255 / 0.25);
  background: linear-gradient(
    180deg,
    #565c66 0%,
    var(--plastic) 60%,
    var(--plastic-lo) 100%
  );
}

/* sticks: recessed well + rubber knob with grip ring */
html[data-skin="console"] .control-joystick {
  background: radial-gradient(circle at 50% 42%, var(--well) 0%, #101216 70%);
  box-shadow:
    inset 0 6px 12px rgb(0 0 0 / 0.75),
    inset 0 -2px 4px rgb(255 255 255 / 0.07),
    0 1px 1px rgb(255 255 255 / 0.12);
}

html[data-skin="console"] .control-joystick.is-active {
  box-shadow:
    inset 0 6px 12px rgb(0 0 0 / 0.75),
    inset 0 -2px 4px rgb(255 255 255 / 0.07),
    0 0 10px rgb(154 222 59 / 0.35);
}

html[data-skin="console"] .control-joystick::after {
  width: 56%;
  height: 56%;
  background: radial-gradient(
    circle at 34% 28%,
    #5a6069 0%,
    #33373d 55%,
    #1e2126 100%
  );
  border: 1px solid #101216;
  box-shadow:
    0 6px 12px rgb(0 0 0 / 0.65),
    inset 0 2px 2px rgb(255 255 255 / 0.25),
    inset 0 -4px 7px rgb(0 0 0 / 0.55),
    inset 0 0 0 4px rgb(0 0 0 / 0.18);
}

html[data-skin="console"] .control-joystick.is-dragging::after {
  filter: brightness(0.92);
  box-shadow:
    0 3px 6px rgb(0 0 0 / 0.6),
    inset 0 2px 3px rgb(0 0 0 / 0.5),
    inset 0 0 0 4px rgb(0 0 0 / 0.18);
}

/* d-pad: arms are transparent — single cross body on the center plate */
html[data-skin="console"] .controller-dpad::before {
  display: block;
  position: absolute;
  left: 30%;
  top: 30%;
  width: 40%;
  height: 40%;
  border: 1px solid var(--dpad-border);
  border-radius: 14%;
  background: var(--dpad-fill);
  content: "";
}

html[data-skin="console"] .dpad-direction {
  border: 0;
  background: transparent;
  color: #9aa2ad;
  transition:
    filter 80ms ease,
    color 80ms ease,
    transform 80ms ease;
}

html[data-skin="console"] .dpad-direction svg {
  width: 38%;
  height: 38%;
}

html[data-skin="console"] .controller-dpad[data-direction="up"] .dpad-up,
html[data-skin="console"] .controller-dpad[data-direction="right"] .dpad-right,
html[data-skin="console"] .controller-dpad[data-direction="down"] .dpad-down,
html[data-skin="console"] .controller-dpad[data-direction="left"] .dpad-left {
  transform: scale(0.94);
  filter: brightness(0.88);
  color: var(--skin-accent);
}

html[data-skin="console"] .controller-status {
  border: 1px solid #3a3f47;
  background: #22252b;
  color: #cfd5dd;
}

html[data-skin="console"] .icon-button {
  border: 1px solid #3a3f47;
  background: #22252b;
  color: #cfd5dd;
}

html[data-skin="console"] .icon-button:hover {
  border-color: var(--skin-accent);
  color: #e8ebf0;
}

html[data-skin="console"] .settings-backdrop {
  background: rgb(0 0 0 / 55%);
}

html[data-skin="console"] .settings-sheet {
  border: 1px solid #3a3f47;
  background: #1b1e23;
}

html[data-skin="console"] .settings-row {
  color: #cfd5dd;
}

html[data-skin="console"] .controller-layout-picker {
  border: 1px solid #3a3f47;
  background: #22252b;
  color: #e8ebf0;
}

html[data-skin="console"] .settings-value {
  color: var(--skin-accent);
}

html[data-skin="console"] .settings-capabilities {
  color: #7f8792;
}

html[data-skin="console"] .orientation-message {
  border: 1px solid #3a3f47;
  background: #1b1e23;
  color: #cfd5dd;
}

/* Hitfill extends its parent touch area — it must never paint. The skin’s
   .controller-control rules (background/border/shadow) must not apply to it,
   so hide it outright. Pointer hits stay on the parent hit target. */
html[data-skin="console"] .controller-control.hit-only {
  visibility: hidden;
}
`;export{e as default};