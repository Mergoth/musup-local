package com.musup.summary

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import jakarta.inject.Singleton
import org.slf4j.LoggerFactory
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

@Singleton
class MessageStore(private val config: SummaryConfig) {

    private val log = LoggerFactory.getLogger(MessageStore::class.java)
    private val mapper = jacksonObjectMapper()

    private val messagesDir: File get() = File(config.dataDir, "messages")
    private val processedFile: File get() = File(config.dataDir, "processed.json")

    // Persisted across digest runs for the lifetime of the process.
    // Loaded from disk on first access.
    private val processedIds: MutableSet<String> by lazy { loadProcessed() }

    fun loadMessages(
        fromTs: Long,
        toTs: Long,
        chatJids: List<String> = config.chatJids,
        chatLabels: Map<String, String> = config.chatLabels
    ): List<WhatsappMessage> {
        val fromDate = LocalDate.ofInstant(Instant.ofEpochSecond(fromTs), ZoneOffset.UTC)
        val toDate = LocalDate.ofInstant(Instant.ofEpochSecond(toTs), ZoneOffset.UTC)

        val result = mutableListOf<WhatsappMessage>()
        val dir = messagesDir

        if (!dir.exists()) {
            log.warn("Messages directory does not exist: {}", dir.absolutePath)
            return emptyList()
        }

        var date = fromDate
        while (!date.isAfter(toDate)) {
            val file = File(dir, "${date}.ndjson")
            if (file.exists()) {
                result += parseFile(file, fromTs, toTs, chatLabels)
            }
            date = date.plusDays(1)
        }

        val filtered = result
            .filter { it.messageId !in processedIds }
            .filter { chatJids.isEmpty() || it.chatJid in chatJids }
            .sortedBy { it.timestamp }

        log.info(
            "Loaded {} messages (window [{}, {}], skipped {} already processed)",
            filtered.size, fromTs, toTs, result.size - filtered.size
        )
        return filtered
    }

    fun markProcessed(ids: Collection<String>) {
        if (ids.isEmpty()) return
        processedIds.addAll(ids)
        saveProcessed()
        log.info("Marked {} message(s) as processed (total: {})", ids.size, processedIds.size)
    }

    private fun parseFile(file: File, fromTs: Long, toTs: Long, chatLabels: Map<String, String>): List<WhatsappMessage> {
        val messages = mutableListOf<WhatsappMessage>()

        file.forEachLine { line ->
            val trimmed = line.trim()
            if (trimmed.isEmpty()) return@forEachLine

            try {
                val node = mapper.readTree(trimmed)
                val timestamp = node.path("timestamp").asLong(0)
                if (timestamp < fromTs || timestamp >= toTs) return@forEachLine

                val text = node.path("text").asText("").trim()
                if (text.isBlank()) return@forEachLine

                val messageId = node.path("messageId").asText("")
                if (messageId.isBlank()) return@forEachLine

                val chatJid = node.path("chatJid").asText("")
                val chatName = node.path("chatName").asText(chatJid)
                val chatLabel = chatLabels[chatJid] ?: chatName

                messages += WhatsappMessage(
                    messageId = messageId,
                    chatJid = chatJid,
                    chatLabel = chatLabel,
                    senderJid = node.path("senderJid").takeUnless { it.isNull }?.asText(),
                    fromMe = node.path("fromMe").asBoolean(false),
                    timestamp = timestamp,
                    messageDateUtc = Instant.ofEpochSecond(timestamp).toString(),
                    messageType = node.path("messageType").asText("unknown"),
                    text = text
                )
            } catch (e: Exception) {
                log.warn("Failed to parse NDJSON line in {}: {}", file.name, e.message)
            }
        }

        return messages
    }

    private fun loadProcessed(): MutableSet<String> {
        val file = processedFile
        if (!file.exists()) return mutableSetOf()

        return try {
            val map: Map<String, Any> = mapper.readValue(file)
            map.keys.toMutableSet()
        } catch (e: Exception) {
            log.warn("Failed to load processed.json, starting fresh: {}", e.message)
            mutableSetOf()
        }
    }

    private fun saveProcessed() {
        try {
            processedFile.parentFile?.mkdirs()
            val map = processedIds.associateWith { true }
            mapper.writeValue(processedFile, map)
        } catch (e: Exception) {
            log.error("Failed to write processed.json: {}", e.message)
        }
    }
}
