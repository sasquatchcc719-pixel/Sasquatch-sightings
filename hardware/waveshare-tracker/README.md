# Waveshare tracker prototype

For **ESP32-S3-SIM7670G-4G V2.0**, ESP32-S3R8, 16 MB flash / 8 MB octal PSRAM. This first firmware uses **2.4 GHz Wi-Fi or a phone hotspot**, not the modem's cellular data. A SIM is not required for GPS. Battery power runs the firmware independently of the Mac. Outside Wi-Fi coverage, points are saved locally and uploaded after reconnection; live Sightings updates require Internet access.

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

Status includes Wi-Fi connection, numeric `wifiStatus`, the last non-deliberate `lastWifiDisconnectReason` (0 means none observed this boot), GNSS validity, queue count, battery voltage, storage readiness, last HTTP status, and boot ID. It does not return the SSID, password, device token, or saved locations. A `telemetry` response with `lastHttpCode:200` means the server accepted the request; it does not establish a GPS fix unless `gpsFix:true` is also shown.

Firmware **0.1.1** adds an explicit USB Wi-Fi diagnostic:

```json
{"command":"scanNetwork"}
```

This briefly pauses reconnection and scans 2.4 GHz for the configured network. It prints only `configuredNetworkFound` and, if found, the strongest matching channel, RSSI, and numeric auth mode; failures return a numeric `scanError`. It never prints SSIDs, BSSIDs, passwords, or tokens. The configured credentials and offline queue are retained, and automatic connection is restored afterward. A scan can briefly pause GPS sampling. Numeric Wi-Fi status 3 means connected; the exact disconnect reason comes from the ESP-IDF Wi-Fi reason enum, rather than guessing from connection failure alone.

## Hardware

- Modem UART: ESP32 RX **GPIO17**, TX **GPIO18**, 115200 8N1, no hardware flow control.
- Modem power enable: **GPIO21 HIGH** (V2). Keep the physical **4G DIP ON** for initial testing. Older generic FAQ references to GPIO33/22 do not match the V2 schematic.
- Battery MAX17048 fuel gauge: I2C **SDA15/SCL16**, address `0x36`; voltage register `0x02`, 78.125 µV/LSB.
- WS2812 status LED: GPIO38. Purple: needs configuration; blue: no Wi-Fi; yellow: waiting GPS; green: fresh GPS; red: storage unavailable or repeated upload failures.
- GNSS antenna goes to the connector labeled GNSS. Its bias comes from the board's 3.3 V rail; there is no extra ESP32 antenna power GPIO to set.
- Keep CAM OFF when the camera is unused; enable CAM only with the ribbon seated and its latch closed. HUB is required for USB programming; it may be switched off for lower battery consumption after unplugging the Mac.

Primary references: [V2 examples](https://files.waveshare.com/wiki/ESP32-S3-A-SIM7670X-4G-HAT/Demo/ESP32-S3-A-SIM7670X-4G-V2.zip), [V2 schematic](https://files.waveshare.com/wiki/ESP32-S3-A-SIM7670X-4G-HAT/ESP32-S3-A-SIM7670X-4G-V2.pdf), [Waveshare Arduino documentation](https://docs.waveshare.com/ESP32-S3-SIM7670G-4G/Arduino), [V2 settings in FAQ](https://docs.waveshare.com/ESP32-S3-SIM7670G-4G/FAQ).

## GPS, uploads, and storage

The sketch enables GNSS with `AT+CGNSSPWR=1`, disables unsolicited NMEA output with `AT+CGNSSTST=0`, and polls `AT+CGPSINFO` approximately once per second. Startup reads GNSS power state and accepts an already-active receiver; it reads back the state after enabling. Three invalid/failed GPS-command replies trigger a modem handshake and GNSS-power check again. Normal no-fix replies do not trigger a reset. It validates coordinates, hemisphere, calendar date, UTC time, speed, and bearing. The GPS command does not provide satellites, so `satellites` is null. Blank data, malformed data, and modem timeout do not become locations. Repeated GPS timestamps do not create extra points or keep the fix fresh indefinitely.

Each new GPS second has a random boot UUID plus increasing sequence number for server deduplication. UTC comes from the GPS observation, not from upload time. A 5,000-slot file stores records with CRC32; pending points survive normal reboot. When full, it **discards the oldest point** to retain recent movement (roughly 83 minutes at 1 Hz). Damaged/incomplete records are ignored on boot. An abrupt power loss may lose the record being written. This is a prototype queue, not an automotive-certified black box.

Uploads put the newest queued point first, followed by the oldest backlog, up to 32 per request. A successful `{ok:true}` HTTP 200 acknowledges those points; failures keep them queued. Duplicate retransmissions after power loss are expected and deduplicated by the server. While moving or draining backlog, the target interval is 2 seconds; stationary/no-fix heartbeat interval is 10 seconds. Network calls are synchronous and can delay GPS polling, especially during failed TLS or slow requests; sustained 1 Hz capture is not guaranteed by this prototype. Failed uploads back off up to 30 seconds. A disconnected hotspot still records GPS.

HTTPS validates hostname, certificate chain, and validity using the ISRG Root X1 CA; redirects are disabled. This trusts the current Let's Encrypt certificate chain for Sightings, not a pinned leaf certificate. A custom endpoint must use a chain trusted by that root, or the CA source must be deliberately updated. SNTP supplies time before TLS; GPS UTC is the fallback when SNTP is unavailable. No TLS verification bypass is used.

No modem cellular connection, temperature probes, OTA updates, ignition detection, or production battery low-voltage policy is implemented yet.

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
```

This tests the actual GNSS parser and CRC implementation against valid coordinates/time, no-fix replies, bad directions, out-of-range minutes/latitude, invalid dates, missing speed/bearing, implausible speeds (sent as null so they cannot block the upload queue), and known CRC data. The Arduino build verifies platform integration. Flash queue durability, antenna reception, battery operation, and live server delivery require hardware tests; a successful compile does not prove them.
