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

USB serial is 115200 baud with newline-delimited JSON. Credentials are supplied over USB after flashing, saved as one NVS blob, and never printed. They are not compiled into the firmware. NVS/flash is **not encrypted** in this prototype: physical access to the board can expose credentials. Keep any flash backups private.

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

Status includes Wi-Fi connection, GNSS validity, queue count, battery voltage, storage readiness, last HTTP status, and boot ID. It does not return the SSID, password, device token, or saved locations. A `telemetry` response with `lastHttpCode:200` means the server accepted the request; it does not establish a GPS fix unless `gpsFix:true` is also shown.

## Hardware

- Modem UART: ESP32 RX **GPIO17**, TX **GPIO18**, 115200 8N1, no hardware flow control.
- Modem power enable: **GPIO21 HIGH** (V2). Keep the physical **4G DIP ON** for initial testing. Older generic FAQ references to GPIO33/22 do not match the V2 schematic.
- Battery MAX17048 fuel gauge: I2C **SDA15/SCL16**, address `0x36`; voltage register `0x02`, 78.125 µV/LSB.
- WS2812 status LED: GPIO38. Purple: needs configuration; blue: no Wi-Fi; yellow: waiting GPS; green: fresh GPS; red: storage unavailable or repeated upload failures.
- GNSS antenna goes to the connector labeled GNSS. Its bias comes from the board's 3.3 V rail; there is no extra ESP32 antenna power GPIO to set.
- Leave camera disabled. HUB is required for USB programming; it may be switched off for lower battery consumption after unplugging the Mac.

Primary references: [V2 examples](https://files.waveshare.com/wiki/ESP32-S3-A-SIM7670X-4G-HAT/Demo/ESP32-S3-A-SIM7670X-4G-V2.zip), [V2 schematic](https://files.waveshare.com/wiki/ESP32-S3-A-SIM7670X-4G-HAT/ESP32-S3-A-SIM7670X-4G-V2.pdf), [Waveshare Arduino documentation](https://docs.waveshare.com/ESP32-S3-SIM7670G-4G/Arduino), [V2 settings in FAQ](https://docs.waveshare.com/ESP32-S3-SIM7670G-4G/FAQ).

## GPS, uploads, and storage

The sketch enables GNSS with `AT+CGNSSPWR=1`, disables unsolicited NMEA output with `AT+CGNSSTST=0`, and polls `AT+CGPSINFO` approximately once per second. Startup reads GNSS power state and accepts an already-active receiver; it reads back the state after enabling. Three invalid/failed GPS-command replies trigger a modem handshake and GNSS-power check again. Normal no-fix replies do not trigger a reset. It validates coordinates, hemisphere, calendar date, UTC time, speed, and bearing. The GPS command does not provide satellites, so `satellites` is null. Blank data, malformed data, and modem timeout do not become locations. Repeated GPS timestamps do not create extra points or keep the fix fresh indefinitely.

Each new GPS second has a random boot UUID plus increasing sequence number for server deduplication. UTC comes from the GPS observation, not from upload time. A 5,000-slot file stores records with CRC32; pending points survive normal reboot. When full, it **discards the oldest point** to retain recent movement (roughly 83 minutes at 1 Hz). Damaged/incomplete records are ignored on boot. An abrupt power loss may lose the record being written. This is a prototype queue, not an automotive-certified black box.

Uploads put the newest queued point first, followed by the oldest backlog, up to 32 per request. A successful `{ok:true}` HTTP 200 acknowledges those points; failures keep them queued. Duplicate retransmissions after power loss are expected and deduplicated by the server. While moving or draining backlog, the target interval is 2 seconds; stationary/no-fix heartbeat interval is 10 seconds. Network calls are synchronous and can delay GPS polling, especially during failed TLS or slow requests; sustained 1 Hz capture is not guaranteed by this prototype. Failed uploads back off up to 30 seconds. A disconnected hotspot still records GPS.

HTTPS validates hostname, certificate chain, and validity using the ISRG Root X1 CA; redirects are disabled. This trusts the current Let's Encrypt certificate chain for Sightings, not a pinned leaf certificate. A custom endpoint must use a chain trusted by that root, or the CA source must be deliberately updated. SNTP supplies time before TLS; GPS UTC is the fallback when SNTP is unavailable. No TLS verification bypass is used.

No modem cellular connection, temperature probes, OTA updates, ignition detection, or production battery low-voltage policy is implemented yet.

## Native verification

```sh
c++ -std=c++17 -Wall -Wextra -Werror hardware/waveshare-tracker/tests/gps_parser_test.cpp -o /tmp/waveshare-parser-test
/tmp/waveshare-parser-test
```

This tests the actual GNSS parser and CRC implementation against valid coordinates/time, no-fix replies, bad directions, out-of-range minutes/latitude, invalid dates, missing speed/bearing, implausible speeds (sent as null so they cannot block the upload queue), and known CRC data. The Arduino build verifies platform integration. Flash queue durability, antenna reception, battery operation, and live server delivery require hardware tests; a successful compile does not prove them.
