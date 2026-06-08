package com.musup.summary

import io.micronaut.scheduling.TaskScheduler
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.kotlin.*
import java.util.concurrent.ScheduledFuture

class DigestSchedulerTest {

    private lateinit var config: SummaryConfig
    private lateinit var messageStore: MessageStore
    private lateinit var promptBuilder: PromptBuilder
    private lateinit var llmClient: LlmClient
    private lateinit var telegramClient: TelegramClient
    private lateinit var adminConfigReader: AdminConfigReader
    private lateinit var taskScheduler: TaskScheduler
    private lateinit var scheduler: DigestScheduler

    @BeforeEach
    fun setup() {
        config = SummaryConfig().apply {
            digestCron = "0 0 6,17 * * ?"
        }
        messageStore = mock()
        promptBuilder = mock()
        llmClient = mock()
        telegramClient = mock()
        adminConfigReader = mock()
        taskScheduler = mock()

        scheduler = DigestScheduler(
            config,
            messageStore,
            promptBuilder,
            llmClient,
            telegramClient,
            adminConfigReader,
            taskScheduler
        )
    }

    @Test
    fun `test rescheduleIfNeeded handles changes correctly`() {
        val mockFuture = mock<ScheduledFuture<*>>()
        val adminConfig = AdminConfig(digestCron = "0 0 12 * * ?")
        whenever(adminConfigReader.read()).thenReturn(adminConfig)
        whenever(taskScheduler.schedule(any<String>(), any<Runnable>())).thenReturn(mockFuture)

        scheduler.rescheduleIfNeeded()

        verify(taskScheduler).schedule(eq("0 0 12 * * ?"), any())
        clearInvocations(taskScheduler)

        scheduler.rescheduleIfNeeded()

        verify(taskScheduler, never()).schedule(any<String>(), any())
    }

    @Test
    fun `test rescheduleIfNeeded falls back on invalid cron`() {
        val mockFuture = mock<ScheduledFuture<*>>()
        val adminConfig = AdminConfig(digestCron = "invalid-cron")
        whenever(adminConfigReader.read()).thenReturn(adminConfig)
        whenever(taskScheduler.schedule(any<String>(), any<Runnable>())).thenReturn(mockFuture)

        scheduler.rescheduleIfNeeded()

        verify(taskScheduler).schedule(eq("0 0 6,17 * * ?"), any())
    }
}
