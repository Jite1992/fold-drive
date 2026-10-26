package com.folddrive.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import android.provider.MediaStore
import android.provider.Settings
import android.speech.RecognizerIntent
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : Activity() {

    companion object {
        private const val REQ_FILE = 11
        private const val REQ_VOICE = 12
        private const val REQ_PERM = 13
        const val MAPS = "com.google.android.apps.maps"
    }

    lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val main = Handler(Looper.getMainLooper())

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.setBackgroundColor(0xFF0D1117.toInt())
        setContentView(web)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.host == "appassets.androidplatform.net") return false
                openExternal(u)
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    startActivityForResult(params.createIntent(), REQ_FILE); true
                } catch (_: Exception) {
                    fileCallback = null; false
                }
            }
        }
        web.addJavascriptInterface(Bridge(this), "Android")
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    fun js(code: String) = main.post { web.evaluateJavascript(code, null) }

    override fun onResume() {
        super.onResume()
        NavBus.appVisible = true
        TripService.instance?.updateOverlay()
        js("window.FD && FD.onResume && FD.onResume()")
    }

    override fun onPause() {
        super.onPause()
        NavBus.appVisible = false
        TripService.instance?.updateOverlay()
    }

    @Deprecated("Back handling for Android versions without predictive back")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.FD && FD.back) ? FD.back() : false") { r ->
            if (r != "true") moveTaskToBack(true)
        }
    }

    @Deprecated("Uses the classic activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_FILE -> {
                fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
                fileCallback = null
            }
            REQ_VOICE -> {
                val text = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
                if (resultCode == RESULT_OK && text != null) js("FD.onVoice(" + JSONObject.quote(text) + ")")
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        js("window.FD && FD.onResume && FD.onResume()")
    }

    /* ---------- helpers used by the bridge ---------- */

    fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    fun installed(pkg: String): Boolean = try {
        packageManager.getPackageInfo(pkg, 0); true
    } catch (_: Exception) { false }

    fun status(): String {
        val listeners = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: ""
        val o = JSONObject()
        o.put("location", granted(Manifest.permission.ACCESS_FINE_LOCATION))
        o.put("notif", listeners.contains(packageName))
        o.put("overlay", Settings.canDrawOverlays(this))
        o.put("calendar", granted(Manifest.permission.READ_CALENDAR))
        o.put("phone", granted(Manifest.permission.CALL_PHONE))
        o.put("notifications", if (Build.VERSION.SDK_INT >= 33) granted(Manifest.permission.POST_NOTIFICATIONS) else true)
        o.put("maps", installed(MAPS))
        o.put("whatsapp", installed("com.whatsapp"))
        o.put("business", installed("com.whatsapp.w4b"))
        o.put("wide", resources.configuration.screenWidthDp >= 600)
        val prefs = getSharedPreferences("fd", MODE_PRIVATE)
        o.put("overlayOn", prefs.getString("overlay", "1") == "1")
        o.put("splitOn", prefs.getString("split", "1") == "1")
        o.put("version", try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "" })
        return o.toString()
    }

    fun requestThing(what: String) {
        try {
            when (what) {
                "location" -> requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), REQ_PERM)
                "calendar" -> requestPermissions(arrayOf(Manifest.permission.READ_CALENDAR), REQ_PERM)
                "phone" -> requestPermissions(arrayOf(Manifest.permission.CALL_PHONE), REQ_PERM)
                "notifications" -> if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_PERM)
                "notif" -> startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                "overlay" -> startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
                "battery" -> startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
                "appsettings" -> startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
    }

    fun startTrip(destJson: String, openMaps: Boolean) {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            requestThing("location")
        }
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
            requestThing("notifications")
        }
        try {
            startForegroundService(Intent(this, TripService::class.java).putExtra("dest", destJson))
        } catch (e: Exception) {
            js("FD.toast && FD.toast(" + JSONObject.quote("Could not start trip recording: " + (e.message ?: "")) + ")")
        }
        if (openMaps) launchMaps(JSONObject(destJson))
    }

    fun stopTrip() {
        stopService(Intent(this, TripService::class.java))
    }

    fun launchMaps(dest: JSONObject) {
        val q = if (dest.has("lat") && !dest.isNull("lat")) "${dest.getDouble("lat")},${dest.getDouble("lng")}"
        else Uri.encode(dest.optString("query").ifBlank { dest.optString("name") })
        val prefs = getSharedPreferences("fd", MODE_PRIVATE)
        val sideBySide = resources.configuration.screenWidthDp >= 600 && prefs.getString("split", "1") == "1"
        if (q.isBlank()) {
            openApp("maps"); return
        }
        val i = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$q&mode=d"))
            .setPackage(MAPS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (sideBySide) i.addFlags(Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT)
        try {
            startActivity(i)
        } catch (_: ActivityNotFoundException) {
            openExternal(Uri.parse("https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=$q"))
        }
    }

    fun openApp(key: String) {
        when (key) {
            "whatsapp" -> launchPkg("com.whatsapp", "WhatsApp")
            "business" -> launchPkg("com.whatsapp.w4b", "WhatsApp Business")
            "maps" -> {
                val i = packageManager.getLaunchIntentForPackage(MAPS)
                if (i != null) {
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    if (resources.configuration.screenWidthDp >= 600 &&
                        getSharedPreferences("fd", MODE_PRIVATE).getString("split", "1") == "1") i.addFlags(Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT)
                    startActivity(i)
                } else toast("Google Maps is not installed")
            }
            "calendar" -> {
                when {
                    installed("com.samsung.android.calendar") -> launchPkg("com.samsung.android.calendar", "Calendar")
                    installed("com.google.android.calendar") -> launchPkg("com.google.android.calendar", "Calendar")
                    else -> try {
                        val uri = CalendarContract.CONTENT_URI.buildUpon().appendPath("time").build()
                        startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (_: Exception) { toast("No calendar app found") }
                }
            }
            "dialer" -> try { startActivity(Intent(Intent.ACTION_DIAL)) } catch (_: Exception) { toast("No phone app found") }
        }
    }

    private fun launchPkg(pkg: String, name: String) {
        val i = packageManager.getLaunchIntentForPackage(pkg)
        if (i == null) { toast("$name is not installed"); return }
        startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun call(number: String) {
        val uri = Uri.parse("tel:" + number.filter { it.isDigit() || it == '+' })
        val action = if (granted(Manifest.permission.CALL_PHONE)) Intent.ACTION_CALL else Intent.ACTION_DIAL
        try { startActivity(Intent(action, uri)) } catch (_: Exception) { startActivity(Intent(Intent.ACTION_DIAL, uri)) }
    }

    fun startVoice() {
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Say a command, like \"Navigate to office\"")
        try { startActivityForResult(i, REQ_VOICE) } catch (_: Exception) { toast("Voice input is not available") }
    }

    fun locateOnce() {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            requestThing("location")
            js("FD.onLocation && FD.onLocation({error:'Allow location, then try again.'})")
            return
        }
        val lm = getSystemService(LocationManager::class.java)
        try {
            val last = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER) ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            if (last != null && System.currentTimeMillis() - last.time < 120_000) { sendLocation(last); return }
            var done = false
            val listener = object : LocationListener {
                override fun onLocationChanged(loc: Location) {
                    if (done) return
                    done = true; lm.removeUpdates(this); sendLocation(loc)
                }
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) {}
                @Deprecated("Needed for older Android versions")
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            }
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 500L, 0f, listener, Looper.getMainLooper())
            main.postDelayed({
                if (!done) {
                    done = true; lm.removeUpdates(listener)
                    if (last != null) sendLocation(last) else js("FD.onLocation && FD.onLocation({error:'Could not get a GPS fix. Try outdoors.'})")
                }
            }, 20_000)
        } catch (e: SecurityException) {
            js("FD.onLocation && FD.onLocation({error:'Location permission is off.'})")
        }
    }

    private fun sendLocation(l: Location) {
        js("FD.onLocation && FD.onLocation({lat:${l.latitude},lng:${l.longitude}})")
    }

    fun readEvents(): String {
        val arr = JSONArray()
        if (!granted(Manifest.permission.READ_CALENDAR)) return arr.toString()
        val now = System.currentTimeMillis()
        val builder = CalendarContract.Instances.CONTENT_URI.buildUpon()
        ContentUris.appendId(builder, now - 3_600_000L)
        ContentUris.appendId(builder, now + 40L * 3_600_000L)
        val proj = arrayOf(
            CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
            CalendarContract.Instances.EVENT_LOCATION, CalendarContract.Instances.ALL_DAY
        )
        try {
            contentResolver.query(builder.build(), proj, null, null, CalendarContract.Instances.BEGIN + " ASC")?.use { c ->
                while (c.moveToNext() && arr.length() < 12) {
                    val end = c.getLong(2)
                    if (end < now) continue
                    arr.put(JSONObject()
                        .put("title", c.getString(0) ?: "(No title)")
                        .put("begin", c.getLong(1))
                        .put("end", end)
                        .put("location", c.getString(3) ?: "")
                        .put("allDay", c.getInt(4) == 1))
                }
            }
        } catch (_: Exception) { }
        return arr.toString()
    }

    fun saveDownload(name: String, text: String): Boolean = try {
        val v = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)
        if (uri == null) false else {
            contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
            true
        }
    } catch (_: Exception) { false }

    fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    fun openExternal(u: Uri) {
        try {
            val i = if (u.scheme == "intent") Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME)
            else if (u.scheme == "tel") Intent(Intent.ACTION_DIAL, u)
            else Intent(Intent.ACTION_VIEW, u)
            startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            toast("No app can open this link")
        }
    }

    fun toast(msg: String) = main.post { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
}
