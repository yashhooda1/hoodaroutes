import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

// ---- Configure your HoodaRoutes API host here ----
// The watch fetches routes from {BASE_URL}/api/garmin/routes?city=houston
// A sample Vercel endpoint is in /api/routes.js (ES module, matches your "type":"module").
(:glance)
const BASE_URL = "https://yashhooda.ai";

class HoodaRoutesApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Lang.Dictionary?) as Void {
    }

    function onStop(state as Lang.Dictionary?) as Void {
    }

    // First view: a loading screen that fires the web request, then
    // hands off to the route menu once data arrives.
    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        var view = new LoadingView();
        return [view, new LoadingDelegate()];
    }
}
