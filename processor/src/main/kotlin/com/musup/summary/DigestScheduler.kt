package com.musup.summary

import io.micronaut.scheduling.TaskScheduler
import io.micronaut.scheduling.annotation.Scheduled
import io.micronaut.serde.annotation.Serdeable
import jakarta.annotation.PostConstruct
import jakarta.inject.Singleton
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.concurrent.ScheduledFuture

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
    private val telegramClient: TelegramClient,
    private val adminConfigReader: AdminConfigReader,
    private val taskScheduler: TaskScheduler
) {

    private val log = LoggerFactory.getLogger(DigestScheduler::class.java)

    private var scheduledTask: ScheduledFuture<*>? = null
    private var activeCron: String? = null

    @PostConstruct
    fun init() {
        rescheduleIfNeeded()
    }

    @Scheduled(fixedDelay = "30s")
    fun pollConfig() {
        rescheduleIfNeeded()
    }

    fun rescheduleIfNeeded() {
        synchronized(this) {
            val adminCfg = adminConfigReader.read()
            val targetCron = adminCfg?.digestCron ?: config.digestCron

            if (targetCron == activeCron) {
                return
            }

            log.info("Digest schedule change detected: '{}' -> '{}'", activeCron, targetCron)

            try {
                // Validate cron
                io.micronaut.scheduling.cron.CronExpression.create(targetCron)

                val newScheduledTask = taskScheduler.schedule(targetCron) {
                    runScheduled()
                }
                scheduledTask?.cancel(true)
                scheduledTask = newScheduledTask
                activeCron = targetCron
                log.info("Successfully scheduled digest with cron: '{}'", targetCron)
            } catch (e: Exception) {
                log.error("Failed to schedule digest with cron '$targetCron': ${e.message}", e)
                if (activeCron == null) {
                    val fallbackCron = config.digestCron
                    log.warn("Falling back to default cron '$fallbackCron'")
                    try {
                        scheduledTask = taskScheduler.schedule(fallbackCron) {
                            runScheduled()
                        }
                        activeCron = fallbackCron
                    } catch (fe: Exception) {
                        log.error("Failed to schedule fallback digest", fe)
                    }
                }
            }
        }
    }

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

        val adminCfg = adminConfigReader.read()
        val effectiveChatJids = if (adminCfg != null) adminCfg.processorChatJids else config.chatJids
        val effectiveTelegramIds = if (adminCfg != null) adminCfg.telegramChatIds else config.telegramChatIds
        val effectiveChatLabels = if (adminCfg != null) adminCfg.chatLabels else config.chatLabels

        log.info("Running digest: window [{}, {}], chats={}", from, now, effectiveChatJids.size)

        val messages = messageStore.loadMessages(from.epochSecond, now.epochSecond, effectiveChatJids, effectiveChatLabels)

        if (messages.isEmpty()) {
            log.info("No new messages in window")
            return DigestResult(status = "no_messages", messageCount = 0, from = from.toString(), to = now.toString())
        }

        log.info("Found {} messages, building prompt", messages.size)
        val prompt = promptBuilder.buildPrompt(messages, from, now)
        val summary = llmClient.summarize(prompt)
        telegramClient.sendMessage(summary, effectiveTelegramIds)

        val ids = messages.map { it.messageId }.toSet()
        messageStore.markProcessed(ids)

        log.info("Digest complete: {} messages processed", messages.size)
        return DigestResult(status = "ok", messageCount = messages.size, from = from.toString(), to = now.toString())
    }
}
