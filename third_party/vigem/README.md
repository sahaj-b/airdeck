# ViGEmBus driver + client DLL (Windows host)

Airdeck's Windows host talks to the ViGEmBus driver through `ViGEmClient.dll`.
Both are third-party binaries pinned by version, exactly like the Linux host
depends on the kernel's uinput interface.

## Pinned version

- ViGEmBus 1.22.0 (MSI Burn bundle: `ViGEmBus_1.22.0_x64_x86_arm64.exe`)
- ViGEmClient matching 1.22.0 (`ViGEmClient.dll`, x64)

Download: https://github.com/nefarius/ViGEmBus/releases/tag/v1.22.0
and https://github.com/nefarius/ViGEmClient (see its releases for the
matching client build).

`airdeck setup` on Windows never hardcodes the installer filename. It globs
`Drivers\ViGEmBus_*.exe` beside `airdeck.exe`, so a future pinned bump only
changes what the release job downloads, not Go code.

## Release layout

```
dist-windows/
  airdeck.exe
  ViGEmClient.dll
  Drivers/
    ViGEmBus_1.22.0_x64_x86_arm64.exe
```

`setup` runs the installer silent (`/exenoui /qn /norestart`) elevated, then adds the
`netsh advfirewall` inbound rule for `airdeck.exe`. `doctor` probes bus
presence via `vigem_connect` and refuses `serve` when the bus is missing.

## Human verification

Before zipping a release, verify the expected SHA of both binaries against
the upstream release pages. Check the filename matches the `ViGEmBus_*.exe`
glob and the DLL loads with `doctor` on a real Windows box (Tier 2 manual).

## Why ViGEmBus

Only Windows path with true Xbox 360 identity parity (045e:028e),
bidirectional rumble, a production-signed Win10/11 driver, and
DS4Windows-scale proof. Archived-driver risk is accepted and isolated behind
`device.Factory` for a future VirtualPad swap.
