import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Communications;
import Toybox.Position;
import Toybox.Lang;
import Toybox.System;

// Acquires the watch's GPS position, asks the HoodaRoutes API for loop options
// near that location (anywhere in the world), then switches to the route menu.
class LoadingView extends WatchUi.View {

    var _msg as Lang.String = "Acquiring GPS\u2026";
    var _requested as Lang.Boolean = false;

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        if (!_requested) {
            _requested = true;
            acquire();
        }
    }

    function acquire() as Void {
        var info = Position.getInfo();
        if (info != null && info.position != null
                && info.accuracy != Position.QUALITY_NOT_AVAILABLE) {
            var deg = info.position.toDegrees();   // [lat, lng]
            fire(deg[0], deg[1]);
        } else {
            Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
            WatchUi.requestUpdate();
        }
    }

    function onPosition(info as Position.Info) as Void {
        if (info != null && info.position != null) {
            Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
            var deg = info.position.toDegrees();
            fire(deg[0], deg[1]);
        }
    }

    function fire(lat as Lang.Double, lng as Lang.Double) as Void {
        _msg = "Finding routes\u2026";
        WatchUi.requestUpdate();
        var url = $.BASE_URL + "/api/garmin/routes";
        var params = {
            "lat" => lat.format("%.5f"),
            "lng" => lng.format("%.5f")
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => { "Accept" => "application/json" },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        Communications.makeWebRequest(url, params, options, method(:onReceive));
    }

    function onReceive(code as Lang.Number, data as Lang.Dictionary or Lang.Null) as Void {
        if (code == 200 && data != null && (data as Lang.Dictionary).hasKey("routes")) {
            var routes = (data as Lang.Dictionary)["routes"] as Lang.Array;
            if (routes.size() == 0) {
                _msg = "No routes here.\nTry an open area.";
                WatchUi.requestUpdate();
                return;
            }
            var menu = buildRouteMenu(routes);
            WatchUi.switchToView(menu, new RouteMenuDelegate(routes), WatchUi.SLIDE_IMMEDIATE);
        } else {
            _msg = "No connection.\nCheck phone + API host.";
            WatchUi.requestUpdate();
        }
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(0xFF6B35, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 34, Graphics.FONT_SMALL, "HOODAROUTES", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy + 4, Graphics.FONT_TINY, _msg, Graphics.TEXT_JUSTIFY_CENTER);
    }
}

// BACK exits the app from the loading screen.
class LoadingDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }
    function onBack() as Lang.Boolean {
        System.exit();
        return true;
    }
}

// Builds a Menu2 list of generated loop options near the device.
function buildRouteMenu(routes as Lang.Array) as WatchUi.Menu2 {
    var menu = new WatchUi.Menu2({ :title => "Routes near you" });
    for (var i = 0; i < routes.size(); i++) {
        var r = routes[i] as Lang.Dictionary;
        var sub = r["shade"].toString() + "   \u00B7   B-fit " + r["boulderFit"].toString();
        menu.addItem(new WatchUi.MenuItem(r["name"] as Lang.String, sub, i, null));
    }
    return menu;
}
