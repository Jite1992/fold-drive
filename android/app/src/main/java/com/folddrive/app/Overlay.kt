package com.folddrive.app

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

/** Small draggable stats bubble shown over Google Maps while a trip is recorded. Tap it to open Fold Drive. */
class Overlay(private val ctx: Context) {
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private var root: LinearLayout? = null
    private lateinit var speed: TextView
    private lateinit var line1: TextView
    private lateinit var line2: TextView

    private fun dp(v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

    private val lp = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = 24
        y = 420
    }

    @SuppressLint("ClickableViewAccessibility")
    fun show() {
        if (root != null) return
        val box = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(14), dp(8))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#EB0D1117"))
                cornerRadius = dp(20).toFloat()
                setStroke(dp(1), Color.parseColor("#F5A524"))
            }
        }
        val sp = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, 0, dp(12), 0)
        }
        speed = TextView(ctx).apply { setTextColor(Color.WHITE); textSize = 26f; typeface = Typeface.DEFAULT_BOLD }
        val unit = TextView(ctx).apply { setTextColor(Color.parseColor("#9AA6B4")); textSize = 10f; text = "KM/H" }
        sp.addView(speed); sp.addView(unit)
        val texts = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        line1 = TextView(ctx).apply {
            setTextColor(Color.parseColor("#F5A524")); textSize = 13f; typeface = Typeface.DEFAULT_BOLD
            maxLines = 2; ellipsize = TextUtils.TruncateAt.END; maxWidth = dp(240)
        }
        line2 = TextView(ctx).apply {
            setTextColor(Color.parseColor("#C9D2DC")); textSize = 12f; maxLines = 1
            ellipsize = TextUtils.TruncateAt.END; maxWidth = dp(240)
        }
        texts.addView(line1); texts.addView(line2)
        box.addView(sp); box.addView(texts)

        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var moved = false
        box.setOnTouchListener { v, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y; moved = false; true }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    if (abs(dx) > 12 || abs(dy) > 12) moved = true
                    lp.x = startX + dx.toInt(); lp.y = startY + dy.toInt()
                    try { wm?.updateViewLayout(v, lp) } catch (_: Exception) { }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) {
                        ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                    }
                    true
                }
                else -> false
            }
        }
        try {
            wm?.addView(box, lp)
            root = box
        } catch (_: Exception) {
            root = null
        }
    }

    fun update(spd: String, l1: String, l2: String) {
        if (root == null) return
        speed.text = spd
        line1.text = l1
        line2.text = l2
    }

    fun hide() {
        root?.let { try { wm?.removeView(it) } catch (_: Exception) { } }
        root = null
    }
}
