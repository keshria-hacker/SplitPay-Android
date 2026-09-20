package com.splitpay.app.dialog

import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.Window
import android.view.WindowManager
import androidx.appcompat.app.AlertDialog
import androidx.core.graphics.drawable.toDrawable
import com.splitpay.app.R
import com.splitpay.app.databinding.DialogCustomBinding

/**
 * Reusable "pen & paper" styled popup builder (light + dark theme aware).
 *
 * Extracted from [com.splitpay.app.MainActivity] so dialogs have a single,
 * focused home. The builder is activity-independent: it only needs a
 * [Context] to inflate its layout, and an optional [onDismiss] hook so
 * callers can track dialog lifetime (e.g. the back-press exit dialog).
 *
 * Typical usage:
 * ```
 * showAppDialog(context) {
 *     setTitle("…"); setMessage("…"); setIcon("warn")
 *     setPositiveText("OK") { /* … */ }
 * }
 * ```
 */
class AppDialogBuilder(private val appContext: Context) {

    private var title: String? = null
    private var message: String? = null
    private var iconRes: Int? = null
    private var positiveText: String? = null
    private var negativeText: String? = null
    private var positiveAction: (() -> Unit)? = null
    private var negativeAction: (() -> Unit)? = null
    private var cancelledAction: (() -> Unit)? = null
    private var cancelable = true
    private var inputHint: String? = null
    private var inputPrefill: String? = null
    private var inputResult: ((String?) -> Unit)? = null

    // ── Fluent setters ─────────────────────────────────────────────────────

    fun setTitle(t: String) = apply { title = t }
    fun setMessage(m: String) = apply { message = m }
    fun setIcon(name: String) = apply { iconRes = iconFor(name) }
    fun setPositiveText(t: String) = apply { positiveText = t }
    fun setNegativeText(t: String) = apply { negativeText = t }
    fun setCancelable(c: Boolean) = apply { cancelable = c }
    fun onPositive(action: () -> Unit) = apply { positiveAction = action }
    fun onNegative(action: () -> Unit) = apply { negativeAction = action }
    fun onCancelled(action: () -> Unit) = apply { cancelledAction = action }

    /** Turn the popup into an input dialog: shows an EditText and reports the text back. */
    fun showWithInput(hint: String, prefill: String, result: (String?) -> Unit) =
        apply {
            inputHint = hint
            inputPrefill = prefill
            inputResult = result
        }

    // ── Build & show ───────────────────────────────────────────────────────

    /**
     * Inflates `dialog_custom.xml`, wires visibility for every optional part
     * (title / icon / message / input / buttons) and shows the dialog.
     * [onDismiss] fires on every dismissal path (button, cancel, back).
     */
    fun show(onDismiss: (() -> Unit)? = null): Dialog {
        val dlgBinding = DialogCustomBinding.inflate(LayoutInflater.from(appContext))

        // Title — hidden entirely when blank so the card stays compact.
        if (title.isNullOrBlank()) {
            dlgBinding.dlgTitle.visibility = View.GONE
        } else {
            dlgBinding.dlgTitle.visibility = View.VISIBLE
            dlgBinding.dlgTitle.text = title
        }

        // Icon badge — hidden when no icon was requested.
        if (iconRes == null) {
            dlgBinding.dlgIconBadge.visibility = View.GONE
        } else {
            dlgBinding.dlgIconBadge.visibility = View.VISIBLE
            dlgBinding.dlgIcon.setImageResource(iconRes!!)
            dlgBinding.dlgIcon.setColorFilter(
                androidx.core.content.ContextCompat.getColor(appContext, R.color.background)
            )
        }

        // Message body.
        if (message.isNullOrBlank()) {
            dlgBinding.dlgMessage.visibility = View.GONE
        } else {
            dlgBinding.dlgMessage.visibility = View.VISIBLE
            dlgBinding.dlgMessage.text = message
        }

        // Optional single-line input (used by the JS `prompt()` replacement).
        val hasInput = inputResult != null
        if (hasInput) {
            dlgBinding.dlgInput.visibility = View.VISIBLE
            dlgBinding.dlgInput.hint = inputHint
            dlgBinding.dlgInput.setText(inputPrefill ?: "")
        }

        // Buttons — hide whichever is missing and remove the orphan margin so
        // the remaining button stretches cleanly.
        if (negativeText.isNullOrBlank()) {
            dlgBinding.dlgNegative.visibility = View.GONE
            (dlgBinding.dlgPositive.layoutParams as? android.widget.LinearLayout.LayoutParams)
                ?.marginStart = 0
        } else {
            dlgBinding.dlgNegative.visibility = View.VISIBLE
            dlgBinding.dlgNegative.text = negativeText
        }
        if (positiveText.isNullOrBlank()) {
            dlgBinding.dlgPositive.visibility = View.GONE
            (dlgBinding.dlgNegative.layoutParams as? android.widget.LinearLayout.LayoutParams)
                ?.marginEnd = 0
        } else {
            dlgBinding.dlgPositive.visibility = View.VISIBLE
            dlgBinding.dlgPositive.text = positiveText
        }

        // When there is no icon the title needs its leading margin removed.
        if (iconRes == null) {
            (dlgBinding.dlgTitle.layoutParams as? android.widget.LinearLayout.LayoutParams)
                ?.marginStart = 0
        }

        var answered = false

        val dialog = Dialog(appContext)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.setCanceledOnTouchOutside(cancelable)
        dialog.setCancelable(cancelable)

        // One unified dismissal listener covers cancel-outside, back press and
        // button clicks. Buttons set `answered` first so a cancelled dialog
        // that already reported a result does not report `null` afterwards.
        dialog.setOnCancelListener {
            if (!answered) {
                if (hasInput) inputResult?.invoke(null)
                cancelledAction?.invoke()
            }
        }
        dialog.setOnDismissListener {
            onDismiss?.invoke()
            if (hasInput) {
                dialog.window?.setSoftInputMode(
                    WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED
                )
            }
        }

        dialog.setContentView(dlgBinding.root)
        dialog.show()

        // Center the card at ~88% width, capped at 420dp.
        dialog.window?.let { win ->
            win.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
            win.setGravity(Gravity.CENTER)
            val maxPx = (420 * appContext.resources.displayMetrics.density).toInt()
            val wPx = (appContext.resources.displayMetrics.widthPixels * 0.88f).toInt()
            win.setLayout(
                minOf(wPx, maxPx),
                WindowManager.LayoutParams.WRAP_CONTENT
            )
        }

        dlgBinding.dlgPositive.setOnClickListener {
            answered = true
            if (hasInput) inputResult?.invoke(dlgBinding.dlgInput.text.toString())
            positiveAction?.invoke()
            dialog.dismiss()
        }
        dlgBinding.dlgNegative.setOnClickListener {
            answered = true
            if (hasInput) inputResult?.invoke(null)
            negativeAction?.invoke()
            dialog.dismiss()
        }

        // Input dialogs start with the keyboard open so the user can type at once.
        if (hasInput) {
            dlgBinding.dlgInput.requestFocus()
            dialog.window?.setSoftInputMode(
                WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE
            )
        }

        return dialog
    }

    /** Maps a logical icon name (from JS or Kotlin callers) to a system drawable. */
    private fun iconFor(name: String): Int? = when (name.lowercase().trim()) {
        "exit", "logout", "power"      -> android.R.drawable.ic_menu_close_clear_cancel
        "warn", "warning", "error"     -> android.R.drawable.ic_dialog_alert
        "question", "confirm", "help"  -> android.R.drawable.ic_menu_help
        "info", "about"                -> android.R.drawable.ic_dialog_info
        "upi", "pay", "money", "card"  -> android.R.drawable.ic_menu_manage
        "rate", "star"                 -> android.R.drawable.btn_star_big_on
        else                           -> android.R.drawable.ic_dialog_info
    }
}

/** Entry point used everywhere a custom popup is needed. */
fun showAppDialog(
    context: Context,
    onDismiss: (() -> Unit)? = null,
    configure: AppDialogBuilder.() -> Unit
): Dialog = AppDialogBuilder(context).apply(configure).show(onDismiss)

/**
 * Last-resort popup when the custom dialog system itself throws
 * (e.g. during activity teardown). Falls back to a plain AlertDialog,
 * then to a toast.
 */
fun showFallbackDialog(activity: Activity, title: String, message: String, onYes: () -> Unit) {
    try {
        AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton(activity.getString(R.string.yes)) { _, _ -> onYes() }
            .setNegativeButton(activity.getString(R.string.no), null)
            .setCancelable(true)
            .show()
    } catch (e: Exception) {
        android.widget.Toast.makeText(activity, "$title — $message", android.widget.Toast.LENGTH_LONG).show()
    }
}
