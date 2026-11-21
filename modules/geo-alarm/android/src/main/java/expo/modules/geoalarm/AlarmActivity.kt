package expo.modules.geoalarm

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AlarmActivity : Activity() {
  private val handler = Handler(Looper.getMainLooper())

  companion object {
    private var current: WeakReference<AlarmActivity>? = null

    fun finishIfShowing() {
      current?.get()?.finish()
      current = null
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    current = WeakReference(this)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
      val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      keyguard.requestDismissKeyguard(this, null)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    val title = intent?.getStringExtra(AlarmNotifier.EXTRA_TITLE) ?: "התראת מיקום"
    val body = intent?.getStringExtra(AlarmNotifier.EXTRA_BODY) ?: ""

    setContentView(buildLayout(title, body))

    handler.postDelayed({ stopAndClose() }, AlarmNotifier.ALARM_DURATION_MS)
  }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

  private fun buildLayout(title: String, body: String): LinearLayout {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#0F172A"))
      setPadding(dp(28), dp(48), dp(28), dp(48))
      layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
    }

    val time = TextView(this).apply {
      text = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 72f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
    }
    root.addView(time)

    val icon = TextView(this).apply {
      text = "📍"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 48f)
      gravity = Gravity.CENTER
      setPadding(0, dp(16), 0, dp(8))
    }
    root.addView(icon)

    val titleView = TextView(this).apply {
      text = title
      setTextColor(Color.parseColor("#FACC15"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
    }
    root.addView(titleView)

    if (body.isNotBlank()) {
      val bodyView = TextView(this).apply {
        text = body
        setTextColor(Color.parseColor("#E2E8F0"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        gravity = Gravity.CENTER
        setPadding(0, dp(12), 0, 0)
      }
      root.addView(bodyView)
    }

    val stop = Button(this).apply {
      text = "עצור"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
      typeface = Typeface.DEFAULT_BOLD
      isAllCaps = false
      background = GradientDrawable().apply {
        setColor(Color.parseColor("#DC2626"))
        cornerRadius = dp(48).toFloat()
      }
      setOnClickListener { stopAndClose() }
    }
    val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(96)).apply {
      topMargin = dp(56)
    }
    root.addView(stop, params)

    return root
  }

  private fun stopAndClose() {
    AlarmNotifier.stop(this)
    finish()
  }

  override fun onBackPressed() {
    // Back does nothing: the alarm is stopped only with the button (or after 3 minutes).
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    if (current?.get() === this) current = null
    super.onDestroy()
  }
}
