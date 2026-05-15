package com.musup.summary

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import jakarta.inject.Singleton
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse.BodyHandlers

@Singleton
open class LlmClient(private val config: SummaryConfig) {

    private val log = LoggerFactory.getLogger(LlmClient::class.java)
    private val mapper = jacksonObjectMapper()
    private val httpClient = HttpClient.newHttpClient()

    fun summarize(prompt: String): String {
        log.info("Sending prompt to LLM (model={}, length={})", config.llmModel, prompt.length)

        val body = mapper.writeValueAsString(
            mapOf(
                "model" to config.llmModel,
                "messages" to listOf(
                    mapOf("role" to "user", "content" to prompt)
                ),
                "max_tokens" to 2048,
                "temperature" to 0.7
            )
        )

        val request = HttpRequest.newBuilder()
            .uri(URI.create(config.llmApiUrl))
            .header("Authorization", "Bearer ${config.llmApiKey}")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()

        val response = httpClient.send(request, BodyHandlers.ofString())

        if (response.statusCode() !in 200..299) {
            log.error("LLM API error: status={}, body={}", response.statusCode(), response.body())
            throw IllegalStateException(
                "LLM API failed: status=${response.statusCode()}, body=${response.body()}"
            )
        }

        val json = mapper.readTree(response.body())
        val text = json
            .path("choices")
            .firstOrNull()
            ?.path("message")
            ?.path("content")
            ?.asText()
            ?.trim()
            ?: ""

        if (text.isBlank()) {
            log.error("LLM response missing content: {}", response.body())
            throw IllegalStateException("LLM response does not contain text: ${response.body()}")
        }

        log.info("LLM response received (length={})", text.length)
        return text
    }
}
