# HoodaRoutes for Apple Watch

A standalone watchOS app (no iPhone app needed) that does on Apple Watch what
`watch-connectiq/` does on Garmin — with one difference forced by the platform.

On Garmin, the app downloads a FIT course and hands off to the watch's native
navigation. watchOS has no equivalent: Apple's Workout app can't import a
route and there is no API to give it one. So this app does the navigating
itself: it draws the loop on a map, tracks you along it, buzzes when you leave
it, and records the run to Health (which is also what keeps it running with
your wrist down).

## What it does

1. Gets a GPS fix and asks `/api/garmin/routes` for loops from where you stand
   — same list the Garmin app shows, "Today" first when Strava is configured.
2. Tap a loop for its distance / climb / surface / fit and a map preview
   (`/api/garmin/course?format=json`).
3. **Start** begins an Outdoor Run (or Hike, for trail loops) workout:
   - **Map** — the loop, your position, heading-up. Miles to go at the top.
     The corner button flips between following you and the whole loop.
   - **Metrics** (swipe left) — time, distance, pace, heart rate, miles left.
   - **Controls** (swipe right) — pause / end.
4. Off the route for ~3 fixes → a haptic and a red "Off route · N m" banner,
   repeated every 30 s until you're back. A second haptic when you rejoin, and
   one when the loop is complete.
5. **End** saves the workout and its GPS track to Health, so it shows up in
   Fitness — and in Strava, if Strava's Health sync is on.

## Build

Needs a Mac with Xcode 15 or later; the app targets watchOS 10+.

**With XcodeGen** (the project file isn't committed):

```
brew install xcodegen
cd watch-apple
xcodegen
open HoodaRoutesWatch.xcodeproj
```

Then in Xcode: target **HoodaRoutes → Signing & Capabilities → Team**, pick
your team, choose your watch as the run destination, and Run.

**Without XcodeGen:** File → New → Project → watchOS → App, choose
**Watch-only App**, name it `HoodaRoutes`. Delete the generated
`ContentView.swift`, `HoodaRoutesApp.swift` and `Assets.xcassets`, then drag
the contents of `watch-apple/HoodaRoutes/` into the target. In build settings
point **Info.plist File** at `HoodaRoutes/Info.plist` (and turn *Generate
Info.plist File* off) and **Code Signing Entitlements** at
`HoodaRoutes/HoodaRoutes.entitlements`. That gives you HealthKit plus the
*Workout processing* and *Location updates* background modes.

The watch asks for Location and Health access the first time; both are needed.

## Configure

`HoodaRoutes/App/Config.swift`:

- `baseURL` — the `web/` deployment. Defaults to `https://routes.yashhooda.ai`.
- `goalRace` — a race id from `web/lib/race.js` to score fit against, or `nil`
  for the server default.

The web deployment must include the `format=json` course endpoint added
alongside this app — deploy `web/` before trying the watch.

## Layout

```
HoodaRoutes/
├─ App/        entry point, Config
├─ Model/      API models, CourseTracker (route matching), formatting
├─ Services/   API client, LocationProvider, RunModel (workout + tracking)
└─ Views/      route list, route detail, run pages + summary
```

`CourseTracker` is the interesting part: it matches fixes only near where you
already are on the course (a loop starts and ends at the same place, and often
runs both ways along one street), and debounces both leaving and rejoining.

## Known limits

- No turn-by-turn cues — the course is a line, not a list of turns.
- The map needs a data connection (cellular, or the paired iPhone nearby) to
  load tiles you haven't seen; tracking and alerts work without one.
- Route generation needs a connection too, so load the route before leaving
  coverage.
