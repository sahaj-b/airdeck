# Lingo

- **Host:** The Linux machine running airdeck. It serves clients and creates native virtual controller devices.
- **Client:** A phone browser or future native client connected to the host.
- **Session:** One running airdeck instance that admits clients and owns their player assignments.
- **Player slot:** A host-managed assignment that binds one admitted player to one virtual controller.
- **Input state:** The complete current Xbox-style controller state for one player, including two stick axes, two analog triggers, semantic face directions, shoulder buttons, stick clicks, D-pad directions, Start, Back, and Guide/Home.
- **Semantic command:** A profile-independent logical control name such as `south`, `leftStick`, or `rightTrigger`. A visual label or native device bit is a separate mapping.
- **Standard layout control:** A validated `LayoutDocument` control of type button, D-pad, joystick, trigger, label, or image. It cannot execute arbitrary code or define a new protocol command.
- **Virtual controller:** A Linux input device created by airdeck through `uinput` and exposed to games as a real controller.
- **Session code:** A random four-digit numeric code generated for one running session. QR joins carry it in the URL; manually typed base URLs ask the client to enter it. It is a lightweight LAN room guard, not strong authentication.
- **Display name:** An optional player label shown in the host roster. If absent, the host generates a slot-based fallback such as `Player 1`.
- **Slot accent:** A stable accessible color assigned from the player's slot. It supports scanning but never replaces the slot number or display name.
- **Advertised URL:** The host-selected LAN URL shown to users and encoded in the QR code. It may differ from the address on which the server listens. QR joins use `/join?code=...`; the base URL opens the code prompt.
- **LayoutDocument:** A versioned JSON document that defines the visual controls, logical commands, ordered sections, and responsive geometry for one phone controller layout. Sections carry aspect ratios, flex constraints, padding, and protected status. Control positions are centered offsets from a section's content area, sized as fractions of viewport height, so shapes never stretch with screen aspect. Geometry is always center-pivoted.
- **Layout resolver:** The phone-side pure function that turns a `LayoutDocument` plus a viewport size into resolved pixel rectangles for sections and controls. Left and right sections are fixed edge-pinned slices, center fills all remaining width. The resolver handles center-first shrinking on compact screens, protected side sections, and pure WYSIWYG hit bounds (hit equals visual). Independent from DOM styling.
- **Responsive section:** An ordered composition slice with an aspect ratio, minimum and maximum widths, flex grow/shrink weights, padding, and a protected flag. Sections are resolved left-to-right with no inter-section gaps and no outer margins. Left and right pin to viewport edges, center expands to fill. The center section shrinks first on compact screens; protected side sections keep their authored width until all flexible shrink is exhausted.
- **Visual bounds:** The rendered pixel rectangle of a control, matching the authored geometry.
- **Hit bounds:** Equal to visual bounds. Touch input uses the same rect as rendering. Use a larger authored size to get a larger hit area.
- **Hit-only control:** A `LayoutDocument` control flagged `hitOnly`. It renders an invisible touch hit target that routes touches to a binding, filling gaps between visible controls (for example between face buttons). Hit equals visual, so the authored size must already cover the desired gap area.
- **Layout renderer:** The phone-side code that turns a `LayoutDocument` into interactive controls. QRController's `FlexController` is a reference for this layer.
- **Layout editor:** The future admin tool that modifies a `LayoutDocument`. It is separate from the runtime renderer.
- **Orientation override:** An optional portrait or landscape geometry override for a control in the same `LayoutDocument`, replacing the base geometry for that orientation. It cannot change the control's logical command.
- **Runtime chrome:** The player name, connection status, settings gear, and fullscreen control that appear above the controller. Runtime chrome lives inside the responsive composition (not in a separate viewport row) and participates in the center section's layout.
- **Landscape-first:** The phone controller's primary layout posture. Portrait remains usable through a compact fallback or guidance state.
- **Input watchdog:** A host-side timer that neutralizes a player's virtual controller after valid input snapshots stop arriving. It prevents a stale network state from holding buttons or axes forever.
- **Client-normalized axes:** Input axes transformed by the client for its source, deadzone, sensitivity, calibration, and canonical sign before transmission. The host validates but does not apply a second hidden transform.
- **Gyro source:** Phone tilt sensed via DeviceMotion/DeviceOrientation, normalized to stick axes on the client after calibration, deadzone, and sensitivity. Host sees only the final stick values.
- **Tilt Steer:** Gyro mode where phone roll maps to a single stick axis (X only, Y forced neutral). For driving/steering.
- **Tilt Aim:** Gyro mode where phone roll maps to stick X and phone pitch maps to stick Y. For camera/aim.
- **Calibrated neutral:** The captured tilt angles at calibration time that become 0 output. Recalibrated on enable and on demand.

# ADRs

## Snapshot-based input state

Airdeck uses complete input-state snapshots with monotonic sequence numbers instead of treating button events as the source of truth. The host keeps the latest state and applies a neutral input watchdog after 200 ms without a valid snapshot. Clients target 60 complete snapshots per second and send an immediate complete snapshot on meaningful state changes. Any rate override is startup configuration only, not a live dashboard setting. This makes disconnects, packet loss, browser backgrounding, and future client implementations recoverable without relying on a missing release event.

## Measure latency, do not invent it

Production input frames remain fixed at 20 bytes and carry no diagnostic timestamp. A separate debug trace correlates client monotonic time, host receive time, and uinput-write time; the application heartbeat supplies RTT and clock-offset data for that trace.

Airdeck must instrument client-send-to-uinput timing, stale frames, watchdog timing, and resource use at 1, 8, and 16 players. V1 deliberately has no fixed numeric latency promise because Wi-Fi, phone scheduling, and game-frame timing vary by setup.

## Single client handshake

A phone opens one WebSocket, sends one JSON `hello`, and receives one `welcome` before input. The handshake binds session code, client identity, reconnect generation, capabilities, selected layout, and binary protocol version. Afterward, binary frames carry input and JSON frames carry low-rate control.

## Application heartbeat

The host sends a low-rate JSON ping every 1 second and the client replies with a matching pong. RTT is a diagnostic measurement of the application path, not an end-to-end game-to-actuator latency claim. Heartbeats do not replace the input watchdog or carry controller state.

## Canonical digital bitmask

Airdeck uses stable W3C-style semantic bits in the v1 digital mask: face directions 0–3, D-pad 4–7, shoulders 8–9, stick clicks 10–11, Start/Back 12–13, and Guide 14. Native Xbox labels and Linux codes are adapter mappings, not wire meanings.

## Connection generations and frame order

Each client connection has a generation. The host accepts the first valid snapshot for a new generation, then applies unsigned monotonic sequence ordering and rejects stale or duplicate frames. A reconnect invalidates the old connection so an abandoned tab cannot keep driving the slot.

## Versioned binary input frame

Airdeck's v1 input frame is 20 bytes: version `u8`, flags `u8`, sequence `u32` little-endian, digital-button bitset `u32` little-endian, four signed `i16` axes, and two `u8` triggers. The per-player WebSocket supplies identity, so frames do not repeat player IDs. The layout and command schema remain independent of this wire representation.

## Raw WebSocket for LAN transport

Airdeck uses a raw WebSocket connection for browser-to-host LAN communication in v1. Each phone has one connection for control and input. JSON text frames carry low-rate session and control messages. Binary frames carry high-rate complete input snapshots. We chose this over Socket.IO, WebRTC, and WebTransport because direct LAN browser support and a small failure surface matter more than transport features we have not measured as necessary. The connection layer must allow a later control/input/media split without changing the player or session contract.

## Go host in one process

The Linux host will run as one Go process that owns the web server, session state, transport, input routing, and virtual-device lifecycle. We chose Go because the project owner already knows it, it can ship as a single binary, and the input workload does not need Rust's extra language complexity. The virtual-controller layer is a custom internal package (see the custom uinput package ADR). Keeping the systems in one process avoids a second daemon and IPC failure mode.

## Persistent configuration versus session state

Host preferences live in versioned `$XDG_CONFIG_HOME/airdeck/config.json`; CLI flags can override them for one run. Layout documents remain separate files under `layouts/`. No database or environment-only configuration is required.

Versioned host configuration persists preferences, while session codes, player assignments, reconnect generations, diagnostics, and virtual devices exist only inside one process session. Client storage may keep convenience preferences, but reconnect identities expire with the session.

## One session per host process

Each `airdeck serve` process owns one active session. The session starts with the process, ends when it stops, and does not survive restart. A new-session action rotates the session code and clears player ownership rather than carrying stale state across sessions.

## Standalone host lifecycle

V1 runs as a standalone CLI process with `doctor`, `setup`, and `serve` commands. A desktop wrapper and required systemd integration are deferred. Normal signals trigger neutralization and device cleanup, while startup diagnostics identify any leftover airdeck-owned devices or permissions problems.

## Rootless host process

Airdeck uses a privileged setup step for uinput/udev configuration, then runs the host as the normal user. The serving process must not require root. Diagnostics must identify missing kernel modules, permissions, or device capability failures instead of hiding them.

## x86_64 Linux baseline

V1 targets x86_64 Linux with the `uinput` kernel interface and is tested on the project owner's Arch Linux system. Broader distro, init-system, immutable-image, and ARM support is an expansion decision, not a v1 promise.

## Generic controller contract

Airdeck stops at the Linux virtual-controller boundary. Steamworks, Steam Input configuration, launcher detection, and game launching are outside the host contract. If Steam changes how it wraps a generic controller, that is not a reason to add Steam branches to airdeck.

Airdeck exposes generic Xbox 360-style virtual controllers. Representative games are test fixtures only. The host must not branch on game names, launchers, or process identities to make individual titles work.

## Custom internal uinput package

Airdeck creates its virtual controllers through `internal/uinput`, a custom zero-dependency package written against the raw `/dev/uinput` ioctl ABI, instead of consuming a third-party Go uinput library.

No evaluated library satisfied the requirements together:

- The ThomasT75/uinput fork is the only Go library with a working force-feedback upload handshake, but it never reads `EV_FF` playback events, so a game's actual rumble start/stop can never reach airdeck. Its FF handling is also poll-by-callback rather than event-driven.
- jbdemonte/virtual-device advertises force feedback in its README but contains no `UI_SET_FFBIT` usage; the claim covers only a theoretical escape hatch.
- bendahl/uinput and go-uinput open the device `O_WRONLY`, which structurally cannot receive rumble requests back from the kernel, and their per-event float APIs do not match airdeck's snapshot protocol.

The package's API is shaped 1:1 after the v1 wire frame: one `State` struct holding the canonical button bitset, four i16 stick axes, and two u8 triggers. The device diffs each snapshot against the previous one and writes only changed events plus a single SYN report, which keeps the 200 ms watchdog neutralization free when state has not changed. Devices open `O_RDWR` and register `FF_RUMBLE`; an internal poll loop completes the kernel's `UI_BEGIN_FF_UPLOAD`/`UI_END_FF_UPLOAD` handshake (echoing the request ID) and forwards playback magnitudes to a host callback. Struct sizes are pinned at init so kernel-ABI drift fails loudly instead of silently deadlocking rumble.

Consequences: airdeck owns the low-level ABI code and must re-verify it if the kernel interface ever changes; the verified reference flow lives in `internal/uinput/probe`. Rootless operation still depends on `airdeck setup` installing proper udev permissions for `/dev/uinput`.

# Slot-bound device lifecycle

A virtual Xbox-style device is created when a client receives a player slot, not lazily on the first input and not for unused slots at host startup. The device remains bound to that slot through reconnect grace and is destroyed after leave, kick, or grace expiry.

## Xbox-style virtual controller baseline

Airdeck's v1 native device identity is one stable Xbox 360-style virtual controller per player slot. Phone visual layouts and host device profiles are separate concepts. Alternate Linux controller identities require real compatibility evidence before they enter the product.

## Neutral state on hidden clients

A client resets to neutral on `visibilitychange`/`pagehide` and sends a best-effort neutral snapshot. The host watchdog remains authoritative if the frame cannot arrive. The slot stays reserved during reconnect grace, but returning clients never restore stale held input.

## Reconnect grace for transient loss

A disconnected client is neutralized after the 200 ms input watchdog but keeps its player slot reserved for the configured grace period (default 5 seconds). A session-scoped reconnect ID can reclaim that slot. Explicit leave and host kick free the slot immediately. This prevents ordinary refreshes or short Wi-Fi gaps from reshuffling party seating without allowing abandoned clients to hold slots forever.

## Stable slot ownership without eviction

Airdeck assigns an admitted client to the lowest free player slot and lets the host move it later. It never evicts an active player to satisfy a new join. Slot reassignment neutralizes the old virtual controller before ownership changes, so a late join cannot steal a friend's controller.

## Slot-device transaction lock

The host serializes input application with slot-lifecycle operations behind one session lock. Applying a frame to a slot's virtual controller and mutating that slot's ownership (admission, kick, leave, move, grace expiry) cannot interleave: a player's input always lands on the device it was bound to at apply time, teardown never races an in-flight write, and a move can destroy the old device and create the destination without ever exceeding 16 devices. Lock ordering is always lifecycle-then-state, so the design cannot deadlock.

The cost is a single contention point. All 16 players' frame application, up to 960 serialized writes per second, and every device creation or destruction wait on the same lock, so a slow uinput write or a join/kick/move stalls every other player for its duration. Per-frame writes are sub-millisecond and lifecycle operations are rare, so this is a capacity ceiling rather than a v1 defect. The 1, 8, and 16-player LAN benchmark is the acceptance gate: if p99 latency spikes correlate with joins or kicks, replace the global lock with per-slot locks or atomic player-to-device pointers that tolerate apply-after-destroy, without changing the player or session contract.

## Host-owned layout library

Built-in `LayoutDocument` files ship with the frontend assets. User documents live under `$XDG_CONFIG_HOME/airdeck/layouts`, are validated by the host, and are distributed to clients by session. Browser storage may remember a selected preset ID but is not the source of truth. New players receive the host's default, but each player may select another available document without changing other players. Future editor-created documents remain host-owned and are distributed by the session rather than copied manually between phones.

## Responsive layout contract

A `LayoutDocument` contains ordered sections, each with an aspect ratio, minimum and maximum widths, flex grow/shrink weights, padding, and a protected flag. Sections are resolved left-to-right with no gaps and no outer margins. Left and right sections are fixed edge-pinned (flexGrow 0, maxWidth equals aspectRatio) and only shrink on ultra-compact screens. Center has flexGrow 1 and a large maxWidth, so it fills all remaining width between the sides.

Control geometry uses center-pivoted positions and sizes as fractions of viewport height. A control must not have an x-position based on section width while its width silently uses section height without the contract making that relationship explicit.

The phone runtime applies a responsive resolver that computes section widths and control positions from the `LayoutDocument` and the current viewport. The resolver is a pure function independent from DOM styling. Responsive composition is generated by the resolver, not stored as a second layout document.

## Visual bounds and touch hit bounds

The renderer uses WYSIWYG hit bounds: visual geometry and touch hit geometry are the same rect. A larger authored size is the only way to get a larger hit area. A single CSS minimum-size rule does not silently change the visible control size. A control may be marked `hitOnly` to expose an invisible hit target that fills gaps between visible controls. The authored size already covers the desired gap area.

## Split frontend surfaces

Airdeck uses React for the low-rate host dashboard and vanilla TypeScript modules for the high-frequency phone controller runtime. The surfaces share typed data contracts, not rendering components. The v1.5 editor may use React and `interact.js` without adding either dependency to the phone play bundle.

## Lazy React islands for phone settings

Phone controller settings are lazy React islands inside the vanilla join app: the initial join entry contains no React. A `zustand/vanilla` store (`airdeck.settings.v1`, `version:1`) holds all low-frequency config (including future gyro calibration) and is shared between the vanilla core and the island via `getState()/subscribe` vs `useStore`. The island mounts on gear click via `await import('./settings-island')` -> `createRoot(host).render(<SettingsPanel/>)` and unmounts on close. This keeps the 60hz input path (pointer/gyro -> InputStateStore -> FrameSender -> ws + direct --axis-x/y thumb updates) free of React reconciliation, while allowing shadcn/radix UI for complex sheets. Manual vendor chunking keeps `react|react-dom|scheduler` together (Vite #12209/#17653).

## Validated layout documents

The host sends a complete validated `LayoutDocument` over the client's low-rate JSON channel after the handshake and on later layout changes. Clients do not reconstruct a layout through per-asset requests or execute arbitrary document content.

`LayoutDocument` has a standalone JSON Schema and a schema version. The host validates documents before serving them, and clients validate them before rendering. Validators may use different language libraries, but they must enforce the same control, command, geometry, asset, and ID rules.

## Data-first layout contract

A versioned JSON `LayoutDocument` is the source of truth for controller layouts. The phone runtime renders it, presets ship as documents, and the v1.5 editor modifies the same documents. Runtime layout math and editor drag/resize interactions remain separate, so a future editor library cannot dictate the phone play renderer.

## Touch reliability baseline

Airdeck treats target sizing, safe areas, pointer cancellation, labels, non-color pressed states, and reduced motion as touch reliability requirements. It does not promise formal WCAG certification or complete screen-reader gameplay support in v1.

## Immediate local feedback

Phone press feedback is local and immediate. Visual pressed states and browser vibration are enabled by default where available. Button-press vibration is a configurable duration (default 40 ms, 0 disables it) and is independent from the game-rumble toggle, because a held game rumble owns the single vibration channel and a press buzz would truncate it. Optional WebAudio click sounds are disabled by default. Feedback capability failures never block input and never wait on the host round trip.

## Best-effort screen capabilities

The Join gesture may request fullscreen, Screen Wake Lock, and landscape orientation lock. Android browsers may support these together. iOS Safari may reject fullscreen and orientation lock. Wake Lock must be reacquired after visibility changes where supported. Capability failure never blocks input.

## Touch-first client boundary

V1's phone client accepts touch input only. Physical browser Gamepad API, desktop keyboard, and mouse sources remain future clients. The host protocol stays client-agnostic so adding them later does not change player/session ownership.

## Browser-first delivery

The required phone client is a normal web page. PWA installation, service-worker caching, fullscreen enforcement, and native shells must remain optional additions and cannot be required for a session.

## Browser baseline and capability feedback

Android Chrome and iOS Safari are airdeck's required v1 phone clients for touch input. Browser haptics are optional capability feedback, because vibration support differs by browser and operating system. The client must report unsupported haptics without blocking input, and a future native Android client must use the same host session and input contract.

## Dashboard-owned QR

The dashboard generates the QR from the current advertised `/join?code=...` URL and renders it as SVG. The QR is a presentation of session state, not a separate join mechanism.

## LAN binding and advertised URL

Airdeck listens on `0.0.0.0:6969` unless the host selects a specific interface/address. If the port is occupied, the host tries the next port. The dashboard controls the advertised URL independently, because a machine may have several reachable interfaces and the listening address is not always the address friends should use.

## Local-only host administration

Airdeck keeps host administration on loopback by default. The LAN listener serves the phone client, while dashboard APIs and the admin WebSocket reject non-loopback clients. This avoids adding admin credentials to the party flow and prevents a joined phone from controlling the host.

## Same-origin LAN client boundary

Browser clients must connect from the host-served origin. Origin-less future native clients must still complete the session handshake. Airdeck does not add broad CORS, TLS certificates, accounts, or internet-grade authentication to the private LAN v1 path.

## Lightweight LAN admission

Airdeck trusts the user-controlled LAN or hotspot for v1. It uses a short session code as a lightweight guard against accidental or prank joins, not as strong authentication. QR URLs include the code, while manually typed base URLs prompt for it. The product does not add accounts, persistent passwords, cryptographic join challenges, or mandatory approval for the first release.

## Lazy-loaded controller skins

Phone controller themes are named skins that overlay `data-skin` CSS without changing the layout or input contract. Each skin lives as a standalone `web/src/skins/*.css` file. The join client loads only the active skin via a dynamic `import('./<skin>.css?raw')` which Vite splits into a separate chunk. `web/src/skins/loader.ts` caches the fetched text in memory, injects it into a single `<style id="airdeck-skin">` element, and toggles `document.documentElement[data-skin]`. `web/src/skins/index.ts` exposes the skin registry and `loadSkinCSS` with a per-ID loader map. The active choice persists in `localStorage` under `airdeck.skin` with `airdeck` as the default. Previously all nine skins were statically imported and bundled into the join entry. Lazy loading keeps the initial join payload small and makes skin switches instant after the first fetch.

# Decisions

- The host architecture must keep the client protocol independent of whether the client is a browser or a future native app.
- Native device creation and network/session management share one host process in the first architecture.
- V1 UI copy is English only. Airdeck does not carry a localization framework or language packs for this private tool.
- Airdeck has no external telemetry, analytics, crash upload, account, or cloud-service dependency. Diagnostics stay local.

# TBD

- The exact frontend build tooling and Go asset-embedding method.
- Broader Linux distributions, architectures, and permission setup beyond the tested Arch x86_64 baseline.
- The exact maximum supported player count beyond the v1 ceiling of 16.
- Future binary protocol extensions beyond the v1 20-byte input frame.
- Whether the v1.5 editor needs extra interaction primitives beyond the selected `interact.js` drag/resize layer.
- Whether v2 needs individual slot locks or an approval queue beyond the v1 global accepting-joins toggle.
