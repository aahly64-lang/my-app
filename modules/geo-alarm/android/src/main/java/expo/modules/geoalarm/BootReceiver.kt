package expo.modules.geoalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      RingScheduler.rescheduleAll(context)
    } catch (e: Exception) {
      // Never crash on boot.
    }
  }
}
