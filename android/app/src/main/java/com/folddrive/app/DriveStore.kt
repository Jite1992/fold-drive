package com.folddrive.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Drives recorded in the background (Android Auto), the Work / Personal tags set from notifications,
 * and the "details still pending" reminders. The app's screens pick these up when they open.
 */
object DriveStore {
    private const val PREFS = "fd_trips"
    private const val CHANNEL = "drive_details"
    const val ACTION_TAG = "com.folddrive.app.TAG"
    const val ACTION_REMIND = "com.folddrive.app.REMIND"
    private const val DAY = 24L * 3600_000L

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun arr(c: Context, k: String) = try { JSONArray(prefs(c).getString(k, "[]")) } catch (_: Exception) { JSONArray() }
    private fun obj(c: Context, k: String) = try { JSONObject(prefs(c).getString(k, "{}")) } catch (_: Exception) { JSONObject() }
    private fun put(c: Context, k: String, v: Any) = prefs(c).edit().putString(k, v.toString()).apply()

    fun pref(c: Context, k: String, def: String) = c.getSharedPreferences("fd", Context.MODE_PRIVATE).getString(k, def) ?: def

    /* ---------- background drives ---------- */
    @Synchronized fun addPending(c: Context, trip: JSONObject) {
        val a = arr(c, "pending"); a.put(trip); put(c, "pending", a)
        val label = label(trip.optLong("start"), trip.optDouble("km"))
        if (pref(c, "askTag", "1") == "1") {
            registerUntagged(c, trip.optString("id"), trip.optLong("end"), label, "")
            notifyDetails(c, trip.optString("id"), "Drive ended · " + String.format(Locale.US, "%.1f km · %d min", trip.optDouble("km"), (trip.optLong("end") - trip.optLong("start")) / 60000),
                "Was this a work drive? " + label, false)
        }
    }
    @Synchronized fun pending(c: Context): String = arr(c, "pending").toString()
    @Synchronized fun ackPending(c: Context, idsJson: String) {
        val ids = try { JSONArray(idsJson) } catch (_: Exception) { JSONArray() }
        val set = (0 until ids.length()).map { ids.optString(it) }.toSet()
        val a = arr(c, "pending"); val keep = JSONArray()
        for (i in 0 until a.length()) { val t = a.optJSONObject(i) ?: continue; if (t.optString("id") !in set) keep.put(t) }
        put(c, "pending", keep)
    }

    /* ---------- tags ---------- */
    @Synchronized fun tagFromNotification(c: Context, id: String, type: String) {
        val t = obj(c, "tags"); t.put(id, type); put(c, "tags", t)
        val a = arr(c, "pending")
        for (i in 0 until a.length()) a.optJSONObject(i)?.let { if (it.optString("id") == id) it.put("type", type) }
        put(c, "pending", a)
        clearUntagged(c, id)
    }
    @Synchronized fun tags(c: Context): String = obj(c, "tags").toString()
    @Synchronized fun ackTags(c: Context, idsJson: String) {
        val ids = try { JSONArray(idsJson) } catch (_: Exception) { JSONArray() }
        val t = obj(c, "tags"); for (i in 0 until ids.length()) t.remove(ids.optString(i)); put(c, "tags", t)
    }
    /** Tagged in the app: no more reminders for it. */
    fun tagFromApp(c: Context, id: String) = clearUntagged(c, id)

    /* ---------- untagged drives and their reminders ---------- */
    @Synchronized fun registerUntagged(c: Context, id: String, end: Long, label: String, unused: String) {
        if (id.isBlank()) return
        val u = obj(c, "untagged")
        if (!u.has(id)) u.put(id, JSONObject().put("end", end).put("label", label).put("n", 0))
        put(c, "untagged", u)
        schedule(c, id, maxOf(end + DAY, System.currentTimeMillis() + 3600_000L))
    }
    @Synchronized private fun clearUntagged(c: Context, id: String) {
        val u = obj(c, "untagged"); u.remove(id); put(c, "untagged", u)
        c.getSystemService(NotificationManager::class.java)?.cancel(notifId(id))
        c.getSystemService(AlarmManager::class.java)?.cancel(remindIntent(c, id))
    }
    @Synchronized fun remind(c: Context, id: String) {
        val u = obj(c, "untagged"); val e = u.optJSONObject(id) ?: return
        if (pref(c, "remind", "1") == "1") {
            notifyDetails(c, id, "Trip details still pending", e.optString("label") + " is not marked Work or Personal yet.", true)
        }
        val n = e.optInt("n") + 1; e.put("n", n); put(c, "untagged", u)
        if (n < 7) schedule(c, id, System.currentTimeMillis() + DAY)
    }
    @Synchronized fun rescheduleAll(c: Context) {
        val u = obj(c, "untagged"); val now = System.currentTimeMillis()
        u.keys().forEach { id -> val e = u.optJSONObject(id) ?: return@forEach; schedule(c, id, maxOf(e.optLong("end") + DAY, now + 600_000L)) }
    }

    private fun notifId(id: String) = 2000 + (id.hashCode() and 0x7ffff)
    private fun remindIntent(c: Context, id: String): PendingIntent =
        PendingIntent.getBroadcast(c, notifId(id), Intent(c, DriveReceiver::class.java).setAction(ACTION_REMIND).putExtra("id", id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    private fun schedule(c: Context, id: String, at: Long) {
        try { c.getSystemService(AlarmManager::class.java)?.set(AlarmManager.RTC_WAKEUP, at, remindIntent(c, id)) } catch (_: Exception) { }
    }

    fun label(start: Long, km: Double): String =
        SimpleDateFormat("EEE d MMM, HH:mm", Locale.ENGLISH).format(Date(start)) + String.format(Locale.US, " · %.1f km", km)

    fun channel(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Drive details (Work or Personal)", NotificationManager.IMPORTANCE_HIGH))
        }
    }

    fun notifyDetails(c: Context, id: String, title: String, text: String, reminder: Boolean) {
        channel(c)
        val nm = c.getSystemService(NotificationManager::class.java) ?: return
        fun tag(type: String, req: Int) = PendingIntent.getBroadcast(c, notifId(id) * 4 + req,
            Intent(c, DriveReceiver::class.java).setAction(ACTION_TAG).putExtra("id", id).putExtra("type", type),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val open = PendingIntent.getActivity(c, notifId(id) * 4 + 3,
            Intent(c, MainActivity::class.java).putExtra("trip", id).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(c, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .addAction(Notification.Action.Builder(null, "Work", tag("work", 1)).build())
            .addAction(Notification.Action.Builder(null, "Personal", tag("personal", 2)).build())
            .addAction(Notification.Action.Builder(null, if (reminder) "Open" else "Details", open).build())
            .build()
        try { nm.notify(notifId(id), n) } catch (_: SecurityException) { }
    }

    fun notifySimple(c: Context, id: Int, title: String, text: String, pi: PendingIntent?) {
        channel(c)
        val n = Notification.Builder(c, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(title).setContentText(text).setAutoCancel(true).apply { if (pi != null) setContentIntent(pi) }.build()
        try { c.getSystemService(NotificationManager::class.java)?.notify(id, n) } catch (_: SecurityException) { }
    }
}

/** Work / Personal buttons on the notification, and the 24-hour reminder alarm. */
class DriveReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val id = i.getStringExtra("id") ?: ""
        when (i.action) {
            DriveStore.ACTION_TAG -> {
                val type = i.getStringExtra("type") ?: return
                DriveStore.tagFromNotification(c, id, type)
                MainActivity.instance?.js("window.FD && FD.work && FD.work.sync()")
            }
            DriveStore.ACTION_REMIND -> DriveStore.remind(c, id)
        }
    }
}

/** Re-sets the reminders after the phone restarts. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action == Intent.ACTION_BOOT_COMPLETED) DriveStore.rescheduleAll(c)
    }
}
