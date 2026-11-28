package expo.modules.geoalarm

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.text.InputType
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AlarmActivity : Activity() {
  private val handler = Handler(Looper.getMainLooper())
  private var ring: JSONObject = JSONObject()
  private var actions: LinearLayout? = null
  private var sensorManager: SensorManager? = null
  private var shakeListener: SensorEventListener? = null
  private var tts: TextToSpeech? = null
  private var finishing = false

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

    ring = try {
      JSONObject(intent?.getStringExtra(AlarmNotifier.EXTRA_RING) ?: "{}")
    } catch (e: Exception) {
      JSONObject()
    }
    val title = ring.optString("title", "שעון מעורר")
    val body = ring.optString("body", "")

    setContentView(buildLayout(title, body))

    val duration = ring.optLong("durationMs", AlarmNotifier.DEFAULT_DURATION_MS)
    handler.postDelayed({ stopAndClose() }, if (duration > 0) duration else AlarmNotifier.DEFAULT_DURATION_MS)
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
      text = when (ring.optString("kind")) {
        "geo" -> "📍"
        "timer" -> "⏱️"
        "reminder" -> "📝"
        else -> "⏰"
      }
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
      setOnClickListener { onStopPressed() }
    }
    val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(96)).apply {
      topMargin = dp(56)
    }
    val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    actions = box
    root.addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    box.addView(stop, params)

    if (AlarmNotifier.canSnooze(ring)) {
      val snooze = Button(this).apply {
        text = "נודניק " + ring.optInt("snoozeMin") + " דק'"
        setTextColor(Color.parseColor("#0F172A"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        typeface = Typeface.DEFAULT_BOLD
        isAllCaps = false
        background = GradientDrawable().apply {
          setColor(Color.parseColor("#FACC15"))
          cornerRadius = dp(40).toFloat()
        }
        setOnClickListener { snoozeAndClose() }
      }
      val sp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(80)).apply {
        topMargin = dp(20)
      }
      box.addView(snooze, sp)
    }

    return root
  }

  private fun snoozeButton(): Button? {
    if (!AlarmNotifier.canSnooze(ring)) return null
    return Button(this).apply {
      text = "נודניק " + ring.optInt("snoozeMin") + " דק'"
      setTextColor(Color.parseColor("#0F172A"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      typeface = Typeface.DEFAULT_BOLD
      isAllCaps = false
      background = GradientDrawable().apply {
        setColor(Color.parseColor("#FACC15"))
        cornerRadius = dp(40).toFloat()
      }
      setOnClickListener { snoozeAndClose() }
    }
  }

  private fun label(text: String, sizeSp: Float, color: String = "#E2E8F0"): TextView =
    TextView(this).apply {
      this.text = text
      setTextColor(Color.parseColor(color))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
      gravity = Gravity.CENTER
      setPadding(0, dp(10), 0, dp(10))
    }

  private fun bigButton(text: String, color: String, onClick: () -> Unit): Button =
    Button(this).apply {
      this.text = text
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
      typeface = Typeface.DEFAULT_BOLD
      isAllCaps = false
      background = GradientDrawable().apply {
        setColor(Color.parseColor(color))
        cornerRadius = dp(44).toFloat()
      }
      setOnClickListener { onClick() }
    }

  /** Replaces the buttons area; the snooze button (if any) stays at the bottom. */
  private fun setActions(views: List<android.view.View>, withSnooze: Boolean) {
    val box = actions ?: return
    box.removeAllViews()
    for (v in views) {
      val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
      if (v is Button) { lp.height = dp(84); lp.topMargin = dp(16) }
      box.addView(v, lp)
    }
    if (withSnooze) {
      snoozeButton()?.let {
        box.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(72)).apply { topMargin = dp(20) })
      }
    }
  }

  // ---------- stopping: optional challenge, then optional read-aloud ----------

  private fun onStopPressed() {
    val challenge = if (ring.optString("kind") == "alarm") ring.optString("challenge", "none") else "none"
    when (challenge) {
      "math" -> showMath(null)
      "shake" -> showShake()
      else -> afterStop()
    }
  }

  private fun showMath(message: String?) {
    val rnd = java.util.Random()
    val a = 12 + rnd.nextInt(38)
    val b = 12 + rnd.nextInt(38)
    val question = label("כמה זה  $a + $b ?", 34f, "#FFFFFF").apply { typeface = Typeface.DEFAULT_BOLD }
    val input = EditText(this).apply {
      inputType = InputType.TYPE_CLASS_NUMBER
      setTextColor(Color.WHITE)
      setHintTextColor(Color.parseColor("#94A3B8"))
      hint = "התשובה"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
      gravity = Gravity.CENTER
      background = GradientDrawable().apply {
        setColor(Color.parseColor("#1E293B"))
        cornerRadius = dp(16).toFloat()
      }
      setPadding(dp(12), dp(12), dp(12), dp(12))
    }
    val ok = bigButton("אישור", "#16A34A") {
      if (input.text.toString().trim().toIntOrNull() == a + b) afterStop()
      else showMath("לא נכון, נסה שוב")
    }
    val views = ArrayList<android.view.View>()
    views.add(label(message ?: "כדי לעצור, פתור את התרגיל", 18f, if (message != null) "#F87171" else "#E2E8F0"))
    views.add(question)
    views.add(input)
    views.add(ok)
    setActions(views, true)
    input.requestFocus()
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
  }

  private fun showShake() {
    val sm = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    val accel = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    if (sm == null || accel == null) {
      showMath(null) // no motion sensor: fall back to the exercise
      return
    }
    val needed = 15
    var count = 0
    var lastAt = 0L
    val progress = label("נער את הטלפון חזק: 0 / $needed", 26f, "#FFFFFF").apply { typeface = Typeface.DEFAULT_BOLD }
    setActions(listOf(label("כדי לעצור, נער את הטלפון", 18f), progress), true)
    val listener = object : SensorEventListener {
      override fun onSensorChanged(e: SensorEvent) {
        val x = e.values[0]; val y = e.values[1]; val z = e.values[2]
        val g = Math.sqrt((x * x + y * y + z * z).toDouble()) / SensorManager.GRAVITY_EARTH
        val now = System.currentTimeMillis()
        if (g > 1.9 && now - lastAt > 250) {
          lastAt = now
          count++
          progress.text = "נער את הטלפון חזק: $count / $needed"
          if (count >= needed) {
            sm.unregisterListener(this)
            shakeListener = null
            afterStop()
          }
        }
      }
      override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }
    shakeListener = listener
    sensorManager = sm
    sm.registerListener(listener, accel, SensorManager.SENSOR_DELAY_GAME)
  }

  private fun afterStop() {
    if (ring.optString("kind") == "alarm" && ring.optBoolean("speak", false)) speakThenClose() else stopAndClose()
  }

  private fun speakThenClose() {
    AlarmNotifier.stop(this)
    handler.removeCallbacksAndMessages(null)
    val text = WakeSpeech.text(this)
    val status = label("🔊", 40f)
    setActions(listOf(status, label(text, 20f, "#FFFFFF"), bigButton("סגור", "#334155") { closeNow() }), false)
    handler.postDelayed({ closeNow() }, 90_000L)
    // The init callback can come before the constructor returns, so continue on the next loop turn.
    tts = TextToSpeech(this) { st -> handler.post { onTtsReady(st, text, status) } }
  }

  private fun onTtsReady(st: Int, text: String, status: TextView) {
    run {
      val engine = tts
      if (finishing) return
      if (st != TextToSpeech.SUCCESS || engine == null) {
        status.text = "לא ניתן להקריא בטלפון הזה"
        return
      }
      var lang = engine.setLanguage(Locale("he", "IL"))
      if (lang < TextToSpeech.LANG_AVAILABLE) lang = engine.setLanguage(Locale("iw", "IL"))
      if (lang < TextToSpeech.LANG_AVAILABLE) {
        status.text = "אין בטלפון קול בעברית להקראה"
        return
      }
      try {
        engine.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
      } catch (e: Exception) {
      }
      engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String?) {}
        override fun onDone(id: String?) { handler.postDelayed({ closeNow() }, 2500L) }
        @Deprecated("Deprecated in Java")
        override fun onError(id: String?) {}
      })
      engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "wake")
    }
  }

  private fun closeNow() {
    if (finishing) return
    finishing = true
    finish()
  }

  private fun snoozeAndClose() {
    try { RingScheduler.snooze(this, ring) } catch (e: Exception) {}
    stopAndClose()
  }

  private fun stopAndClose() {
    AlarmNotifier.stop(this)
    finish()
  }

  override fun onBackPressed() {
    // Back does nothing: the alarm is stopped only with the button (or after its time runs out).
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    shakeListener?.let { sensorManager?.unregisterListener(it) }
    shakeListener = null
    try { tts?.stop(); tts?.shutdown() } catch (e: Exception) {}
    tts = null
    if (current?.get() === this) current = null
    super.onDestroy()
  }
}
