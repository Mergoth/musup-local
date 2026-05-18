/**
 * iPasen collector stub — implementation pending API discovery.
 *
 * SETUP STEPS (one-time, before implementing):
 *
 * 1. Install mitmproxy on your computer:
 *      brew install mitmproxy
 *
 * 2. Configure your phone's Wi-Fi proxy:
 *      Host: <your computer's local IP>
 *      Port: 8080
 *
 * 3. Install the mitmproxy CA certificate on the phone:
 *      Visit http://mitm.it in Safari/Chrome → install iOS certificate
 *      Settings → General → VPN & Device Management → trust the cert
 *
 * 4. Run mitmproxy's web UI:
 *      mitmweb
 *
 * 5. Open the iPasen app and navigate through:
 *      - Inbox / messages from teachers
 *      - Grades / evaluations
 *      - Attendance records
 *      - Circulars / school announcements
 *
 * 6. In the mitmweb browser tab (http://127.0.0.1:8081), inspect the captured
 *    requests. Note:
 *      - Base URL (e.g. https://ipasen.juntadeandalucia.es/api/...)
 *      - Auth endpoint and the token format it returns
 *      - Request/response schema for each data type
 *
 * 7. Share the captured endpoints and schemas, then replace the TODO sections
 *    below with the actual implementation.
 */

import { config } from "../config.js";
import { appLogger } from "../appLogger.js";

export function startIpasenPoller(): void {
  if (!config.ipasen.username || !config.ipasen.password) {
    appLogger.info("iPasen not configured — set IPASEN_USERNAME and IPASEN_PASSWORD");
    return;
  }

  // TODO: implement once API endpoints are known from mitmproxy session.
  // Expected structure:
  //
  //   const intervalMs = config.ipasen.pollIntervalMinutes * 60 * 1000;
  //   async function poll() {
  //     const token = await authenticate();
  //     const messages = await fetchMessages(token);     // teacher inbox
  //     const grades = await fetchGrades(token);         // evaluations
  //     const attendance = await fetchAttendance(token); // absences
  //     const circulars = await fetchCirculars(token);   // announcements
  //     for (const item of [...messages, ...grades, ...attendance, ...circulars]) {
  //       const msg = normalize(item);
  //       if (msg.text) appendMessage(msg, chatName);
  //     }
  //   }
  //   poll();
  //   setInterval(poll, intervalMs);

  appLogger.warn(
    "iPasen poller is a stub — complete the mitmproxy session first, then implement"
  );
}
