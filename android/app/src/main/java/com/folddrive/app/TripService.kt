package com.folddrive.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import org.json.JSONObject
import java.util.Locale

/**
 * Records the trip from GPS (distance, speed, time) in the background,
 * and shows the floating stats bubble over Google Maps.
 */
class TripService : Service(), LocationListener {

    companion object {
        @Volatile var state: JSONObject? = null
        @Volatile var instance: TripService? = null
        private const val CHANNEL = "trip"
        private const val NOTIF_ID = 7

        /** Android Auto connected: record a drive in the background (if none is running). */
        fun startAuto(c: android.content.Context) {
            if (instance != null) { instance?.carBound = true; return }
            if (c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                DriveStore.notifySimple(c, 9, "Android Auto connected", "Fold Drive needs location access to record this drive. Open the app to allow it.", null)
                return
            }
            val i = Intent(c, TripService::class.java).putExtra("dest", "{}").putExtra("auto", true)
            try { c.startForegroundService(i) } catch (e: Exception) {
                // Android did not allow a background start: one tap on this notification starts it
                val pi = PendingIntent.getForegroundService(c, 8, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                DriveStore.notifySimple(c, 9, "Android Auto connected", "Tap to start recording this drive", pi)
            }
        }
        /** Android Auto disconnected: save the drive and ask Work or Personal. */
        fun endAuto(c: android.content.Context) { instance?.finishToPending() }
    }

    var isAuto = false
    var carBound = false

    private var lm: LocationManager? = null
    private val handler = Handler(Looper.getMainLooper())
    private var overlay: Overlay? = null

    private var dest = JSONObject()
    private var startedAt = 0L
    private var distance = 0.0
    private var speedKmh = 0.0
    private var topKmh = 0.0
    private var lastLat = 0.0; private var lastLng = 0.0; private var lastTs = 0L; private var haveLast = false
    private var prevLat = 0.0; private var prevLng = 0.0; private var prevTs = 0L; private var havePrev = false
    private var curLat = 0.0; private var curLng = 0.0; private var acc = 999f; private var hasPos = false
    private var heading = -1f
    private var startLat = 0.0; private var startLng = 0.0; private var haveStart = false
    private var lastNotifUpdate = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) { stopSelf(); return START_NOT_STICKY }
        if (instance != null && intent.getBooleanExtra("auto", false)) { carBound = true; return START_NOT_STICKY }
        isAuto = intent.getBooleanExtra("auto", false); carBound = isAuto
        (getSystemService(NotificationManager::class.java))?.cancel(9)
        dest = try { JSONObject(intent.getStringExtra("dest") ?: "{}") } catch (_: Exception) { JSONObject() }
        startedAt = System.currentTimeMillis()
        distance = 0.0; speedKmh = 0.0; topKmh = 0.0; haveLast = false; havePrev = false; hasPos = false; haveStart = false
        instance = this
        try {
            startForeground(NOTIF_ID, buildNotification(if (isAuto) "Android Auto connected · recording this drive" else "Recording your trip"), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } catch (e: Exception) {
            instance = null
            DriveStore.notifySimple(this, 9, "Could not record the drive", "Allow location \"All the time\" for Fold Drive (Settings › Work expenses) so drives can be recorded in the background.", null)
            stopSelf(); return START_NOT_STICKY
        }
        startLocation()
        lookUpDestination()
        handler.removeCallbacks(tick)
        handler.post(tick)
        return START_NOT_STICKY
    }

    /** Finds the destination's coordinates on the phone (no key needed), for the km-left estimate. */
    private fun lookUpDestination() {
        if (dest.has("lat") && !dest.isNull("lat")) return
        val q = dest.optString("query").ifBlank { dest.optString("name") }
        if (q.isBlank() || !Geocoder.isPresent()) return
        val forDest = dest
        val ctx = this
        Thread {
            try {
                val g = Geocoder(ctx, Locale.ENGLISH)
                val inUae = geocode(g, q, true)
                val r = inUae
                if (r != null && forDest === dest) {
                    handler.post { dest.put("lat", r.latitude); dest.put("lng", r.longitude); dest.put("geocoded", true) }
                }
            } catch (_: Exception) { }
        }.start()
    }

    @Suppress("DEPRECATION")
    private fun geocode(g: Geocoder, q: String, uaeOnly: Boolean): android.location.Address? = try {
        val list = if (uaeOnly) g.getFromLocationName(q, 1, 22.5, 51.5, 26.5, 56.5) else g.getFromLocationName(q, 1)
        list?.firstOrNull()
    } catch (_: Exception) { null }

    private fun startLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        val m = getSystemService(LocationManager::class.java) ?: return
        lm = m
        try {
            m.removeUpdates(this)
            m.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper())
        } catch (_: Exception) { }
    }

    override fun onLocationChanged(loc: Location) {
        val ts = loc.time.takeIf { it > 0 } ?: System.currentTimeMillis()
        val accuracy = if (loc.hasAccuracy()) loc.accuracy else 999f
        if (accuracy <= 50f) {
            if (haveLast) {
                val d = dist(lastLat, lastLng, loc.latitude, loc.longitude)
                val dt = (ts - lastTs) / 1000.0
                if (dt > 0 && d / dt < 75) {
                    if (d >= 3) { distance += d; lastLat = loc.latitude; lastLng = loc.longitude; lastTs = ts }
                } else { lastLat = loc.latitude; lastLng = loc.longitude; lastTs = ts }
            } else { lastLat = loc.latitude; lastLng = loc.longitude; lastTs = ts; haveLast = true }
        }
        var sp = if (loc.hasSpeed()) loc.speed.toDouble() else {
            if (havePrev) dist(prevLat, prevLng, loc.latitude, loc.longitude) / maxOf(1.0, (ts - prevTs) / 1000.0) else 0.0
        }
        prevLat = loc.latitude; prevLng = loc.longitude; prevTs = ts; havePrev = true
        sp *= 3.6
        speedKmh = if (sp < 2) 0.0 else sp
        if (accuracy <= 30f && speedKmh > topKmh) topKmh = speedKmh
        curLat = loc.latitude; curLng = loc.longitude; acc = accuracy; hasPos = true
        if (!haveStart && accuracy <= 80f) { startLat = loc.latitude; startLng = loc.longitude; haveStart = true }
        if (loc.hasBearing() && speedKmh > 5) heading = loc.bearing
        publish()
    }

    @Deprecated("Needed for older Android versions")
    override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) { }
    override fun onProviderEnabled(provider: String) { }
    override fun onProviderDisabled(provider: String) { }

    private fun publish() {
        val o = JSONObject()
        o.put("active", true)
        o.put("startedAt", startedAt)
        o.put("distance", distance)
        o.put("speed", speedKmh)
        o.put("top", topKmh)
        o.put("hasPos", hasPos)
        o.put("gps", lm != null)
        if (hasPos) { o.put("lat", curLat); o.put("lng", curLng); o.put("acc", acc.toDouble()) }
        if (heading >= 0) o.put("heading", heading.toDouble())
        if (haveStart) { o.put("startLat", startLat); o.put("startLng", startLng) }
        o.put("dest", dest)
        if (hasPos && dest.has("lat") && !dest.isNull("lat")) {
            o.put("straight", dist(curLat, curLng, dest.optDouble("lat"), dest.optDouble("lng")))
        }
        state = o
    }

    private val tick = object : Runnable {
        override fun run() {
            publish()
            updateOverlay()
            val now = System.currentTimeMillis()
            if (now - lastNotifUpdate > 5000) {
                lastNotifUpdate = now
                val nm = getSystemService(NotificationManager::class.java)
                nm?.notify(NOTIF_ID, buildNotification(statsLine()))
            }
            handler.postDelayed(this, 1000)
        }
    }

    /** Ends the drive here (no screen involved): stores it for the app and posts the Work / Personal question. */
    fun finishToPending() {
        val end = System.currentTimeMillis()
        val km = distance / 1000.0
        if (km >= 0.3) {
            val o = JSONObject()
            o.put("id", startedAt.toString()); o.put("start", startedAt); o.put("end", end)
            o.put("km", km); o.put("top", topKmh); o.put("auto", isAuto)
            if (haveStart) { o.put("startLat", startLat); o.put("startLng", startLng) }
            if (hasPos) { o.put("endLat", curLat); o.put("endLng", curLng) }
            if (dest.length() > 0) o.put("dest", dest)
            DriveStore.addPending(this, o)
        }
        stopSelf()
        MainActivity.instance?.js("window.FD && FD.work && FD.work.nativeEnded()")
    }

    private fun statsLine(): String {
        val sec = (System.currentTimeMillis() - startedAt) / 1000
        val km = distance / 1000.0
        val avg = if (sec > 30) km / (sec / 3600.0) else 0.0
        return String.format(Locale.US, "%.1f km · %d:%02d · avg %.0f km/h", km, sec / 3600, (sec / 60) % 60, avg)
    }

    fun updateOverlay() {
        val prefs = getSharedPreferences("fd", MODE_PRIVATE)
        val want = prefs.getString("overlay", "1") == "1" && Settings.canDrawOverlays(this) && !NavBus.appVisible
        if (!want) { overlay?.hide(); return }
        val o = overlay ?: Overlay(this).also { overlay = it }
        o.show()
        o.update(String.format(Locale.US, "%.0f", speedKmh), NavBus.mapsLine() ?: (dest.optString("name").ifBlank { "Free drive" }), statsLine())
    }

    private fun buildNotification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm?.getNotificationChannel(CHANNEL) == null) {
            nm?.createNotificationChannel(NotificationChannel(CHANNEL, "Trip recording", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Fold Drive · " + (dest.optString("name").ifBlank { if (isAuto) "Android Auto drive" else "Free drive" }))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .build()
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        try { lm?.removeUpdates(this) } catch (_: Exception) { }
        overlay?.hide()
        overlay = null
        state = null
        instance = null
        super.onDestroy()
    }

    private fun dist(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Double {
        val r = FloatArray(1)
        Location.distanceBetween(aLat, aLng, bLat, bLng, r)
        return r[0].toDouble()
    }
}
