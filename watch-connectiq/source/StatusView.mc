import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;

// A plain message screen — used while a course downloads, and to report the
// outcome. LoadingView can't serve this purpose: it kicks off GPS acquisition
// on show.
class StatusView extends WatchUi.View {

    var _msg as Lang.String;

    function initialize(msg as Lang.String) {
        View.initialize();
        _msg = msg;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(0xFF6B35, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 34, Graphics.FONT_SMALL, "HOODAROUTES",
                    Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy + 4, Graphics.FONT_TINY, _msg,
                    Graphics.TEXT_JUSTIFY_CENTER);
    }
}

// BACK dismisses a status screen.
class StatusDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }
    function onBack() as Lang.Boolean {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
