package com.folddrive.app

import org.json.JSONObject

/** Shared state between the notification listener, the trip service and the screen. */
object NavBus {
    /** Latest Google Maps navigation notification, as raw text fields. */
    @Volatile var nav: JSONObject? = null

    /** Unread WhatsApp / Business messages and missed calls, read from notifications. */
    @Volatile var counts: JSONObject = JSONObject()

    /** Unread chats per app: {"whatsapp":[...], "business":[...]}. */
    @Volatile var chats: JSONObject = JSONObject()

    @Volatile var listenerConnected = false

    /** True while Fold Drive is on screen (full screen or split screen). */
    @Volatile var appVisible = false

    /** One-line summary of the Google Maps trip info, used by the floating bubble. */
    fun mapsLine(): String? {
        val n = nav ?: return null
        if (!n.optBoolean("active")) return null
        val title = n.optString("title")
        val keys = listOf("sub", "info", "summary", "big", "text")
        val summary = keys.map { n.optString(it) }
            .firstOrNull { it.isNotBlank() && Regex("ETA|arriv|\\bmin\\b|\\bhr\\b", RegexOption.IGNORE_CASE).containsMatchIn(it) }
        return listOf(title, summary).filter { !it.isNullOrBlank() }.joinToString(" · ").ifBlank { null }
    }
}
