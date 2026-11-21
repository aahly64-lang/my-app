package expo.modules.geoalarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.util.Calendar

/**
 * A "ring" is a scheduled full-screen alarm (timer, note reminder, alarm clock, snooze).
 * JSON fields: id, at (epoch ms), title, body, kind, sound (uri or ""), durationMs,
 * snoozeMin (0 = no snooze), snoozeLeft (-1 = unlimited), daysMask (bit0 = Sunday ... bit6 = Saturday,
 * 0 = not repeating), hour, minute, endAt (epoch ms, 0 = no end; repeating rings stop after it),
 * silent (true = ordinary notification instead of a full-screen ring).
 */
object RingScheduler {
  private const val PREFS = "geo_alarm_rings_v1"
  private const val KEY = "rings"
  const val ACTION_RING = "expo.modules.geoalarm.RING"
  const val EXTRA_RING_ID = "ringId"

  private fun load(ctx: Context): JSONObject {
    val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return JSONObject()
    return try { JSONObject(raw) } catch (e: Exception) { JSONObject() }
  }

  private fun store(ctx: Context, all: JSONObject) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, all.toString()).apply()
  }

  fun get(ctx: Context, id: String): JSONObject? {
    val all = load(ctx)
    return if (all.has(id)) all.getJSONObject(id) else null
  }

  fun ids(ctx: Context): List<String> {
    val all = load(ctx)
    val out = ArrayList<String>()
    val it = all.keys()
    while (it.hasNext()) out.add(it.next())
    return out
  }

  private fun firePendingIntent(ctx: Context, id: String): PendingIntent {
    val intent = Intent(ctx, RingReceiver::class.java).apply {
      action = ACTION_RING
      putExtra(EXTRA_RING_ID, id)
      data = android.net.Uri.parse("geoalarm://ring/" + android.net.Uri.encode(id))
    }
    return PendingIntent.getBroadcast(
      ctx, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun setAlarm(ctx: Context, id: String, at: Long) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val fire = firePendingIntent(ctx, id)
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent()
    val show = PendingIntent.getActivity(
      ctx, 7, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    try {
      am.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), fire)
    } catch (e: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire)
    }
  }

  /** Next time matching hour:minute on an allowed day, strictly after [from]. */
  fun computeNext(hour: Int, minute: Int, daysMask: Int, from: Long): Long {
    val base = Calendar.getInstance().apply {
      timeInMillis = from
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    for (d in 0..7) {
      val c = base.clone() as Calendar
      c.add(Calendar.DAY_OF_YEAR, d)
      if (c.timeInMillis <= from) continue
      val bit = c.get(Calendar.DAY_OF_WEEK) - 1 // Sunday = 0
      if (daysMask == 0 || (daysMask and (1 shl bit)) != 0) return c.timeInMillis
    }
    return base.timeInMillis + 24L * 60 * 60 * 1000
  }

  fun schedule(ctx: Context, ring: JSONObject) {
    val id = ring.getString("id")
    val all = load(ctx)
    all.put(id, ring)
    store(ctx, all)
    setAlarm(ctx, id, ring.getLong("at"))
  }

  fun cancel(ctx: Context, id: String) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(firePendingIntent(ctx, id))
    val all = load(ctx)
    all.remove(id)
    store(ctx, all)
  }

  /** Called when an alarm fires. */
  fun fire(ctx: Context, id: String) {
    val ring = get(ctx, id) ?: return
    AlarmNotifier.show(ctx, ring)
    val daysMask = ring.optInt("daysMask", 0)
    if (daysMask != 0) {
      val next = computeNext(ring.optInt("hour"), ring.optInt("minute"), daysMask, System.currentTimeMillis() + 1000)
      val endAt = ring.optLong("endAt", 0L)
      if (endAt > 0 && next > endAt) {
        val all = load(ctx)
        all.remove(id)
        store(ctx, all)
        return
      }
      ring.put("at", next)
      schedule(ctx, ring)
    } else {
      val all = load(ctx)
      all.remove(id)
      store(ctx, all)
    }
  }

  /** Snooze the ring that is currently sounding. */
  fun snooze(ctx: Context, ring: JSONObject) {
    val snoozeMin = ring.optInt("snoozeMin", 0)
    if (snoozeMin <= 0) return
    val left = ring.optInt("snoozeLeft", -1)
    if (left == 0) return
    val baseId = ring.getString("id").substringBefore(":snooze")
    val snoozeRing = JSONObject(ring.toString()).apply {
      put("id", "$baseId:snooze")
      put("at", System.currentTimeMillis() + snoozeMin * 60_000L)
      put("daysMask", 0)
      put("snoozeLeft", if (left < 0) -1 else left - 1)
    }
    schedule(ctx, snoozeRing)
  }

  /** After reboot / time change: re-register everything that is still in the future (or repeating). */
  fun rescheduleAll(ctx: Context) {
    val all = load(ctx)
    val now = System.currentTimeMillis()
    val it = all.keys()
    val toRemove = ArrayList<String>()
    val toSet = ArrayList<Pair<String, Long>>()
    while (it.hasNext()) {
      val id = it.next()
      val ring = all.getJSONObject(id)
      var at = ring.getLong("at")
      val daysMask = ring.optInt("daysMask", 0)
      if (at <= now) {
        if (daysMask != 0) {
          at = computeNext(ring.optInt("hour"), ring.optInt("minute"), daysMask, now)
          val endAt = ring.optLong("endAt", 0L)
          if (endAt > 0 && at > endAt) {
            toRemove.add(id)
            continue
          }
          ring.put("at", at)
        } else if (now - at < 10 * 60_000L) {
          at = now + 5_000L // missed by a few minutes (e.g. during reboot): ring shortly
          ring.put("at", at)
        } else {
          toRemove.add(id)
          continue
        }
      }
      toSet.add(Pair(id, at))
    }
    for (id in toRemove) all.remove(id)
    store(ctx, all)
    for ((id, at) in toSet) setAlarm(ctx, id, at)
  }
}
