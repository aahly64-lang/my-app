package expo.modules.geoalarm

import android.content.Context
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * What an alarm reads aloud after it is stopped: a greeting, the day and time, and today's open tasks.
 * The app writes the tasks per day ("agenda") whenever they change, so it works while the app is closed.
 */
object WakeSpeech {
  private const val PREFS = "geo_alarm_agenda_v1"
  private const val KEY = "agenda"
  private val DAY_NAMES = arrayOf("ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת")

  fun saveAgenda(ctx: Context, json: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
  }

  fun text(ctx: Context): String {
    val now = Calendar.getInstance()
    val hour = now.get(Calendar.HOUR_OF_DAY)
    val greeting = when (hour) {
      in 5..11 -> "בוקר טוב"
      in 12..16 -> "צהריים טובים"
      in 17..20 -> "ערב טוב"
      else -> "לילה טוב"
    }
    val out = StringBuilder()
    out.append(greeting).append(". ")
    out.append("היום יום ").append(DAY_NAMES[now.get(Calendar.DAY_OF_WEEK) - 1]).append(". ")
    out.append("השעה ").append(SimpleDateFormat("H:mm", Locale.US).format(Date())).append(". ")
    try {
      val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
      val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
      val day = if (raw != null) JSONObject(raw).optJSONObject(today) else null
      val count = day?.optInt("count", 0) ?: 0
      if (raw == null) {
        // The app hasn't saved the tasks yet: say nothing about them.
      } else if (count == 0) {
        out.append("אין לך משימות להיום.")
      } else {
        out.append(if (count == 1) "יש לך היום משימה אחת" else "יש לך היום $count משימות")
        val late = day!!.optInt("late", 0)
        if (late > 0) out.append(if (late == 1) ", אחת מהן באיחור" else ", $late מהן באיחור")
        val titles = day.optJSONArray("titles")
        if (titles != null && titles.length() > 0) {
          out.append(": ")
          for (i in 0 until titles.length()) {
            if (i > 0) out.append(if (i == titles.length() - 1 && count == titles.length()) " ו" else ", ")
            out.append(titles.optString(i))
          }
          if (count > titles.length()) out.append(", ועוד ").append(count - titles.length())
        }
        out.append(".")
      }
    } catch (e: Exception) {
    }
    return out.toString()
  }
}
