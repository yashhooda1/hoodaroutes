import Toybox.WatchUi;
import Toybox.Communications;
import Toybox.PersistedContent;
import Toybox.System;
import Toybox.Lang;

// Detail screen input: START -> pull this loop onto the watch as a real course,
// then hand off to Garmin's native navigation.
//
// HOW THIS WORKS (and why no Garmin account link is needed):
// Connect IQ can request a FIT file with :responseType =>
// HTTP_RESPONSE_CONTENT_TYPE_FIT. The system downloads it and files it into the
// device's own course list in the background — this app never handles the
// bytes. We then find it through PersistedContent.getAppCourses() and launch it
// with System.exitTo(course.toIntent()), which opens the built-in map and
// navigation with turn-by-turn and off-route alerts.
//
// The alternative is Garmin's Courses API, which pushes to the user's Garmin
// Connect account but requires Developer Program approval. This path works for
// every user today.
class RouteDetailDelegate extends WatchUi.BehaviorDelegate {

    var _r as Lang.Dictionary;
    var _busy as Lang.Boolean = false;

    function initialize(route as Lang.Dictionary) {
        BehaviorDelegate.initialize();
        _r = route;
    }

    // START button.
    function onSelect() as Lang.Boolean {
        if (_busy) { return true; }
        _busy = true;
        WatchUi.pushView(new StatusView("Loading course\u2026"),
                         new StatusDelegate(), WatchUi.SLIDE_UP);
        downloadCourse();
        return true;
    }

    function onBack() as Lang.Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }

    // Ask the server for this loop as FIT. Same seed as the list preview, so
    // what the watch navigates is exactly what was shown.
    function downloadCourse() as Void {
        var url = $.BASE_URL + "/api/garmin/course";
        var params = {
            "lat" => _r["lat"],
            "lng" => _r["lng"],
            "miles" => _r["reqMiles"],
            "profile" => _r["profile"],
            "seed" => _r["seed"],
            "format" => "fit"
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_FIT
        };
        Communications.makeWebRequest(url, params, options, method(:onCourseDownloaded));
    }

    function onCourseDownloaded(code as Lang.Number,
                                data as Lang.Object or Lang.Null) as Void {
        _busy = false;
        WatchUi.popView(WatchUi.SLIDE_DOWN);   // dismiss "Loading course…"

        if (code != 200) {
            WatchUi.pushView(new StatusView("Course failed (" + code.toString() + ")"),
                             new StatusDelegate(), WatchUi.SLIDE_UP);
            return;
        }

        var course = newestAppCourse();
        if (course == null) {
            // Downloaded but not enumerable from here. It is still saved on the
            // device, so send the user to the course list instead of failing.
            WatchUi.pushView(new StatusView("Saved \u2014 see Courses"),
                             new StatusDelegate(), WatchUi.SLIDE_UP);
            return;
        }

        var intent = course.toIntent();
        if (intent != null) {
            System.exitTo(intent);             // native navigation takes over
        } else {
            WatchUi.pushView(new StatusView("Saved \u2014 see Courses"),
                             new StatusDelegate(), WatchUi.SLIDE_UP);
        }
    }

    // The iterator gives no length and no ordering guarantee, so walk it and
    // keep the last entry — the course just downloaded.
    function newestAppCourse() as PersistedContent.Course or Lang.Null {
        var it = PersistedContent.getAppCourses();
        if (it == null) { return null; }
        var newest = null;
        var c = it.next();
        while (c != null) {
            newest = c;
            c = it.next();
        }
        return newest;
    }
}

// NavView input: BACK returns to detail.
class NavDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }
    function onBack() as Lang.Boolean {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
