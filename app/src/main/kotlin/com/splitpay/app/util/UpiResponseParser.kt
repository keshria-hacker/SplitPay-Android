package com.splitpay.app.util

/** Parsed fields returned by a UPI app after an intent payment. */
data class ParsedUpiResponse(
    val status: String?,
    val transactionId: String?,
    val approvalReference: String?,
    val message: String?,
)

object UpiResponseParser {
    fun parse(response: String?): ParsedUpiResponse {
        val fields = response.orEmpty()
            .split('&')
            .mapNotNull {
                val separator = it.indexOf('=')
                if (separator <= 0) null
                else it.substring(0, separator).trim().lowercase() to
                    it.substring(separator + 1).trim()
            }
            .toMap()

        fun field(vararg names: String): String? =
            names.firstNotNullOfOrNull { fields[it.lowercase()] }

        return ParsedUpiResponse(
            status = field("status")?.uppercase(),
            transactionId = field("txnid", "transactionid"),
            approvalReference = field("approvalrefno", "approvalrefno"),
            message = field("message", "msg"),
        )
    }
}
