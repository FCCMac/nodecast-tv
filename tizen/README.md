# Nodecast TV - Tizen client

A sideloaded Samsung TV app for watching live channels from your own
nodecast-tv server, controlled entirely with the remote. Not published to
the Samsung app store - just built and installed onto your own TV(s).

**v1 scope:** live TV browsing (categories + channels), playback with
channel zapping, and favorites (shared with the web UI). **v1.1** adds an
EPG now/next guide (inline in the channel list, a details panel in browse,
and in the playing banner), channel search (an on-screen A-Z/0-9 grid, since
there's no in-app text field), a Recent category, and a previous-channel
toggle. No VOD or transcoding UI yet - see "Not included yet" below.

It talks to your existing server unmodified - nothing here changes any
server code. See "How it talks to the server" below for what that
requires from your network setup.

## One-time setup

Use **classic Tizen Studio** (not the "Tizen" VS Code extension the
Samsung site's Windows installer defaults to). Both exist; the VS Code
extension bundles a newer `tz`-based CLI that installed and signed
packages just fine here but got a mysterious `install failed[118012]`
from every TV we tried it against, on two independently-generated
certificates - never resolved. Classic Tizen Studio's older `tizen` CLI
worked immediately with the exact same TVs. If you already have the VS
Code extension installed, it's harmless to leave in place; nothing here
uses it.

1. Download **Tizen Studio** (not "Tizen SDK" - that's the newer one)
   from https://developer.tizen.org/development/tizen-studio/download,
   any recent `tizen-studio_6.x` build. Install to the default location
   (`C:\tizen-studio`).
2. During onboarding, pick the newest main SDK version offered (app
   compatibility comes from `config.xml`'s own `required_version`, not
   which SDK you build with) and check **TV Extensions-Tools** plus the
   **Certificate Extension** when offered.
3. The CLI is `C:\tizen-studio\tools\ide\bin\tizen.bat`, with `sdb.exe` at
   `C:\tizen-studio\tools\sdb.exe`. Put both on PATH:
   ```powershell
   $dirs = 'C:\tizen-studio\tools\ide\bin','C:\tizen-studio\tools'
   $cur = [Environment]::GetEnvironmentVariable('Path','User')
   [Environment]::SetEnvironmentVariable('Path', "$cur;$($dirs -join ';')", 'User')
   ```
   Open a **new** terminal after this, then confirm: `tizen version` /
   `sdb version`. (`deploy.ps1` also resolves `tizen.bat` by its default
   full path as a fallback, so it works even before a shell restart.)

### Put the TV into developer mode

1. On the TV: **Apps** -> type `12345` on the remote -> a hidden
   **Developer mode** menu appears.
2. Turn Developer mode **On**, enter this PC's IP address as the "Host
   PC IP", then restart the TV (hold the power button until it reboots -
   a soft close isn't enough).
   - If the TV's screen goes to sleep/screensaver, `sdb` can silently
     stop connecting even though the network port stays open - wake the
     screen if a previously-working connection suddenly stops.
3. Connect from this PC:
   ```powershell
   sdb connect <TV_IP>
   sdb devices   # should list the TV - note the exact id it prints
   ```

### Signing certificate

Check for an existing profile first:
```powershell
tizen security-profiles list
```
If it shows an active profile (this project assumes one named `nodecast`),
you're done; skip to "Deploying to the TV" below. Otherwise, create one
via Tizen Studio's **Certificate Manager** (Samsung account login
required), **Public** privilege level, with the DUID of every TV you want
to install on. Get a connected TV's DUID with:
```powershell
sdb shell 0 getduid
```
Name the profile `nodecast`, or pass your own name to
`deploy.ps1 -SigningProfile <name>`. To add another TV later, re-open
Certificate Manager, edit the profile, and add its DUID - this
re-signs in place, no need to start over.

## How it talks to the server

The app is a separate origin from your server (it's not served by
nodecast-tv itself), so its `fetch()` calls to `/api/*` need cross-origin
access to be allowed:

- **Expected to just work.** `config.xml` declares
  `<access origin="*" subdomains="true"/>`, which is Tizen's own
  cross-origin allowlist for packaged widgets - it normally exempts the
  app from the same-origin check that a regular website would hit.
- **Streams and images need nothing.** AVPlay isn't subject to CORS, and
  `/api/proxy/image` already sends `Access-Control-Allow-Origin: *`.
- **If login or favorites fail with a network/CORS-looking error**
  once installed: put a small CORS-adding reverse proxy (e.g. Caddy) in
  front of your nodecast-tv container and point this app at the proxy's
  port instead. This repo's server code is intentionally left unchanged;
  ask for the few lines of Caddy config if you hit this.

## Dev loop (desktop Chrome, no TV needed)

Most of the UI can be built and tested in a browser - when
`webapis.avplay` isn't present, `js/player.js` automatically falls back
to a plain `<video>` + hls.js for playback, and the keyboard maps to the
same actions as the remote (arrows, Enter, Backspace/Esc = Back,
PageUp/PageDown = channel, r/g/y/b = the colour keys).

```powershell
npx http-server tizen -p 8080 -c-1
```

Then open Chrome with web security disabled (only for this throwaway
profile - it's what lets a `file://`-style dev server call an arbitrary
server URL without hitting CORS, mimicking the TV's allowlist):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --disable-web-security `
  --user-data-dir="$env:TEMP\chrome-dev-nodecast" `
  http://localhost:8080
```

## Deploying to the TV

```powershell
cd tizen
.\deploy.ps1 -Device <id from 'sdb devices'>
```

This runs `tizen build-web`, `tizen package -t wgt -s nodecast`, `tizen
install`, then `tizen run`. Re-run it after any change - there's no live
reload on the device.

The installed app shows up under the TV's **Apps** row as "Nodecast-TV"
(no space - a space in `config.xml`'s `<name>` breaks classic `tizen`'s
install step with an unrelated-looking Java `NullPointerException`, so
keep this field space-free if you ever rename it).

If install fails with `install failed[118012]` (a signature/cert-chain
error) on a *specific* TV but works on others with the same cert, that TV
itself has a fault outside anything fixable here (confirmed on this
project: identical package + identical cert installed fine on one TV,
and failed identically - even after two from-scratch cert regenerations
across two different toolchains - on another). Try a different TV before
assuming the cert or app is at fault.

## Debugging on the device

With the app running on the TV:

```powershell
sdb connect <TV_IP>
tizen run -p NdCstTV001.NodecastTV -s <device>   # if not already running
```

Tizen Studio's **Web Inspector** (or `chrome://inspect` pointed at the
device's debug port - check Tizen Studio's Device Manager for the
current port) is meant to give full Chrome DevTools: console, network,
and `webapis`/AVPlay errors logged by `player.js`. **Untested on the two
TVs used to build this** - both report `log_enable:disabled` and
`appcmd_support:disabled` in `sdb capability`, which blocks the raw
`sdb shell`-based routes (`dlogutil`, `shell 0 debug <appid>`) that would
otherwise get you there without the IDE. If Web Inspector via the GUI
doesn't work either on your TV, you're debugging by reading the code
carefully instead - see "Known quirks" below for the two bugs that were
found that way.

## Known quirks

Non-obvious things already hit once - documented here so they don't get
re-broken or re-debugged from scratch:

- **Keep `<name>` in `config.xml` space-free.** See "Deploying to the
  TV" above - classic `tizen install` fails on a spaced package filename
  with an unrelated-looking Java error.
- **Never make `#dev-video` visible on the TV.** It's the desktop-only
  `<video>` fallback element, still present in the same `index.html` used
  on the TV. It sits at the same z-index as `#av-player`, later in
  document order, with an opaque background - left visible, it paints
  directly over the AVPlay video hole-punch region. Symptom was exactly
  audio + closed captions working with no video at all, on every channel
  (see `js/player.js`'s `Player.init()` for the fix and fuller
  explanation - it's `display: none` whenever `isTv` is true).
- **Closed captions default to off** (`webapis.avplay.setSilentSubtitle(true)`
  in `player.js`) since there's no in-app toggle yet. If you add one, it
  needs a remote-key binding (e.g. a colour key) in `playing.js`.

## Remote control reference

| Action | Remote key | Desktop key |
|---|---|---|
| Move focus | Arrows | Arrows |
| Select / play | Enter (OK) | Enter |
| Back | Back | Esc / Backspace |
| Switch source | Enter on "Source: ..." row | same |
| Toggle favorite | Yellow | `y` |
| Zap channel | Up/Down (while playing), Channel Up/Down | PageUp/PageDown |
| Show info banner | Enter (while playing) | Enter |
| Search | Blue (from browse or playing) | `b` |
| Previous channel | Green, or the remote's dedicated PRE-CH key (while playing) | `g` or `p` |

The categories column in browse also has **Search** and **Recent** rows
above Favorites - Recent lists your last 20 channels per source, newest
first.

## Not included yet

Movies/series (VOD), the server's transcode fallback for codecs AVPlay
can't decode natively, a full cable-style time-grid EPG (now/next is
covered - see above), number-key channel entry, multi-user account
switching, and a remote-key toggle for closed captions (currently always
off - see "Known quirks"). All deferred from the original plan to keep
v1 small; ask if you want any of these added next.
