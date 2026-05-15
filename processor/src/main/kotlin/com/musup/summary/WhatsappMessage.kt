package com.musup.summary

data class WhatsappMessage(
    val messageId: String,
    val chatJid: String,
    val chatLabel: String,
    val senderJid: String?,
    val fromMe: Boolean,
    val timestamp: Long,
    val messageDateUtc: String,
    val messageType: String,
    val text: String
)
