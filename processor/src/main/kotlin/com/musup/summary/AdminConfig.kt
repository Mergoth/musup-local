package com.musup.summary

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

@JsonIgnoreProperties(ignoreUnknown = true)
data class AdminConfig(
    val allowedChatJids: List<String> = emptyList(),
    val processorChatJids: List<String> = emptyList(),
    val chatLabels: Map<String, String> = emptyMap(),
    val telegramChatIds: List<String> = emptyList(),
    val digestCron: String? = null
)
