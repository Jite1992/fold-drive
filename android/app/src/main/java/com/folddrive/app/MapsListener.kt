package com.folddrive.app

import android.app.Notification
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Reads Google Maps' navigation notification (next turn, time left, km left, ETA)
 * and counts unread WhatsApp messages and missed calls. Needs "Notification access".
 */
class MapsListener : NotificationListenerService() {

    companion object {
        const val MAPS = "com.google.android.apps.maps"
        const val WA = "com.whatsapp"
        const val WAB = "com.whatsapp.w4b"
        val DIALERS = setOf(
            "com.samsung.android.dialer", "com.google.android.dialer", "com.android.server.telecom",
            "com.samsung.android.incallui", "com.android.phone"
        )
        private var lastIconKey = ""
        private var lastIcon = ""
    }

    override fun onListenerConnected() {
        NavBus.listenerConnected = true
        try {
            activeNotifications?.forEach { if (it.packageName == MAPS && isNav(it)) readMaps(it) }
        } catch (_: Exception) { }
        refreshCounts()
    }

    override fun onListenerDisconnected() {
        NavBus.listenerConnected = false
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == MAPS && isNav(sbn)) readMaps(sbn)
        if (sbn.packageName == WA || sbn.packageName == WAB || sbn.packageName in DIALERS) refreshCounts()
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        if (sbn.packageName == MAPS && isNav(sbn)) {
            val stillNav = try { activeNotifications?.any { it.packageName == MAPS && isNav(it) } ?: false } catch (_: Exception) { false }
            if (!stillNav) {
                val n = NavBus.nav ?: JSONObject()
                n.put("active", false)
                n.put("endedAt", System.currentTimeMillis())
                NavBus.nav = n
            }
        }
        if (sbn.packageName == WA || sbn.packageName == WAB || sbn.packageName in DIALERS) refreshCounts()
    }

    private fun isNav(sbn: StatusBarNotification): Boolean {
        val n = sbn.notification
        return n.category == Notification.CATEGORY_NAVIGATION || (sbn.isOngoing && n.category != Notification.CATEGORY_SERVICE)
    }

    private fun readMaps(sbn: StatusBarNotification) {
        val n = sbn.notification
        val e = n.extras
        fun s(k: String): String = e.getCharSequence(k)?.toString() ?: ""
        val o = JSONObject()
        o.put("active", true)
        o.put("time", System.currentTimeMillis())
        o.put("title", s(Notification.EXTRA_TITLE))
        o.put("titleBig", s(Notification.EXTRA_TITLE_BIG))
        o.put("text", s(Notification.EXTRA_TEXT))
        o.put("sub", s(Notification.EXTRA_SUB_TEXT))
        o.put("big", s(Notification.EXTRA_BIG_TEXT))
        o.put("info", s(Notification.EXTRA_INFO_TEXT))
        o.put("summary", s(Notification.EXTRA_SUMMARY_TEXT))
        o.put("category", n.category ?: "")
        e.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.let { lines ->
            o.put("lines", JSONArray(lines.map { it.toString() }))
        }
        o.put("when", n.`when`)
        // Every simple field in the notification, so new Android "live update" fields
        // (progress, status-bar chip text) can be read too.
        val all = JSONObject()
        for (key in e.keySet()) {
            try {
                @Suppress("DEPRECATION")
                when (val v = e.get(key)) {
                    null -> {}
                    is CharSequence -> if (v.isNotBlank()) all.put(key, v.toString().take(200))
                    is Number, is Boolean -> all.put(key, v)
                    is Array<*> -> {
                        val items = v.filterIsInstance<CharSequence>().map { it.toString() }
                        if (items.isNotEmpty()) all.put(key, JSONArray(items.take(10)))
                        else all.put(key, "[" + v.size + " items]")
                    }
                    else -> all.put(key, "<" + v.javaClass.simpleName + ">")
                }
            } catch (_: Exception) { }
        }
        o.put("extras", all)
        try {
            val icon = n.getLargeIcon()
            if (icon != null) {
                val key = o.optString("title") + "|" + o.optString("text")
                if (key != lastIconKey) {
                    icon.loadDrawable(this)?.let { lastIcon = toBase64(it) }
                    lastIconKey = key
                }
                o.put("icon", lastIcon)
            }
        } catch (_: Exception) { }
        NavBus.nav = o
    }

    private fun toBase64(d: Drawable): String {
        val size = 96
        val bmp = if (d is BitmapDrawable && d.bitmap != null) {
            Bitmap.createScaledBitmap(d.bitmap, size, size, true)
        } else {
            val b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val c = Canvas(b)
            d.setBounds(0, 0, size, size)
            d.draw(c)
            b
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun refreshCounts() {
        val active = try { activeNotifications } catch (_: Exception) { null } ?: return

        fun textOf(sbn: StatusBarNotification): String {
            val e = sbn.notification.extras
            return listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_SUB_TEXT, Notification.EXTRA_SUMMARY_TEXT)
                .joinToString(" ") { e.getCharSequence(it)?.toString() ?: "" }
        }

        fun count(pkgs: Set<String>, pattern: Regex, filter: (StatusBarNotification) -> Boolean): Int {
            val list = active.filter { it.packageName in pkgs && filter(it) }
            var best = 0
            for (sbn in list) {
                pattern.find(textOf(sbn))?.let { m -> best = maxOf(best, m.groupValues[1].toIntOrNull() ?: 0) }
            }
            if (best > 0) return best
            return list.count { (it.notification.flags and Notification.FLAG_GROUP_SUMMARY) == 0 }
        }

        val msgs = Regex("(\\d+)\\s+(?:new\\s+)?messages", RegexOption.IGNORE_CASE)
        val calls = Regex("(\\d+)\\s+missed\\s+calls", RegexOption.IGNORE_CASE)
        val o = JSONObject()
        o.put("whatsapp", count(setOf(WA), msgs) { true })
        o.put("business", count(setOf(WAB), msgs) { true })
        o.put("missed", count(DIALERS, calls) { textOf(it).contains("missed", ignoreCase = true) })
        o.put("time", System.currentTimeMillis())
        NavBus.counts = o
    }
}
