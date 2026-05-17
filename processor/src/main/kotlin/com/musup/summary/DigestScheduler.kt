package com.musup.summary

import io.micronaut.scheduling.annotation.Scheduled
import io.micronaut.serde.annotation.Serdeable
import jakarta.inject.Singleton
import org.slf4j.LoggerFactory
import java.time.Instant

@Serdeable
data class DigestResult(
    val status: String,
    val messageCount: Int,
    val from: String,
    val to: String
)

@Singleton
open class DigestScheduler(
    private val config: SummaryConfig,
    private val messageStore: MessageStore,
    private val promptBuilder: PromptBuilder,
    private val llmClient: LlmClient,
    private val telegramClient: TelegramClient
) {

    private val log = LoggerFactory.getLogger(DigestScheduler::class.java)

    @Scheduled(cron = "\${musup.digest-cron}")
    fun runScheduled() {
        log.info("Scheduled digest triggered")
        try {
            runDigest()
        } catch (e: Exception) {
            log.error("Scheduled digest failed", e)
            try {
                telegramClient.sendMessage("⚠️ musup digest error: ${e.javaClass.simpleName}: ${e.message}")
            } catch (te: Exception) {
                log.error("Failed to send error notification to Telegram", te)
            }
        }
    }

    fun runDigest(): DigestResult {
        val now = Instant.now()
        val from = now.minusSeconds(config.digestWindowHours * 3600)

        log.info(
            "Running digest: window [{}, {}], chats={}",
            from, now, config.chatJids.size
        )

        val messages = messageStore.loadMessages(from.epochSecond, now.epochSecond)

        if (messages.isEmpty()) {
            log.info("No new messages in window")
            return DigestResult(
                status = "no_messages",
                messageCount = 0,
                from = from.toString(),
                to = now.toString()
            )
        }

        log.info("Found {} messages, building prompt", messages.size)
        val prompt = promptBuilder.buildPrompt(messages, from, now)
        val summary = llmClient.summarize(prompt)
        telegramClient.sendMessage(summary)

        val ids = messages.map { it.messageId }.toSet()
        messageStore.markProcessed(ids)

        log.info("Digest complete: {} messages processed", messages.size)
        return DigestResult(
            status = "ok",
            messageCount = messages.size,
            from = from.toString(),
            to = now.toString()
        )
    }
}
