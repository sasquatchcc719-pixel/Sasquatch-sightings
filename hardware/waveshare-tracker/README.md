# Waveshare tracker prototype

For **ESP32-S3-SIM7670G-4G V2.0**, ESP32-S3R8, 16 MB flash / 8 MB octal PSRAM. Firmware **0.3.0** adds **Hologram cellular data**, with the existing 2.4 GHz Wi-Fi/hotspot connection retained as backup. An activated data SIM and LTE antenna on MAIN are required for cellular service. A SIM is not required for GPS. Battery power runs the firmware independently of the Mac. Outside Internet coverage, points are saved locally and uploaded after reconnection.

Firmware **0.3.1** fixes truncated GPS replies during CMUX operation and reconnects cellular after three consecutive transport failures, even if PPP still has an IP address. HTTP responses from a reachable server (including 4xx/5xx) do not trigger that transport reset.

Firmware **0.4.1** adds signed remote updates (see below). The tracking architecture introduced in **0.3.2** moves HTTPS onto a dedicated task so DNS, TLS, response waits, and upload backoff do not block the GPS loop. The loop remains the sole owner of modem commands, flash, settings, and USB output. A one-request queue transfers an immutable payload/settings snapshot to the HTTPS worker; a result queue returns acknowledgements. Each acknowledgement checks the original slot/order identity, preserving a new sample if the ring slot was overwritten during an upload. Secure connections are reused when the server allows it, and closed after errors or transport/endpoint changes. Intentional PPP teardown waits for the active request to finish.

This core uses global DNS. A disconnected Wi-Fi interface was observed leaving DNS at `0.0.0.0` while cached Sightings addresses still worked; the public A records have a 300-second TTL, consistent with the recurring upload stalls. While PPP is active, Wi-Fi is suspended and missing DNS is repaired with 1.1.1.1 / 8.8.8.8; valid configured DNS is retained. Wi-Fi fallback is re-enabled when PPP loses its IP.

## Build

Install Arduino CLI, then the official Espressif Arduino core and JSON library:

```sh
arduino-cli core install esp32:esp32@3.3.4 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install ArduinoJson@7.4.2
arduino-cli compile --fqbn 'esp32:esp32:esp32s3:FlashSize=16M,FlashMode=qio,PSRAM=opi,CDCOnBoot=default,PartitionScheme=app3M_fat9M_16MB' --build-path /tmp/sasquatch-waveshare-build hardware/waveshare-tracker/tracker
```

Run these commands from the Sightings repository. Upload only to the **CH343 ESP32 UART bridge**, not one of the modem's USB ports. Preserve a full 16 MB factory flash backup before first upload. The upload uses the board's automatic download circuit; if that fails, hold BOOT, press/release RESET, then release BOOT. Flashing and outdoor battery testing remain separate verification steps.

## USB setup

USB serial is 4000000 baud in firmware 0.2.2 (921600 in 0.2.1, 115200 in earlier releases), with newline-delimited JSON. The modem UART remains at 115200. Credentials are supplied over USB after flashing, saved as one NVS blob, and never printed. They are not compiled into the firmware. NVS/flash is **not encrypted** in this prototype: physical access to the board can expose credentials. Keep any flash backups private.

On the first installation, inspect `storageReady`. If false because the new FAT partition is unformatted, issue the following **once**, after preserving the factory backup:

```json
{"command":"initializeStorage"}
```

This explicitly permits formatting an unreadable FAT partition. It refuses when storage is already mounted successfully. Do not use it as a recovery step for valuable queued history; preserve the flash first.

Provision using a local script that reads secrets without echoing. Tokens must be exactly 64 lowercase hexadecimal characters. The UART receives up to 2,048 bytes while the command parser limits lines to 1,536 bytes. This is the command shape; do not put actual credentials into repository files or shell history:

```json
{"command":"configure","ssid":"HOTSPOT_NAME","password":"HOTSPOT_PASSWORD","endpoint":"https://sightings.sasquatchcarpet.com/api/devices/trackers/telemetry","token":"DEVICE_TOKEN_64_LOWERCASE_HEX_CHARACTERS"}
```

Use a 2.4 GHz hotspot. On iPhone, enable Maximize Compatibility if needed. Reissue the complete `configure` command to change Wi-Fi credentials. The configuration response reports state only. Request status with:

```json
{"command":"status"}
```

Status includes Wi-Fi connection, numeric `wifiStatus`, the last non-deliberate `lastWifiDisconnectReason` (0 means none observed this boot), GNSS validity, queue count, battery voltage, storage readiness, last HTTP status, and boot ID. Cellular fields are `cellularStarted`, `cellularDialed`, `simReady`, `cellularConnected` (has an IP address), and `cellularSignal` (RSSI). `network` reports the selected available transport; `lastUploadNetwork` records the transport selected for the last HTTPS attempt. `lastTlsError` is the TLS library's raw diagnostic; consult it only after a negative HTTP result, since it can be nonzero after a successful request closes. Status does not return the SSID, password, device token, IMSI/ICCID, or saved locations. A `telemetry` response with `lastHttpCode:200` means the server accepted the request; it does not establish a GPS fix unless `gpsFix:true` is also shown.

## Hologram cellular setup

Activate the SIM in Hologram, completely disconnect power before inserting its nano-SIM, and attach the LTE antenna to MAIN. The APN is fixed to `hologram`; no username, password, or SIM PIN is configured. Hologram roaming registration is normal. Firmware 0.3.0 upgrades preserve the original NVS configuration blob and the existing FAT GPS queue; do not erase flash, initialize storage, or upload a merged full-flash image during an upgrade.

The Arduino core's bundled `PPP`/`esp_modem` driver owns UART1 on GPIO17/18 after startup, using the SIM7600-compatible command set and UART CMUX supported by the SIM7670G. PPP carries Internet traffic while its separate CMUX AT channel continues GNSS polling. No other code may read/write that UART while PPP owns it. If driver initialization fails (for example, with no SIM), the raw UART is restored so GPS and Wi-Fi can continue. Cellular registration/dialing is retried every 15 seconds; unsuccessful or lost data sessions get 45 seconds before returning to command mode and retrying. Cellular is preferred when it has an IP; otherwise HTTPS uses Wi-Fi. Wi-Fi reconnection attempts pause while cellular has an IP. TLS certificate validation stays in the ESP32, not the modem's HTTP service.

Core 3.3.4 is deliberately pinned: its generic AT string helper can discard parts of a CMUX reply, and its normal command callback is not invoked for fragments without a newline. The firmware uses the DTE raw read callback and primary AT terminal to collect every fragment into a bounded 1,024-byte response through a complete OK/error line. It obtains the DTE through the core's internal C API wrapper; recheck that integration before upgrading the core. Networking remains on the separate data terminal. Regression tests split GPS replies at every byte boundary, deliver them one byte at a time, and cover terminal/error lines and overflow.

After an ESP-only restart, the modem may still be in CMUX. Startup closes the two virtual channels and the control multiplexer using the [Espressif disconnect frames](https://github.com/espressif/esp-protocols/blob/master/components/esp_modem/src/esp_modem_cmux.cpp) before retrying initialization. Cellular requests allow 10 seconds for connection/response and 15 seconds for TLS negotiation; Wi-Fi retains its previous timeouts.

For a hardware acceptance test, leave Wi-Fi/hotspot unavailable, check `simReady:true`, `cellularConnected:true`, `lastUploadNetwork:"cellular"`, and an accepted HTTP 200, then confirm firmware/last contact in Sightings. GPS reception must be tested separately outdoors. Also test unplugged battery boot and data reconnection before installing in a vehicle. A compile alone does not prove modem or carrier compatibility. Monitor real cellular consumption before choosing production limits: frequent HTTPS connections incur overhead beyond the JSON payload.

Bench verification on November 6, 2026: the SIM7670G with an activated Hologram SIM uploaded over cellular with Wi-Fi disconnected, drained the preserved GPS queue to zero, and delivered a fresh receiver timestamp/location to Sightings under firmware 0.3.0. A subsequent ESP-only reset reconnected and received HTTP 200 without a modem power cycle. The firmware build and GPS/CRC/modem-clock tests passed. This is not yet an outdoor battery-only drive test or a long-duration coverage/reconnection test.

The subsequent outdoor test exposed truncated CMUX GPS replies and a stalled data session. Under 0.3.1, the on-board diagnostic returned a complete 93-byte GPS response that parsed as a fix; repeated GPS polling continued alongside cellular uploads with zero invalid replies during the bench check. Sightings received fresh GPS timestamps under the new version. An explicit PPP reconnect preserved nine queued points, resumed HTTP 200 uploads, and drained the queue; the local status log recorded the disconnect/reconnect sequence. This verifies the reconnect path, not a long-duration carrier-outage test.

A following outdoor battery-only test, with the phone hotspot off, delivered 261 GPS points across six minutes from one boot. Uploads briefly stalled, then resumed without USB or user intervention. The largest interval between recorded GPS observations was 22 seconds. Battery operation and simultaneous GPS/cellular delivery are verified for this short test; uninterrupted low-latency tracking and long-duration carrier-outage behavior still need work. Cloud observations alone do not identify which modem/reconnect event caused the brief stall.

Under 0.3.2, a deliberate 10-second hold in the HTTPS worker produced a 10,860 ms upload while the maximum GPS observation gap remained 2 seconds. Points accumulated during the hold and were acknowledged by the following successful request. Normal repeat requests in that bench check took approximately 0.5–1.6 seconds, with DNS configured and no PPP reconnects. The build and all four host test programs passed. Upload-batch tests cover newest-first/oldest-backlog ordering, capacity limits, and a full-ring slot overwritten while its previous sample is in flight.

The following battery-only outdoor check delivered 350 points across 362 seconds from one boot, with a maximum recorded GPS gap of 3 seconds (previous version: 22 seconds). Periodic cloud checks continued to show fresh contact past the earlier five-minute failure window. This verifies a short stationary/walking test; vehicle motion, marginal carrier coverage, and prolonged outages still need a drive test. GPS collection itself does not use cellular data. This firmware eventually uploads every queued observation, so changing batch frequency saves request overhead but does not reduce the number of recorded points transmitted.

## USB diagnostics

`gpsDiagnostic` reports the parser result (0 invalid, 1 no fix, 2 fix), response length, and reply shape with every digit masked. This reveals truncated command replies without printing a location or GPS timestamp. It also reports the PPP DNS setting and whether the Sightings hostname resolves when Internet is available. `reconnectCellular` explicitly restarts the PPP session without changing settings or queued points.

Status includes `uptimeMs`, `resetReason` (ESP-IDF reset-reason enum), `cellularReconnects`, `gpsPollResult` (same parser enum), and counts of fix, empty, and invalid GPS replies. A stale `gpsFix:false` alone does not distinguish no satellite lock from a command/parse failure; use these counters.

Version 0.3.2 adds `uploaderReady`, `uploadInFlight`, `lastUploadDurationMs`, `maxGpsFixGapSeconds`, `cellularDnsReady`, and `cellularDnsRepairs`. The GPS gap metric uses consecutive receiver timestamps, not an animated/interpolated map position. `slowUploadTest` resets that metric and holds the next upload task for 10 seconds as a one-shot bench test; GPS recording should continue throughout the hold. The hold is not persistent across reboot. Normal upload timing resumes afterward.

For an outdoor test without a nearby Mac, send `diagnosticsStart` over USB before disconnecting. It enables local status history, including across power cycles. Status snapshots are written at most once per 15 seconds, in two rotating files of approximately 32 KB each, separate from the GPS queue. The log contains the same non-location status fields printed over USB; no credentials or coordinates. On return, send `diagnosticsRead` and read newline-delimited JSON until `{"event":"diagnostics_end"}`. `diagnosticsStop` disables recording. Recording automatically disables after 30 minutes of uptime, so this bench feature is not a permanent high-frequency flash log. It never formats storage or deletes the GPS queue.

All diagnostic commands use the normal JSON envelope, for example `{"command":"gpsDiagnostic"}`.

Firmware **0.1.1** adds an explicit USB Wi-Fi diagnostic:

```json
{"command":"scanNetwork"}
```

This briefly pauses reconnection and scans 2.4 GHz for the configured network. It prints only `configuredNetworkFound` and, if found, the strongest matching channel, RSSI, and numeric auth mode; failures return a numeric `scanError`. It never prints SSIDs, BSSIDs, passwords, or tokens. The configured credentials and offline queue are retained, and automatic connection is restored afterward. A scan can briefly pause GPS sampling. Numeric Wi-Fi status 3 means connected; the exact disconnect reason comes from the ESP-IDF Wi-Fi reason enum, rather than guessing from connection failure alone.

## Hardware

- Modem UART: ESP32 RX **GPIO17**, TX **GPIO18**, 115200 8N1, no hardware flow control.
- Modem power enable: **GPIO21 HIGH** (V2). Keep the physical **4G DIP ON** for initial testing. Older generic FAQ references to GPIO33/22 do not match the V2 schematic.
- Battery MAX17048 fuel gauge: I2C **SDA15/SCL16**, address `0x36`; voltage register `0x02`, 78.125 µV/LSB.
- WS2812 status LED: GPIO38. Purple: needs configuration; blue: no Internet connection; yellow: waiting GPS; green: fresh GPS; red: storage unavailable or repeated upload failures.
- GNSS antenna goes to the connector labeled GNSS. Its bias comes from the board's 3.3 V rail; there is no extra ESP32 antenna power GPIO to set.
- Keep CAM OFF when the camera is unused; enable CAM only with the ribbon seated and its latch closed. HUB is required for USB programming; it may be switched off for lower battery consumption after unplugging the Mac.

Primary references: [V2 examples](https://files.waveshare.com/wiki/ESP32-S3-A-SIM7670X-4G-HAT/Demo/ESP32-S3-A-SIM7670X-4G-V2.zip), [V2 schematic](https://files.waveshare.com/wiki/ESP32-S3-A-SIM7670X-4G-HAT/ESP32-S3-A-SIM7670X-4G-V2.pdf), [Waveshare Arduino documentation](https://docs.waveshare.com/ESP32-S3-SIM7670G-4G/Arduino), [V2 settings in FAQ](https://docs.waveshare.com/ESP32-S3-SIM7670G-4G/FAQ).

## GPS, uploads, and storage

The sketch enables GNSS with `AT+CGNSSPWR=1`, disables unsolicited NMEA output with `AT+CGNSSTST=0`, and polls `AT+CGPSINFO` approximately once per second. Startup reads GNSS power state and accepts an already-active receiver; it reads back the state after enabling. Three invalid/failed GPS-command replies trigger a modem handshake and GNSS-power check again. Normal no-fix replies do not trigger a reset. It validates coordinates, hemisphere, calendar date, UTC time, speed, and bearing. The GPS command does not provide satellites, so `satellites` is null. Blank data, malformed data, and modem timeout do not become locations. Repeated GPS timestamps do not create extra points or keep the fix fresh indefinitely.

Each new GPS second has a random boot UUID plus increasing sequence number for server deduplication. UTC comes from the GPS observation, not from upload time. A 5,000-slot file stores records with CRC32; pending points survive normal reboot. When full, it **discards the oldest point** to retain recent movement (roughly 83 minutes at 1 Hz). Damaged/incomplete records are ignored on boot. An abrupt power loss may lose the record being written. This is a prototype queue, not an automotive-certified black box.

Uploads put the newest queued point first, followed by the oldest backlog, up to 32 per request. A successful `{ok:true}` HTTP 200 acknowledges those points; failures keep them queued. Duplicate retransmissions after power loss are expected and deduplicated by the server. While moving or draining full batches, the target start-to-start interval is 2 seconds; stationary/no-fix heartbeat interval is 10 seconds. A minimum 1.1-second delay after a successful response respects the server's one-request/second limit when a request ran long. HTTPS runs in the background; its waits do not stop GPS recording. Initial modem setup, radio/multiplexer reconfiguration, an explicit USB camera capture/diagnostic, or loss of receiver fix can still interrupt sampling. Failed uploads back off up to 30 seconds. A disconnected hotspot still records GPS.

HTTPS validates hostname, certificate chain, and validity using the ISRG Root X1 CA; redirects are disabled. This trusts the current Let's Encrypt certificate chain for Sightings, not a pinned leaf certificate. A custom endpoint must use a chain trusted by that root, or the CA source must be deliberately updated. SNTP supplies time before TLS; GPS UTC and a validated cellular modem clock can bootstrap it when SNTP is unavailable. Modem-clock timezone offsets are parsed in quarter hours, and this clock is never used to invent GPS observation times. No TLS verification bypass is used.

Temperature probes, ignition detection, and a production battery low-voltage policy are not implemented yet. Cellular data is for tracking; it does not add cellular camera streaming.

## USB camera prototype (firmware 0.2.2)

The included OV5640 is tested through USB at 640 × 480 JPEG. Firmware 0.2.2 uses 4 Mbaud USB and two PSRAM JPEG buffers in latest-frame mode so capture overlaps transmission. Continuous preview does not discard two frames on every request. Still captures retain the fresh-frame discard; initial camera startup always warms up the sensor. The browser requests the next preview frame immediately and shows a rolling measured FPS rate. It is initialized only on an explicit `cameraSnapshot` command; boot and normal GPS tracking do not activate it. There is no network camera endpoint, recording, cloud image upload, or cellular video feature in this prototype. Capturing and transmitting a frame briefly pauses the main GPS/upload loop, so use the preview for bench testing.

Disconnect USB and turn off the battery switch before fitting the camera ribbon. Release the black flip latch on the microSD-facing edge of the white 24-pin connector; do not pry the fixed white housing. Confirm ribbon contact orientation against the actual socket, seat straight, close the latch gently, set CAM ON, then reconnect power.

The V2 camera uses XCLK39, D0–D7=GPIO7–14, VSYNC42, HREF41, PCLK46. SCCB shares GPIO15/16 with the MAX17048. The firmware borrows the already initialized Wire bus0 (`pin_sccb_sda=-1`, `sccb_i2c_port=0`) rather than creating a second bus on those pins. `cameraStop` deinitializes the camera while retaining the shared Wire bus.

Measured on this prototype over CH343 USB: firmware 0.2.2 delivered 100 consecutive 640 × 480 preview frames at 12.47 FPS with no CRC failures (about 18 KiB JPEGs); browser playback measured 11.9 FPS with pause verified and no JavaScript errors. Firmware 0.2.1 measured 5.08 FPS over USB and 4.4 FPS in the browser. The original 115200-baud capture path measured 0.67 FPS before its extra one-second browser delay. JPEG quality and resolution are unchanged. Scene complexity and concurrent GPS/network work affect the rate; the UI shows actual delivered FPS.

Run the macOS Python helper with no other serial monitor open:

```sh
python3 hardware/waveshare-tracker/tools/camera-preview.py --snapshot /tmp/waveshare-camera.jpg
python3 hardware/waveshare-tracker/tools/camera-preview.py
```

The first saves one JPEG with private file permissions and prints only dimensions/sensor metadata. The second prints a random-path localhost URL; open it and use Take picture or Start preview. Only 127.0.0.1 is served; images stay in browser memory unless explicitly saved. Stopping the helper sends `cameraStop`. Use `--baud 921600` for firmware 0.2.1, or `--baud 115200` for 0.2.0 or older. The helper uses macOS IOSSIOSPEED for its default 4 Mbaud. Use `--port` if the Mac gives the CH343 bridge another device name. Do not select a modem USB port.

USB requests use `{"command":"cameraSnapshot","preview":true}` for continuous capture; omit preview or set false for a fresh still. The USB response is a JSON `camera_frame` header containing `bytes`, `width`, `height`, `sensorPid`, and `crc32`, followed by exactly that many raw JPEG bytes and a newline. Length is limited to 128 KiB; the host checks CRC32 and JPEG start bytes before displaying. Error responses are `camera_error`; camera state is included in normal status as `cameraReady`. The Wi-Fi configuration, token, FAT partition, and offline GPS queue are retained by the normal Arduino upload procedure. Do not flash the merged full-flash image when upgrading.

## Native verification

```sh
c++ -std=c++17 -Wall -Wextra -Werror hardware/waveshare-tracker/tests/gps_parser_test.cpp -o /tmp/waveshare-parser-test
/tmp/waveshare-parser-test
c++ -std=c++17 -Wall -Wextra -Werror hardware/waveshare-tracker/tests/modem_clock_test.cpp -o /tmp/waveshare-modem-clock-test
/tmp/waveshare-modem-clock-test
c++ -std=c++17 -Wall -Wextra -Werror hardware/waveshare-tracker/tests/modem_reply_test.cpp -o /tmp/waveshare-modem-reply-test
/tmp/waveshare-modem-reply-test
c++ -std=c++17 -Wall -Wextra -Werror hardware/waveshare-tracker/tests/upload_batch_test.cpp -o /tmp/waveshare-upload-batch-test
/tmp/waveshare-upload-batch-test
```

This tests the actual GNSS parser and CRC implementation against valid coordinates/time, no-fix replies, bad directions, out-of-range minutes/latitude, invalid dates, missing speed/bearing, implausible speeds (sent as null so they cannot block the upload queue), and known CRC data. Modem-clock tests cover UTC conversion, signed quarter-hour offsets, leap dates, invalid values, and incomplete responses. The Arduino build verifies platform integration. Flash queue durability, antenna reception, battery operation, and live server delivery require hardware tests; a successful compile does not prove them.


## Signed remote firmware updates (0.4.x)

For the initial prototype bootstrap, app0 was confirmed active before flashing. The USB bootstrap installs the rollback-capable Arduino 3.3.4 bootloader at `0x0` and firmware at `0x10000`. Keep the existing partition table, OTA data, NVS configuration, and FFat queue. The two existing 3 MB application slots alternate; never upload a merged flash image as an OTA artifact. For later USB recovery, inspect the currently selected OTA slot first instead of assuming app0 is active. This does not enable secure-boot eFuses.

The HTTPS worker checks Sightings about once a minute after successful telemetry. Each enabled tracker authenticates with its existing bearer token and can retrieve only its explicitly assigned release. Images live in a private storage bucket and are proxied from the same trusted Sightings HTTPS origin; redirects are disabled. A device report cannot assign releases or update another device. Firmware metadata and storage are service-role-only; the no-policy RLS advisory is intentional for these two tables.

The board verifies an ECDSA P-256 signature covering release ID, board, sequence, version, size, and SHA-256. It rejects wrong-board, oversized, tampered, old, and previously failed releases. The image hash is checked after downloading into the inactive slot, before selecting it for boot. Partial downloads leave the active slot selected. Download failures back off from 2 to 32 minutes. Downloading has a 15-second idle timeout and 10-minute overall limit. Flashing/restarting is a maintenance window: tracking pauses temporarily. Installation waits for at least 30 seconds without observed movement and a measured battery voltage of at least 3.7 V. This is a GPS-based guard, not an ignition sensor.

Arduino's automatic early confirmation is overridden. A new image stays pending until at least 60 seconds of uptime, working storage/uploader, successful authenticated telemetry, and successful authenticated firmware-service contact. A restart/crash before confirmation causes bootloader fallback; a health failure lasting five minutes explicitly requests fallback. The fallback firmware is itself OTA-capable. The failed sequence is remembered to avoid a restart loop. Normal OTA restart also shuts down PPP cleanly so the modem can reconnect without a manual power cycle.

Release procedure (run from the repository; Arduino CLI and pinned core/libraries above must be installed):

```bash
node hardware/waveshare-tracker/tools/firmware-release.mjs \
  --version sasquatch-waveshare-v2/0.4.2 --sequence 4 \
  --tracker "David's Box Truck" \
  --key /absolute/private/path/ota-signing.pem \
  --env /absolute/private/path/service.env
```

The publisher builds an isolated sketch snapshot with the requested version/sequence, signs its exact binary, uploads without overwriting artifacts, and assigns only the named enabled tracker. Use an unused monotonically increasing sequence (query `fleet_firmware_releases` first). `--build-only` builds and signs without publishing. `--rollback-test` deliberately restarts a pending candidate before confirmation; use only on a supervised test tracker. Never assign that test release to normal fleet devices.

The offline private signing key is required for future updates: keep a protected backup outside Git. The compiled public key is in `tracker/ota_public_key.h`. The private key is never sent to Supabase/Vercel or embedded in firmware. The environment file requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; never use a browser-side publishing flow. Key rotation requires a release signed by the current key that trusts the replacement, or USB recovery if the signing key is lost. Hardware damage, corrupted boot/storage, or loss of all connectivity can still require physical access.

USB `status` adds `otaState`, `otaSequence`, `otaFailedSequence`, and `otaPending`. `otaVerify` checks a supplied manifest without installing it. Download progress reports contain only byte counts. Server status is in `fleet_tracker_firmware`; never treat an assigned target as proof that it booted and was confirmed.


Verification on November 6, 2026: the real device accepted a correctly signed manifest and rejected modified SHA-256, wrong-board, oversized, stale-sequence, and invalid-signature variants. The committed `tests/ota-device-test.py` repeated all six checks against the next signed release. Eighteen targeted TypeScript tests, the four GPS/modem/batch host test programs, TypeScript checking, targeted lint, and a full Next.js production build passed. Live unauthenticated manifest/image requests returned 401. Database checks confirmed RLS enabled and no anon/authenticated table privileges. The only advisor finding for the new tables was the intentional service-role-only/no-policy configuration.

A signed sequence-2 test release was downloaded over cellular and selected for boot; its deliberate unconfirmed restart triggered automatic fallback to the OTA-capable sequence-1 bootstrap. The fallback reported `rolled_back`, persisted failed sequence 2, reconnected over cellular without a manual power cycle, and resumed fresh GPS uploads. Wi-Fi was disconnected throughout. USB supplied power and diagnostic output; firmware bytes arrived through the cellular connection. The active NVS settings and existing FFat queue were preserved.
