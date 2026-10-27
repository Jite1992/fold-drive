package com.folddrive.app

import android.webkit.JavascriptInterface
import org.json.JSONObject

/** Functions the app's screens (JavaScript) can call, as window.Android.*. */
class Bridge(private val a: MainActivity) {

    private fun ui(block: () -> Unit) = a.runOnUiThread(block)

    @JavascriptInterface fun status(): String = a.status()
    @JavascriptInterface fun request(what: String) = ui { a.requestThing(what) }

    @JavascriptInterface fun startTrip(destJson: String, openMaps: Boolean) = ui { a.startTrip(destJson, openMaps) }
    @JavascriptInterface fun openMaps(destJson: String) = ui {
        val d = try { JSONObject(destJson) } catch (_: Exception) { JSONObject() }
        if (d.length() == 0) a.openApp("maps") else a.launchMaps(d)
    }
    @JavascriptInterface fun endTrip(exitMaps: Boolean): String {
        val s = TripService.state?.toString() ?: "null"
        ui { a.stopTrip(exitMaps); a.keepScreenOn(false) }
        return s
    }
    @JavascriptInterface fun chats(): String = NavBus.chats.toString()
    @JavascriptInterface fun openChat(key: String, app: String) = ui { a.openChat(key, app) }
    @JavascriptInterface fun calendars(): String = a.readCalendars()
    @JavascriptInterface fun geocode(q: String): String = a.geocode(q)
    @JavascriptInterface fun trip(): String = TripService.state?.toString() ?: "null"
    @JavascriptInterface fun nav(): String = NavBus.nav?.toString() ?: "null"
    @JavascriptInterface fun counts(): String = NavBus.counts.toString()
    @JavascriptInterface fun events(): String = a.readEvents()

    @JavascriptInterface fun open(app: String) = ui { a.openApp(app) }
    @JavascriptInterface fun call(number: String) = ui { a.call(number) }
    @JavascriptInterface fun voice() = ui { a.startVoice() }
    @JavascriptInterface fun locate() = ui { a.locateOnce() }
    @JavascriptInterface fun saveFile(name: String, text: String): Boolean = a.saveDownload(name, text)
    @JavascriptInterface fun saveText(name: String, text: String, mime: String): Boolean = a.saveDownload(name, text, mime)
    @JavascriptInterface fun revgeo(lat: Double, lng: Double): String = a.revgeo(lat, lng)
    @JavascriptInterface fun keepOn(on: Boolean) = ui { a.keepScreenOn(on) }

    @JavascriptInterface fun setPref(key: String, value: String) {
        a.getSharedPreferences("fd", android.content.Context.MODE_PRIVATE).edit().putString(key, value).apply()
        ui { TripService.instance?.updateOverlay() }
    }
}
