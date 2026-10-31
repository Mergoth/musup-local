import { config } from "../config.js";
import { appLogger } from "../appLogger.js";
import { runDigest } from "./digestService.js";
import { sendTelegramMessage } from "./telegramClient.js";
import { getSettings, recordEvent } from "../db/database.js";
import { setDigestNextScheduledAt } from "../runtimeState.js";

type CronSchedule = {
  seconds: number[];
  minutes: number[];
  hours: number[];
};

type DailyTime = {
  hour: number;
  minute: number;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

let timer: NodeJS.Timeout | undefined;
let schedulerStarted = false;

function parseCronField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.trim().split("/", 2);
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) continue;

    let start: number;
    let end: number;

    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart?.includes("-")) {
      const [rawStart, rawEnd] = rangePart.split("-", 2).map(Number);
      start = rawStart;
      end = rawEnd;
    } else {
      start = Number(rangePart);
      end = start;
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      continue;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return [...values];
}

function parseCron(cron: string): CronSchedule {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 3) throw new Error(`Unsupported cron expression: ${cron}`);

  return {
    seconds: parseCronField(parts[0] || "0", 0, 59),
    minutes: parseCronField(parts[1] || "0", 0, 59),
    hours: parseCronField(parts[2] || "0", 0, 23),
  };
}

function nextRunDate(from: Date, schedule: CronSchedule): Date {
  let next: Date | undefined;
  const sortedSeconds = [...schedule.seconds].sort((a, b) => a - b);
  const sortedMinutes = [...schedule.minutes].sort((a, b) => a - b);
  const sortedHours = [...schedule.hours].sort((a, b) => a - b);

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    for (const hour of sortedHours) {
      for (const minute of sortedMinutes) {
        for (const second of sortedSeconds) {
          const candidate = new Date(from);
          candidate.setUTCDate(candidate.getUTCDate() + dayOffset);
          candidate.setUTCHours(hour, minute, second, 0);

          if (candidate.getTime() <= from.getTime()) continue;
          if (!next || candidate.getTime() < next.getTime()) next = candidate;
        }
      }
    }
  }

  if (!next) throw new Error("Unable to compute next digest time");
  return next;
}

function parseDailyTimes(times: string[]): DailyTime[] {
  return times
    .map((time) => {
      const match = time.match(/^(\d{2}):(\d{2})$/);
      if (!match) return null;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
      return { hour, minute };
    })
    .filter((time): time is DailyTime => Boolean(time))
    .sort((a, b) => a.hour - b.hour || a.minute - b.minute);
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function addLocalDays(parts: ZonedParts, days: number): Pick<ZonedParts, "year" | "month" | "day"> {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedLocalTimeToUtc(
  localDate: Pick<ZonedParts, "year" | "month" | "day">,
  time: DailyTime,
  timeZone: string,
): Date {
  const desiredUtc = Date.UTC(
    localDate.year,
    localDate.month - 1,
    localDate.day,
    time.hour,
    time.minute,
    0,
    0,
  );
  let guess = desiredUtc;

  for (let i = 0; i < 5; i += 1) {
    const actual = getZonedParts(new Date(guess), timeZone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0,
    );
    const diff = desiredUtc - actualUtc;
    if (diff === 0) break;
    guess += diff;
  }

  return new Date(guess);
}

function nextDailyTimeRunDate(from: Date, times: DailyTime[], timeZone: string): Date {
  let next: Date | undefined;
  const localNow = getZonedParts(from, timeZone);

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const localDate = addLocalDays(localNow, dayOffset);
    for (const time of times) {
      const candidate = zonedLocalTimeToUtc(localDate, time, timeZone);

      if (candidate.getTime() <= from.getTime()) continue;
      if (!next || candidate.getTime() < next.getTime()) next = candidate;
    }
  }

  if (!next) throw new Error("Unable to compute next digest time");
  return next;
}

function formatDailyTimes(times: DailyTime[]): string[] {
  return times.map(
    (time) => `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`
  );
}

function scheduleNext(): void {
  const now = new Date();
  const settings = getSettings();
  const dailyTimes = parseDailyTimes(settings.digestTimes);
  const timeZone = settings.digestTimezone || config.digestTimezone;
  let next: Date;

  if (dailyTimes.length > 0) {
    next = nextDailyTimeRunDate(now, dailyTimes, timeZone);
  } else {
    const cron = settings.digestCron || config.digestCron;
    const schedule = parseCron(cron);
    if (
      schedule.seconds.length === 0 ||
      schedule.minutes.length === 0 ||
      schedule.hours.length === 0
    ) {
      throw new Error(`Digest cron has no valid time fields: ${cron}`);
    }
    next = nextRunDate(now, schedule);
  }

  const delay = next.getTime() - now.getTime();
  const times = formatDailyTimes(dailyTimes);
  const scheduledAt = next.toISOString();
  setDigestNextScheduledAt(scheduledAt);

  appLogger.info("Next digest scheduled", { times, at: scheduledAt });
  recordEvent("info", "digest.scheduled", "Next digest scheduled", {
    times,
    timeZone,
    at: scheduledAt,
  });

  timer = setTimeout(async () => {
    try {
      appLogger.info("Scheduled digest triggered");
      recordEvent("info", "digest.triggered", "Scheduled digest triggered", {
        at: new Date().toISOString(),
      });
      await runDigest();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      appLogger.error("Scheduled digest failed", err);
      recordEvent("error", "digest.failed", "Scheduled digest failed", {
        message: error.message,
      });
      try {
        await sendTelegramMessage(
          `⚠️ musup digest error: ${error.name}: ${error.message}`
        );
      } catch (telegramErr) {
        appLogger.error("Failed to send error notification to Telegram", telegramErr);
      }
    } finally {
      scheduleNext();
    }
  }, delay);
}

export function refreshDigestScheduler(reason = "settings.updated"): void {
  if (!schedulerStarted) return;
  if (timer) clearTimeout(timer);
  recordEvent("info", "digest.schedule_refreshed", "Digest schedule refreshed", { reason });
  scheduleNext();
}

export function startDigestScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  scheduleNext();

  process.on("SIGTERM", () => {
    if (timer) clearTimeout(timer);
  });
}
