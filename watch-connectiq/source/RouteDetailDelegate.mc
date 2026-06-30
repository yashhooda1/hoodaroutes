import Toybox.WatchUi;
import Toybox.Communications;
import Toybox.Lang;

// Detail screen input: START -> request course export, then show NavView.
class RouteDetailDelegate extends WatchUi.BehaviorDelegate {

    var _r as Lang.Dictionary;

    function initialize(route as Lang.Dictionary) {
        BehaviorDelegate.initialize();
        _r = route;
    }

    // START button.
    function onSelect() as Lang.Boolean {
        exportCourse();
        WatchUi.pushView(new NavView(_r), new NavDelegate(), WatchUi.SLIDE_UP);
        return true;
    }

    function onBack() as Lang.Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }

    // Regenerate this loop and create it as a Course on the user's Garmin
    // account in one call. The FR970's native navigation then runs it
    // (turn-by-turn + off-route alerts).
    function exportCourse() as Void {
        var url = $.BASE_URL + "/api/garmin/push";
        var params = {
            "lat" => _r["lat"],
            "lng" => _r["lng"],
            "miles" => _r["reqMiles"],
            "profile" => _r["profile"],
            "seed" => _r["seed"]
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_TEXT_PLAIN
        };
        Communications.makeWebRequest(url, params, options, method(:onExport));
    }

    function onExport(code as Lang.Number, data as Lang.Dictionary or Lang.Null) as Void {
        // Fire-and-forget; NavView already shown. Hook telemetry here if wanted.
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
