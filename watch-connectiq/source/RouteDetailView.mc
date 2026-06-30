import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;

// Glanceable detail screen: big distance, elevation, shade, Boulderthon fit.
class RouteDetailView extends WatchUi.View {

    var _r as Lang.Dictionary;

    function initialize(route as Lang.Dictionary) {
        View.initialize();
        _r = route;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        // Route name
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.15, Graphics.FONT_SMALL, _r["name"] as Lang.String, Graphics.TEXT_JUSTIFY_CENTER);

        // Big distance number
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.30, Graphics.FONT_NUMBER_HOT, _r["miles"].toString(), Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0x8E948F, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.55, Graphics.FONT_XTINY, "MILES", Graphics.TEXT_JUSTIFY_CENTER);

        // Stat row: elevation | shade | boulderthon fit
        var fit = _r["boulderFit"] as Lang.Number;
        var fitColor = (fit >= 85) ? 0x36D29E : ((fit >= 75) ? 0xFF6B35 : 0xCCCCCC);
        var row = h * 0.70;

        dc.setColor(0x36D29E, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx - 72, row, Graphics.FONT_XTINY, "+" + _r["elevFt"].toString() + "ft", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0x8E948F, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, row, Graphics.FONT_XTINY, (_r["shade"] as Lang.String), Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(fitColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx + 72, row, Graphics.FONT_XTINY, "fit " + fit.toString(), Graphics.TEXT_JUSTIFY_CENTER);

        // Start hint
        dc.setColor(0x36D29E, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.85, Graphics.FONT_XTINY, "START \u25B6 navigate", Graphics.TEXT_JUSTIFY_CENTER);
    }
}

// Confirmation / hand-off screen shown after START.
class NavView extends WatchUi.View {

    var _r as Lang.Dictionary;

    function initialize(route as Lang.Dictionary) {
        View.initialize();
        _r = route;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(0x36D29E, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.20, Graphics.FONT_SMALL, "PUSHED", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.40, Graphics.FONT_TINY, _r["name"] as Lang.String, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(0x8E948F, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.58, Graphics.FONT_XTINY, "Created on your", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, h * 0.68, Graphics.FONT_XTINY, "Garmin account.", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0xFF6B35, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.82, Graphics.FONT_XTINY, "Navigate \u2192 Courses", Graphics.TEXT_JUSTIFY_CENTER);
    }
}
