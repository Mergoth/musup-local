package com.musup.summary

import io.micronaut.http.HttpResponse
import io.micronaut.http.annotation.Controller
import io.micronaut.http.annotation.Post
import io.micronaut.scheduling.TaskExecutors
import io.micronaut.scheduling.annotation.ExecuteOn
import org.slf4j.LoggerFactory

@Controller("/jobs")
@ExecuteOn(TaskExecutors.BLOCKING)
class DigestController(private val scheduler: DigestScheduler) {

    private val log = LoggerFactory.getLogger(DigestController::class.java)

    @Post("/whatsapp-summary")
    fun trigger(): HttpResponse<DigestResult> {
        log.info("Manual digest trigger via HTTP")
        val result = scheduler.runDigest()
        return HttpResponse.ok(result)
    }
}
