package com.musup.summary

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.inject.Singleton
import org.slf4j.LoggerFactory
import java.io.File

@Singleton
class AdminConfigReader(
    private val config: SummaryConfig,
    private val mapper: ObjectMapper
) {

    private val log = LoggerFactory.getLogger(AdminConfigReader::class.java)

    fun read(): AdminConfig? {
        val file = File(config.dataDir, "config.json")
        if (!file.exists()) return null
        return try {
            mapper.readValue(file, AdminConfig::class.java)
        } catch (e: Exception) {
            log.warn("Failed to read admin config.json: {}", e.message)
            null
        }
    }
}
