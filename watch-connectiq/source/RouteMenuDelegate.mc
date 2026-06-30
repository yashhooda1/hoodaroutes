import Toybox.WatchUi;
import Toybox.Lang;

// Handles selection in the generated-route list.
class RouteMenuDelegate extends WatchUi.Menu2InputDelegate {

    var _routes as Lang.Array;

    function initialize(routes as Lang.Array) {
        Menu2InputDelegate.initialize();
        _routes = routes;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var idx = item.getId() as Lang.Number;
        var route = _routes[idx] as Lang.Dictionary;
        WatchUi.pushView(
            new RouteDetailView(route),
            new RouteDetailDelegate(route),
            WatchUi.SLIDE_LEFT
        );
    }

    function onBack() as Void {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}
