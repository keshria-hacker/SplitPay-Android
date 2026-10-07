package com.splitpay.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UpiResponseParserTest {
    @Test
    fun parsesCaseInsensitiveStatusAndTransactionFields() {
        val result = UpiResponseParser.parse(
            "Status=SUCCESS&txnId=abc123&ApprovalRefNo=ref-7&message=Approved"
        )

        assertEquals("SUCCESS", result.status)
        assertEquals("abc123", result.transactionId)
        assertEquals("ref-7", result.approvalReference)
        assertEquals("Approved", result.message)
    }

    @Test
    fun handlesMissingOrEmptyResponses() {
        val result = UpiResponseParser.parse(null)

        assertNull(result.status)
        assertNull(result.transactionId)
        assertNull(result.approvalReference)
        assertNull(result.message)
    }
}
