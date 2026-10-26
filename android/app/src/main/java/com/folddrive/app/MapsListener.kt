package com.folddrive.app

import android.app.Notification
import android.app.PendingIntent
import android.app.Person
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.os.Parcelable
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap

/**
 * Reads Google Maps' navigation notification (next turn, arrival time), can press its
 * "Exit navigation" button, and reads unread WhatsApp chats and missed calls.
 * Needs "Notification access".
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
        @Volatile var instance: MapsListener? = null
        /** Opens a particular chat: notification key -> the notification's tap action. */
        val chatIntents = ConcurrentHashMap<String, PendingIntent>()
        private var lastIconKey = ""
        private var lastIcon = ""

        /** Presses "Exit navigation" on Google Maps' notification. Returns true if found. */
        fun exitNavigation(): Boolean {
            val svc = instance ?: return false
            val list = try { svc.activeNotifications?.filter { it.packageName == MAPS } } catch (_: Exception) { null } ?: return false
            val words = Regex("exit|end|stop|close|quit", RegexOption.IGNORE_CASE)
            for (sbn in list) {
                val action = sbn.notification.actions?.firstOrNull { words.containsMatchIn(it.title?.toString() ?: "") } ?: continue
                try { action.actionIntent.send(); return true } catch (_: Exception) { }
            }
            return false
        }
    }

    override fun onListenerConnected() {
        instance = this
        NavBus.listenerConnected = true
        try {
            activeNotifications?.forEach { if (it.packageName == MAPS && isNav(it)) readMaps(it) }
        } catch (_: Exception) { }
        refreshChats()
    }

    override fun onListenerDisconnected() {
        NavBus.listenerConnected = false
        instance = null
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == MAPS && isNav(sbn)) readMaps(sbn)
        if (sbn.packageName == WA || sbn.packageName == WAB || sbn.packageName in DIALERS) refreshChats()
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
        if (sbn.packageName == WA || sbn.packageName == WAB || sbn.packageName in DIALERS) refreshChats()
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
        o.put("actions", JSONArray((n.actions ?: emptyArray()).map { it.title?.toString() ?: "" }))
        // Every simple field, so newer "live update" fields (progress, status-bar chip text) can be read too.
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

    /** Unread chats (with their messages) for WhatsApp and Business, plus missed calls. */
    private fun refreshChats() {
        val active = try { activeNotifications } catch (_: Exception) { null } ?: return
        val msgsRe = Regex("(\\d+)\\s+(?:new\\s+)?messages", RegexOption.IGNORE_CASE)
        val callsRe = Regex("(\\d+)\\s+missed\\s+calls", RegexOption.IGNORE_CASE)

        fun textOf(sbn: StatusBarNotification): String {
            val e = sbn.notification.extras
            return listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_SUB_TEXT, Notification.EXTRA_SUMMARY_TEXT)
                .joinToString(" ") { e.getCharSequence(it)?.toString() ?: "" }
        }

        val chats = JSONObject()
        val counts = JSONObject()
        for ((key, pkg) in listOf("whatsapp" to WA, "business" to WAB)) {
            val list = active.filter { it.packageName == pkg }
            val arr = JSONArray()
            var total = 0
            var summaryCount = 0
            for (sbn in list) {
                val n = sbn.notification
                val e = n.extras
                if ((n.flags and Notification.FLAG_GROUP_SUMMARY) != 0) {
                    msgsRe.find(textOf(sbn))?.let { summaryCount = maxOf(summaryCount, it.groupValues[1].toIntOrNull() ?: 0) }
                    continue
                }
                val title = (e.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE) ?: e.getCharSequence(Notification.EXTRA_TITLE))?.toString() ?: "Chat"
                val lines = JSONArray()
                @Suppress("DEPRECATION")
                val msgs: Array<Parcelable>? = e.getParcelableArray(Notification.EXTRA_MESSAGES)
                if (msgs != null && msgs.isNotEmpty()) {
                    for (p in msgs.takeLast(5)) {
                        val b = p as? Bundle ?: continue
                        val text = b.getCharSequence("text")?.toString() ?: continue
                        @Suppress("DEPRECATION")
                        val sender = b.getCharSequence("sender")?.toString()
                            ?: (b.getParcelable<Person>("sender_person"))?.name?.toString()
                            ?: ""
                        lines.put(JSONObject().put("from", sender).put("text", text).put("time", b.getLong("time")))
                    }
                } else {
                    val big = e.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
                    if (big != null) big.takeLast(5).forEach { lines.put(JSONObject().put("from", "").put("text", it.toString())) }
                    else e.getCharSequence(Notification.EXTRA_TEXT)?.let { lines.put(JSONObject().put("from", "").put("text", it.toString())) }
                }
                val count = maxOf(1, msgs?.size ?: lines.length())
                total += count
                n.contentIntent?.let { chatIntents[sbn.key] = it }
                arr.put(JSONObject().put("key", sbn.key).put("title", title).put("count", count).put("time", sbn.postTime).put("lines", lines))
            }
            chats.put(key, arr)
            counts.put(key, maxOf(total, summaryCount))
        }
        val missedList = active.filter { it.packageName in DIALERS && textOf(it).contains("missed", ignoreCase = true) }
        var missed = 0
        for (sbn in missedList) callsRe.find(textOf(sbn))?.let { missed = maxOf(missed, it.groupValues[1].toIntOrNull() ?: 0) }
        if (missed == 0) missed = missedList.count { (it.notification.flags and Notification.FLAG_GROUP_SUMMARY) == 0 }
        counts.put("missed", missed)
        counts.put("time", System.currentTimeMillis())
        NavBus.chats = chats
        NavBus.counts = counts
    }
}
