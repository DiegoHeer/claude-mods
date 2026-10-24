# Mobile checks

Mobile apps have no deploy here. Build the app at the merge commit and run it on an
emulator or simulator. `--deploy` does not apply to mobile.

Start the device, install dependencies and build only after the user approves the
proposal. The proposal lists them as step 0. Read-only lookups before that are fine
(`emulator -list-avds`, `xcrun simctl list`).

## Start the device

Start it first: most run commands install onto a running device.

Android:

```bash
emulator -list-avds
```

Start the emulator as a background command (Bash `run_in_background`), not with `&`:
a plain `&` keeps the tool call open. Then wait for boot with a time limit:

```bash
emulator -avd <name> -no-snapshot-save   # background command
timeout 300 adb wait-for-device
timeout 300 sh -c 'until [ "$(adb shell getprop sys.boot_completed | tr -d "\r")" = 1 ]; do sleep 2; done'
```

Not booted after 5 minutes (no KVM, broken image): stop the emulator and put the checks
on the manual list.

iOS (macOS only):

```bash
xcrun simctl list devices available
xcrun simctl boot <udid>
```

If no emulator or simulator exists, give the user the setup command and put the checks on
the manual list.

## Build at the merge commit

Build from a clean checkout of the merge commit, not from the working tree:

```bash
git fetch origin
git worktree add <tmp-dir> <merge-sha>
```

A new worktree has no gitignored config (`.env`, `.env.*`, `google-services.json`,
`GoogleService-Info.plist`). Copy the ones the app needs from the main checkout into the
worktree. Do not print their contents.

Install dependencies there with the package manager its lockfile shows
(`package-lock.json` → npm, `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm, `bun.lock` →
bun). Build and install with the command the repo uses. Look in `package.json` scripts,
`eas.json`, the README and CI workflows:

- Expo: `npx expo run:android` / `npx expo run:ios`
- React Native CLI: `npx react-native run-android` / `run-ios`
- Native Android: `./gradlew installDebug`
- Native iOS: `xcodebuild` with the scheme from the README

The app talks to the backend set in its config (`.env`, `app.config.*`, build flavors).
Point it at the target environment only if the repo has a config for that. Before the
proposal, read the backend URL the build will use (only that key from the config, or the
default in `app.config.*` when there is none) and name it in the proposal's target line.

If that backend is production or unclear, only read-only checks run. Any tap or input
that saves data (submit, sign up, delete) goes to the manual list, unless the user says
the backend is a test environment.

Remove the worktree after the checks: `git worktree remove <tmp-dir>`.

## Reuse the repo's flows first

If a Maestro flow covers the changed screen, run it: `maestro test <flow>.yaml`.
Detox: `npx detox test -c <config> <test-file>`. Read the flow first: it is proof only if
it reaches the state the PR changed (for example the empty profile, not just the profile
screen). If it does not, drive that state yourself.

## Drive it yourself

Clear old logs before each check, so an old crash does not count: `adb logcat -c` on
Android. On iOS, note the time before the check and read logs from then on.

Android:

- `adb shell input tap <x> <y>`, `adb shell input text '<text>'`
- `adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml` to find elements
- `adb exec-out screencap -p > <file>.png` for proof
- `adb logcat -d | grep -iE 'fatal|exception|crash'` for crashes

iOS:

- `xcrun simctl install booted <app-path>`, `xcrun simctl launch booted <bundle-id>`
- `xcrun simctl io booted screenshot <file>.png`
- `xcrun simctl spawn booted log show --start '<YYYY-MM-DD HH:MM:SS>' --predicate 'process == "<app>"'`

To reach a state the PR is about (an empty list, a new user), use a test account or the
app's own reset only on a test backend. If you cannot reach it, the check is manual.

## Manual steps

When a check needs a real device (camera, push, payments, biometrics) or you cannot run
it, write it for the user like this:

> Make a preview build and install it on a device. Then: <exact steps>. Expected:
> <result>.
