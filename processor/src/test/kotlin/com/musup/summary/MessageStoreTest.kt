package com.musup.summary

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class MessageStoreTest {

    private lateinit var config: SummaryConfig
    private lateinit var mapper: ObjectMapper
    private lateinit var store: MessageStore

    @TempDir
    lateinit var tempDir: File

    @BeforeEach
    fun setup() {
        config = SummaryConfig()
        config.dataDir = tempDir.absolutePath
        mapper = jacksonObjectMapper()
        store = MessageStore(config, mapper)
    }

    @Test
    fun `test loading messages from file filters and sorts`() {
        // Arrange
        val messagesDir = File(tempDir, "messages").apply { mkdirs() }
        val dateFile = File(messagesDir, "2026-06-06.ndjson")
        
        // Write some raw logs (one line per message)
        dateFile.writeText("""
            {"messageId":"m1","chatJid":"g1@g.us","chatName":"Group 1","senderJid":"s1@s.w.n","fromMe":false,"timestamp":1780760000,"messageType":"conversation","text":"First Message"}
            {"messageId":"m2","chatJid":"g2@g.us","chatName":"Group 2","senderJid":"s2@s.w.n","fromMe":true,"timestamp":1780760100,"messageType":"extendedTextMessage","text":"Second Message"}
            {"messageId":"m3","chatJid":"g1@g.us","chatName":"Group 1","senderJid":"s1@s.w.n","fromMe":false,"timestamp":1780760200,"messageType":"conversation","text":"Third Message"}
        """.trimIndent())

        // Act
        val messages = store.loadMessages(
            fromTs = 1780750000L,
            toTs = 1780770000L,
            chatJids = listOf("g1@g.us", "g2@g.us")
        )

        // Assert
        assertEquals(3, messages.size)
        assertEquals("m1", messages[0].messageId)
        assertEquals("m2", messages[1].messageId)
        assertEquals("m3", messages[2].messageId)
        assertEquals("First Message", messages[0].text)
        assertEquals("Group 1", messages[0].chatLabel)
    }

    @Test
    fun `test filtering by specific JIDs`() {
        val messagesDir = File(tempDir, "messages").apply { mkdirs() }
        val dateFile = File(messagesDir, "2026-06-06.ndjson")
        dateFile.writeText("""
            {"messageId":"m1","chatJid":"g1@g.us","chatName":"Group 1","senderJid":"s1@s.w.n","fromMe":false,"timestamp":1780760000,"messageType":"conversation","text":"First Message"}
            {"messageId":"m2","chatJid":"g2@g.us","chatName":"Group 2","senderJid":"s2@s.w.n","fromMe":true,"timestamp":1780760100,"messageType":"extendedTextMessage","text":"Second Message"}
        """.trimIndent())

        val messages = store.loadMessages(
            fromTs = 1780750000L,
            toTs = 1780770000L,
            chatJids = listOf("g1@g.us")
        )

        assertEquals(1, messages.size)
        assertEquals("m1", messages[0].messageId)
    }

    @Test
    fun `test filtering out already processed messages`() {
        val messagesDir = File(tempDir, "messages").apply { mkdirs() }
        val dateFile = File(messagesDir, "2026-06-06.ndjson")
        dateFile.writeText("""
            {"messageId":"m1","chatJid":"g1@g.us","chatName":"Group 1","senderJid":"s1@s.w.n","fromMe":false,"timestamp":1780760000,"messageType":"conversation","text":"First Message"}
            {"messageId":"m2","chatJid":"g2@g.us","chatName":"Group 2","senderJid":"s2@s.w.n","fromMe":true,"timestamp":1780760100,"messageType":"extendedTextMessage","text":"Second Message"}
        """.trimIndent())

        // Mark m1 as processed
        store.markProcessed(listOf("m1"))

        val messages = store.loadMessages(
            fromTs = 1780750000L,
            toTs = 1780770000L,
            chatJids = listOf("g1@g.us", "g2@g.us")
        )

        assertEquals(1, messages.size)
        assertEquals("m2", messages[0].messageId)
    }
}
