package com.musup.summary

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import jakarta.inject.Singleton
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse.BodyHandlers

@Singleton
open class TelegramClient(private val config: SummaryConfig) {

    private val log = LoggerFactory.getLogger(TelegramClient::class.java)
    private val mapper = jacksonObjectMapper()
    private val httpClient = HttpClient.newHttpClient()

    fun sendMessage(text: String) = sendMessage(text, config.telegramChatIds)

    fun sendMessage(text: String, chatIds: List<String>) {
        val botToken = config.telegramBotToken
        if (botToken == null || chatIds.isEmpty()) {
            log.warn("Telegram bot token or chat IDs not configured — message not sent")
            return
        }
        val chunks = splitForTelegram(text, maxLength = 3900)
        log.info("Sending {} chunk(s) to {} Telegram recipient(s)", chunks.size, chatIds.size)
        for (chatId in chatIds) {
            for (chunk in chunks) {
                sendChunk(chunk, botToken, chatId)
            }
        }
    }

    private fun sendChunk(text: String, botToken: String, chatId: String) {
        val body = mapper.writeValueAsString(
            mapOf(
                "chat_id" to chatId,
                "text" to text,
                "parse_mode" to "HTML",
                "disable_web_page_preview" to true
            )
        )

        val request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.telegram.org/bot$botToken/sendMessage"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()

        val response = httpClient.send(request, BodyHandlers.ofString())

        if (response.statusCode() !in 200..299) {
            log.error("Telegram API failed for chatId={}: status={}", chatId, response.statusCode())
            throw IllegalStateException(
                "Telegram API failed for chatId=$chatId: status=${response.statusCode()}, body=${response.body()}"
            )
        }
    }

    private fun splitForTelegram(text: String, maxLength: Int): List<String> {
        if (text.length <= maxLength) return listOf(text)

        val chunks = mutableListOf<String>()
        var remaining = text.trim()

        while (remaining.length > maxLength) {
            val splitIndex = findSafeSplitIndex(remaining, maxLength)
            val chunk = remaining.substring(0, splitIndex).trim()
            if (chunk.isNotBlank()) chunks += chunk
            remaining = remaining.substring(splitIndex).trim()
        }

        if (remaining.isNotBlank()) chunks += remaining
        return chunks
    }

    private fun findSafeSplitIndex(text: String, maxLength: Int): Int {
        val candidate = text.substring(0, maxLength)

        val paragraphBreak = candidate.lastIndexOf("\n\n")
        if (paragraphBreak > maxLength * 0.5) return paragraphBreak

        val lineBreak = candidate.lastIndexOf("\n")
        if (lineBreak > maxLength * 0.5) return lineBreak

        val sentenceEnd = listOf(
            candidate.lastIndexOf(". "),
            candidate.lastIndexOf("! "),
            candidate.lastIndexOf("? ")
        ).maxOrNull() ?: -1

        if (sentenceEnd > maxLength * 0.5) return sentenceEnd + 1

        return maxLength
    }
}
