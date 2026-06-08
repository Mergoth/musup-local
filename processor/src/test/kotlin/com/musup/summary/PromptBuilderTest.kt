package com.musup.summary

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.time.Instant

class PromptBuilderTest {

    @Test
    fun `test buildPrompt formats correctly`() {
        // Arrange
        val config = SummaryConfig()
        val builder = PromptBuilder(config)

        val from = Instant.parse("2026-06-06T00:00:00Z")
        val to = Instant.parse("2026-06-06T12:00:00Z")

        val messages = listOf(
            WhatsappMessage(
                messageId = "m1",
                chatJid = "g1@g.us",
                chatLabel = "Group One",
                senderJid = "s1@s.w.n",
                fromMe = false,
                timestamp = 1780760000L,
                messageDateUtc = "2026-06-06T11:00:00Z",
                messageType = "conversation",
                text = "Hello everybody"
            ),
            WhatsappMessage(
                messageId = "m2",
                chatJid = "g1@g.us",
                chatLabel = "Group One",
                senderJid = null,
                fromMe = true,
                timestamp = 1780760100L,
                messageDateUtc = "2026-06-06T11:01:00Z",
                messageType = "conversation",
                text = "Hi there"
            )
        )

        // Act
        val prompt = builder.buildPrompt(messages, from, to)

        // Assert
        assertTrue(prompt.contains("Ты анализируешь мои личные WhatsApp-сообщения"))
        assertTrue(prompt.contains("=== Чат: Group One ==="))
        assertTrue(prompt.contains("[2026-06-06T11:00:00Z] s1@s.w.n: Hello everybody"))
        assertTrue(prompt.contains("[2026-06-06T11:01:00Z] Я: Hi there"))
    }
}


