package expo.modules.geoalarm

import android.icu.util.HebrewCalendar
import java.util.Calendar

/** Israeli holidays (days off) from the Hebrew calendar built into Android – no internet or library. */
object Holidays {
  /** Hebrew name of the holiday on the local day of [at], or "". */
  fun nameAt(at: Long): String {
    return try {
      val local = Calendar.getInstance().apply { timeInMillis = at }
      val hc = HebrewCalendar()
      hc.timeInMillis = at
      val month = hc.get(android.icu.util.Calendar.MONTH)
      val day = hc.get(android.icu.util.Calendar.DAY_OF_MONTH)
      when (month) {
        HebrewCalendar.TISHREI -> when (day) {
          1, 2 -> "ראש השנה"
          10 -> "יום כיפור"
          15 -> "סוכות"
          22 -> "שמחת תורה"
          else -> ""
        }
        HebrewCalendar.NISAN -> when (day) {
          15 -> "פסח"
          21 -> "שביעי של פסח"
          else -> ""
        }
        HebrewCalendar.SIVAN -> if (day == 6) "שבועות" else ""
        HebrewCalendar.IYAR -> if (day in 3..6 && day == independenceDay(local.get(Calendar.DAY_OF_WEEK), day)) "יום העצמאות" else ""
        else -> ""
      }
    } catch (e: Exception) {
      ""
    }
  }

  /** Day in Iyar on which Independence Day is kept that year (moved off Friday/Saturday/Monday). */
  private fun independenceDay(dowToday: Int, dayToday: Int): Int {
    // Day of week (1 = Sunday ... 7 = Saturday) of 5 Iyar.
    val dow5 = ((dowToday - 1 + (5 - dayToday)) % 7 + 7) % 7 + 1
    return when (dow5) {
      Calendar.FRIDAY -> 4
      Calendar.SATURDAY -> 3
      Calendar.MONDAY -> 6
      else -> 5
    }
  }
}
