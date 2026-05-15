package com.musup.summary

import io.micronaut.context.annotation.ConfigurationProperties

@ConfigurationProperties("musup")
open class SummaryConfig {

    var dataDir: String = "/data"

    var llmApiUrl: String = "https://api.openai.com/v1/chat/completions"
    var llmModel: String = "gpt-4o-mini"
    var llmApiKey: String = ""

    // Quartz cron (6 fields: second minute hour dom month dow)
    // Default: 06:00 and 19:00 UTC = 08:00 and 21:00 Madrid (CET+1/CEST+2)
    var digestCron: String = "0 0 6,19 * * ?"
    var digestWindowHours: Long = 13

    var telegramBotToken: String? = null
    var telegramChatIds: List<String> = emptyList()

    var chatJids: List<String> = emptyList()

    var chatLabelsCsv: String = ""
        set(value) {
            field = value
            chatLabels = value.split(",")
                .filter { it.contains("=") }
                .associate {
                    val (k, v) = it.split("=", limit = 2)
                    k.trim() to v.trim()
                }
        }

    var chatLabels: Map<String, String> = emptyMap()
        private set
}
