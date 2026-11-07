#include <Arduino.h>
#include <ArduinoJson.h>
#include <FFat.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <Preferences.h>
#include <PPP.h>
#include <cxx_include/esp_modem_api.hpp>
#include <esp_private/c_api_wrapper.hpp>
#include <WiFi.h>
#include <Wire.h>
#include <esp_system.h>
#include <esp_wifi.h>
#include <atomic>
#include <new>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <sys/time.h>
#include <time.h>
#include "gps_parser.h"
#include "modem_clock.h"
#include "modem_reply.h"
#include "upload_batch.h"
#include "camera_usb.h"
#include "tls_root.h"

// Waveshare V2 schematic; these differ from older board revisions.
constexpr int MODEM_RX = 17, MODEM_TX = 18, MODEM_POWER = 21, STATUS_LED = 38;
constexpr size_t QUEUE_SIZE = 5000, BATCH_SIZE = 32;
constexpr uint32_t RECORD_MAGIC = 0x53515431;
#include "build_info.h"
#include "ota.h"
constexpr char CELLULAR_APN[] = "hologram";
constexpr char DEFAULT_ENDPOINT[] = "https://sightings.sasquatchcarpet.com/api/devices/trackers/telemetry";

struct Record {
  uint32_t magic;
  uint64_t order;
  uint32_t seq;
  char bootId[37];
  int64_t epoch;
  double lat, lng;
  float speedMps, bearing;
  uint32_t crc;
};
struct UploadRequest {
  String endpoint, token, payload, otaReport, otaManifest;
  bool checkOta = false, otaHealthy = false;
  UploadTicket tickets[BATCH_SIZE];
  size_t count = 0;
  bool cellular = false;
  uint32_t generation = 0, startedMs = 0, durationMs = 0, testDelayMs = 0;
  int code = -1, tlsError = 0;
};
QueueHandle_t uploadRequests = nullptr, uploadResults = nullptr;
bool uploaderReady = false, uploadInFlight = false, cellularRestartPending = false;
bool wifiSuspendedForCellular = false;
uint32_t cellularDnsRepairs = 0;
uint32_t lastDnsCheckMs = 0, nextUploadDelayMs = 0;
uint32_t cellularGeneration = 0, lastUploadDurationMs = 0, maxGpsFixGapSeconds = 0;
Preferences preferences;
HardwareSerial modem(1);
File queueFile;
uint64_t orders[QUEUE_SIZE] = {}, nextOrder = 1;
size_t queued = 0;
uint32_t dropped = 0, sequence = 0;
int latestSlot = -1;
char bootId[37];
String ssid, password, endpoint, token, serialInput;
bool configured = false, storageReady = false, modemReady = false, gpsFix = false;
bool serialOverflow = false;
GpsFix currentFix;
int64_t lastRecordedEpoch = 0;
uint32_t lastFixMs = 0, lastPollMs = 0, lastHeartbeatMs = 0, nextPostMs = 0;
uint32_t lastConnectMs = 0, lastStatusMs = 0;
uint8_t failures = 0, modemReadFailures = 0;
std::atomic<int> lastWifiDisconnectReason{0};
int lastHttpCode = 0;
int lastTlsError = 0;
float batteryV = NAN;
bool cellularStarted = false, cellularDialed = false, simReady = false;
uint32_t nextCellularMs = 5000, cellularDataAt = 0;
int cellularSignal = -1;
String lastUploadNetwork;
ModemReply modemReply;
std::atomic<int> modemReplyResult{int(ModemReply::Result::Pending)};
uint8_t cellularUploadFailures = 0;
uint32_t cellularReconnects = 0;
bool diagnosticsEnabled = false;
uint32_t diagnosticAt = 0, diagnosticsUntil = 0;
GpsResult lastGpsResult = GpsResult::Invalid;
uint32_t gpsFixReplies = 0, gpsEmptyReplies = 0, gpsInvalidReplies = 0;
const char *activeNetwork() {
  if (cellularStarted && PPP.hasIP()) return "cellular";
  return WiFi.status() == WL_CONNECTED ? "wifi" : "offline";
}
bool internetReady() { return strcmp(activeNetwork(), "offline") != 0; }
void maintainCellularDns(bool force) {
  if (!PPP.hasIP()) return;
  if (!force && millis() - lastDnsCheckMs < 1000) return;
  lastDnsCheckMs = millis();
  // This core shares DNS globally across interfaces. A stopped/disconnected STA
  // can clear it after PPP negotiation, leaving only cached hostnames usable.
  if (static_cast<uint32_t>(PPP.dnsIP()) == 0) {
    PPP.dnsIP(0, IPAddress(1, 1, 1, 1));
    PPP.dnsIP(1, IPAddress(8, 8, 8, 8));
    ++cellularDnsRepairs;
  }
}

void makeBootId() {
  uint8_t b[16]; esp_fill_random(b, sizeof(b));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  snprintf(bootId, sizeof(bootId), "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);
}
bool readRecord(int slot, Record &record) {
  if (!storageReady || slot < 0 || slot >= int(QUEUE_SIZE)) return false;
  if (!queueFile.seek(size_t(slot) * sizeof(Record))) return false;
  return queueFile.read(reinterpret_cast<uint8_t *>(&record), sizeof(record)) == sizeof(record) &&
    record.magic == RECORD_MAGIC && record.bootId[36] == '\0' &&
    record.crc == recordCrc(&record, offsetof(Record, crc));
}
void initQueue() {
  // Never autoformat a failed mount: an unreadable queue must not be silently erased.
  if (!FFat.begin(false)) return;
  queueFile = FFat.open("/tracker-v1.bin", "r+");
  if (!queueFile) queueFile = FFat.open("/tracker-v1.bin", "w+");
  if (!queueFile) return;
  if (queueFile.size() < QUEUE_SIZE * sizeof(Record)) {
    queueFile.seek(QUEUE_SIZE * sizeof(Record) - 1);
    queueFile.write(uint8_t(0)); queueFile.flush();
  }
  // A recovery mount rescans disk state rather than counting existing RAM entries twice.
  memset(orders, 0, sizeof(orders));
  queued = 0; nextOrder = 1; latestSlot = -1;
  storageReady = true;
  Record record;
  for (size_t slot = 0; slot < QUEUE_SIZE; ++slot) if (readRecord(slot, record)) {
    orders[slot] = record.order; ++queued;
    if (record.order >= nextOrder) nextOrder = record.order + 1;
  }
}
int oldestSlot() {
  int oldest = -1;
  for (size_t i = 0; i < QUEUE_SIZE; ++i)
    if (orders[i] && (oldest < 0 || orders[i] < orders[oldest])) oldest = i;
  return oldest;
}
void saveFix(const GpsFix &fix) {
  if (!storageReady) return;
  int slot = -1;
  for (size_t i = 0; i < QUEUE_SIZE; ++i) if (!orders[i]) { slot = i; break; }
  if (slot < 0) { slot = oldestSlot(); ++dropped; }
  Record record = {};
  record.magic = RECORD_MAGIC; record.order = nextOrder++; record.seq = sequence++;
  memcpy(record.bootId, bootId, sizeof(bootId));
  record.epoch = fix.epoch; record.lat = fix.lat; record.lng = fix.lng;
  record.speedMps = fix.speedMps; record.bearing = fix.bearing;
  record.crc = recordCrc(&record, offsetof(Record, crc));
  if (!queueFile.seek(size_t(slot) * sizeof(Record)) ||
      queueFile.write(reinterpret_cast<const uint8_t *>(&record), sizeof(record)) != sizeof(record)) {
    storageReady = false; return;
  }
  queueFile.flush();
  if (!orders[slot]) ++queued;
  orders[slot] = record.order; latestSlot = slot;
}
void acknowledge(int slot) {
  const uint32_t empty = 0;
  if (queueFile.seek(size_t(slot) * sizeof(Record)) &&
      queueFile.write(reinterpret_cast<const uint8_t *>(&empty), sizeof(empty)) == sizeof(empty)) {
    orders[slot] = 0; --queued;
    if (latestSlot == slot) latestSlot = -1;
  } else storageReady = false;
}
String command(const char *text, uint32_t timeout = 1200) {
  if (cellularStarted) {
    modemReply = ModemReply{};
    modemReplyResult.store(int(ModemReply::Result::Pending));
    String request = String(text) + "\r";
    // Core 3.3.4's line callback can discard CMUX fragments with no newline.
    // The DTE raw callback receives every fragment and locks out other commands.
    auto dte = PPP.handle()->dte;
    dte->on_read([](uint8_t *data, size_t length) {
      const auto result = modemReply.append(data, length);
      modemReplyResult.store(int(result), std::memory_order_release);
      return esp_modem::command_result::TIMEOUT; // Caller removes callback once complete.
    });
    dte->send(reinterpret_cast<uint8_t *>(request.begin()), request.length(), 0);
    const uint32_t started = millis();
    while (modemReplyResult.load(std::memory_order_acquire) == int(ModemReply::Result::Pending) && millis() - started < timeout) delay(1);
    dte->on_read(nullptr);
    return modemReplyResult.load() == int(ModemReply::Result::Ok) ? String(modemReply.data) : String();
  }
  while (modem.available()) modem.read();
  modem.print(text); modem.print("\r\n");
  String response; response.reserve(512);
  uint32_t started = millis();
  while (millis() - started < timeout) {
    while (modem.available()) {
      char c = modem.read();
      if (response.length() < 1024) response += c;
    }
    if (response.indexOf("\r\nOK\r\n") >= 0 || response.indexOf("\r\nERROR\r\n") >= 0) break;
    delay(1);
  }
  return response;
}
void restartCellular() {
  if (uploadInFlight) { cellularRestartPending = true; return; }
  cellularRestartPending = false; ++cellularGeneration;
  if (cellularStarted) { PPP.mode(ESP_MODEM_MODE_COMMAND); PPP.end(); }
  cellularStarted = false; cellularDialed = false; simReady = false;
  modem.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  modemReady = false; cellularUploadFailures = 0; ++cellularReconnects;
  nextCellularMs = millis() + 15000;
}
void connectCellular() {
  if (!configured || int32_t(millis() - nextCellularMs) < 0) return;
  // Leave the network interface alive until the worker releases its socket.
  if (uploadInFlight && !PPP.hasIP()) return;
  nextCellularMs = millis() + 15000;
  if (!cellularStarted) {
    if (command("AT", 500).indexOf("OK") < 0) {
      // The modem can remain in CMUX after an ESP-only reset. Close its old
      // virtual channels and multiplexer before handing UART to PPP. Frames
      // follow esp_modem CMux::send_disconnect (DLCI 1, 2, then control).
      const uint8_t closeChannels[][6] = {
        {0xf9, 0x07, 0x53, 0x01, 0x3f, 0xf9},
        {0xf9, 0x0b, 0x53, 0x01, 0xb8, 0xf9}
      };
      for (const auto &frame : closeChannels) {
        modem.write(frame, sizeof(frame)); modem.flush(); delay(150);
      }
      const uint8_t closeMux[] = {0xf9, 0x03, 0xef, 0x05, 0xc3, 0x01, 0xf2, 0xf9};
      modem.write(closeMux, sizeof(closeMux)); modem.flush(); delay(300);
    }
    modem.end();
    PPP.setApn(CELLULAR_APN);
    PPP.setPins(MODEM_TX, MODEM_RX);
    ++cellularGeneration;
    cellularStarted = PPP.begin(PPP_MODEM_SIM7600, 1, 115200);
    if (!cellularStarted) {
      PPP.end();
      modem.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
      modemReady = false;
      return;
    }
    command("ATE0");
  }
  simReady = command("AT+CPIN?").indexOf("READY") >= 0;
  cellularSignal = PPP.RSSI();
  if (PPP.hasIP() && time(nullptr) < 1704067200) {
    int64_t epoch;
    if (parseModemClock(command("AT+CCLK?").c_str(), epoch)) {
      timeval clock = {time_t(epoch), 0}; settimeofday(&clock, nullptr);
    }
  }
  if (PPP.hasIP()) { cellularDataAt = millis(); return; }
  if (cellularDialed) {
    // Give registration/IP negotiation time, then recover instead of staying
    // indefinitely in a disconnected data session. GPS uses the CMUX AT channel.
    if (millis() - cellularDataAt < 45000) return;
    ++cellularGeneration;
    if (!PPP.mode(ESP_MODEM_MODE_COMMAND)) {
      PPP.end();
      cellularStarted = false;
      modem.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
    }
    cellularDialed = false;
    modemReady = false;
    return;
  }
  if (!simReady || !PPP.attached()) return;
  cellularDialed = PPP.mode(ESP_MODEM_MODE_CMUX);
  cellularDataAt = millis();
}
void pollGps() {
  if (!modemReady) {
    if (command("AT").indexOf("OK") < 0) return;
    command("ATE0");
    command("AT+CGNSSTST=0"); // Keep AT polling free of unsolicited NMEA output.
    // The modem can stay powered across an ESP32 reset: do not assume GNSS is off.
    String power = command("AT+CGNSSPWR?");
    if (!gnssPowerIsOn(power.c_str())) {
      command("AT+CGNSSPWR=1", 3000);
      power = command("AT+CGNSSPWR?");
    }
    modemReady = gnssPowerIsOn(power.c_str());
    if (!modemReady) return;
    modemReadFailures = 0;
  }
  String response = command("AT+CGPSINFO");
  GpsFix fix;
  GpsResult result = response.indexOf("\r\nOK\r\n") >= 0 ? parseGpsInfo(response.c_str(), fix) : GpsResult::Invalid;
  lastGpsResult = result;
  if (result == GpsResult::Fix) ++gpsFixReplies;
  else if (result == GpsResult::NoFix) ++gpsEmptyReplies;
  else ++gpsInvalidReplies;
  gpsFix = result == GpsResult::Fix;
  if (result == GpsResult::Invalid) {
    if (++modemReadFailures >= 3) { modemReady = false; modemReadFailures = 0; }
  } else modemReadFailures = 0; // A normal blank/no-fix reply is a healthy modem.
  if (!gpsFix) return;
  currentFix = fix;
  if (fix.epoch != lastRecordedEpoch) lastFixMs = millis();
  if (time(nullptr) < 1704067200 || llabs(int64_t(time(nullptr)) - fix.epoch) > 60) {
    timeval now = {time_t(fix.epoch), 0}; settimeofday(&now, nullptr);
  }
  // A repeated response from the same GPS second must not create new movement.
  if (fix.epoch != lastRecordedEpoch) {
    if (lastRecordedEpoch && fix.epoch > lastRecordedEpoch)
      maxGpsFixGapSeconds = max(maxGpsFixGapSeconds, uint32_t(fix.epoch - lastRecordedEpoch));
    saveFix(fix); lastRecordedEpoch = fix.epoch;
  }
}
float readBattery() {
  Wire.beginTransmission(0x36); Wire.write(0x02);
  if (Wire.endTransmission(false) || Wire.requestFrom(0x36, 2) != 2) return NAN;
  uint16_t raw = (Wire.read() << 8) | Wire.read();
  float volts = raw * 0.000078125f;
  return volts >= 2 && volts <= 5 ? volts : NAN;
}
bool freshFix() { return gpsFix && millis() - lastFixMs < 5000; }
void printStatus(const char *event = "status") {
  JsonDocument doc;
  doc["event"] = event; doc["firmware"] = FIRMWARE; doc["bootId"] = bootId;
  doc["uptimeMs"] = millis(); doc["resetReason"] = int(esp_reset_reason());
  doc["otaState"] = TrackerOta::status; doc["otaSequence"] = FIRMWARE_SEQUENCE;
  doc["otaFailedSequence"] = TrackerOta::failedSequence; doc["otaPending"] = TrackerOta::pending;
  doc["uploaderReady"] = uploaderReady; doc["uploadInFlight"] = uploadInFlight;
  doc["lastUploadDurationMs"] = lastUploadDurationMs; doc["maxGpsFixGapSeconds"] = maxGpsFixGapSeconds;
  doc["cellularDnsReady"] = static_cast<uint32_t>(PPP.dnsIP()) != 0;
  doc["cellularDnsRepairs"] = cellularDnsRepairs;
  doc["configured"] = configured; doc["wifiConnected"] = WiFi.status() == WL_CONNECTED;
  doc["wifiStatus"] = int(WiFi.status());
  doc["lastWifiDisconnectReason"] = lastWifiDisconnectReason.load();
  doc["cellularStarted"] = cellularStarted; doc["cellularDialed"] = cellularDialed;
  doc["simReady"] = simReady; doc["cellularConnected"] = cellularStarted && PPP.hasIP();
  doc["cellularSignal"] = cellularSignal;
  doc["cellularReconnects"] = cellularReconnects;
  doc["network"] = activeNetwork(); doc["lastUploadNetwork"] = lastUploadNetwork;
  doc["cameraReady"] = CameraUsb::ready;
  doc["modemReady"] = modemReady; doc["gpsFix"] = freshFix();
  doc["gpsPollResult"] = int(lastGpsResult);
  doc["gpsFixReplies"] = gpsFixReplies; doc["gpsEmptyReplies"] = gpsEmptyReplies; doc["gpsInvalidReplies"] = gpsInvalidReplies;
  doc["clockReady"] = time(nullptr) >= 1704067200;
  doc["storageReady"] = storageReady; doc["queued"] = queued;
  doc["discardedOldest"] = dropped; doc["lastHttpCode"] = lastHttpCode;
  doc["lastTlsError"] = lastTlsError;
  if (std::isfinite(batteryV)) doc["batteryV"] = batteryV; else doc["batteryV"] = nullptr;
  serializeJson(doc, Serial); Serial.println();
  // Opt-in bench history survives USB reconnects and contains no locations/secrets.
  if (diagnosticsEnabled && int32_t(millis() - diagnosticsUntil) >= 0) {
    diagnosticsEnabled = false; preferences.putBool("diagnostics", false);
  }
  if (diagnosticsEnabled && storageReady && (!diagnosticAt || millis() - diagnosticAt >= 15000)) {
    diagnosticAt = millis();
    File log = FFat.open("/tracker-diagnostics.jsonl", "a");
    if (log && log.size() >= 32768) {
      log.close(); FFat.remove("/tracker-diagnostics-old.jsonl");
      FFat.rename("/tracker-diagnostics.jsonl", "/tracker-diagnostics-old.jsonl");
      log = FFat.open("/tracker-diagnostics.jsonl", "a");
    }
    if (log) { serializeJson(doc, log); log.println(); log.close(); }
  }
}
void connectWifi() {
  if (!configured) return;
  wifiSuspendedForCellular = false;
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.disconnect();
  WiFi.begin(ssid.c_str(), password.c_str());
  lastConnectMs = millis();
}
void scanConfiguredNetwork() {
  JsonDocument result;
  result["event"] = "network_scan";
  result["configuredNetworkFound"] = false;
  if (!configured) {
    result["error"] = "not_configured";
    serializeJson(result, Serial); Serial.println(); return;
  }
  // Pause connection attempts during this explicit USB diagnostic; keep NVS intact.
  const bool reconnect = WiFi.getAutoReconnect();
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, false, 1000);
  WiFi.setScanTimeout(8000);
  const int count = WiFi.scanNetworks(false, true, false, 200, 0, ssid.c_str());
  int strongest = -1;
  if (count < 0) {
    result["scanError"] = count;
    esp_wifi_scan_stop();
  } else {
    for (int i = 0; i < count; ++i) {
      if (WiFi.SSID(i) == ssid && (strongest < 0 || WiFi.RSSI(i) > WiFi.RSSI(strongest))) strongest = i;
    }
    if (strongest >= 0) {
      result["configuredNetworkFound"] = true;
      result["channel"] = WiFi.channel(strongest);
      result["rssi"] = WiFi.RSSI(strongest);
      result["authMode"] = int(WiFi.encryptionType(strongest));
    }
  }
  WiFi.scanDelete();
  WiFi.setAutoReconnect(reconnect);
  connectWifi();
  // Never emit network names, BSSIDs, credentials, or device tokens.
  serializeJson(result, Serial); Serial.println();
}
bool validToken(const String &value) {
  if (value.length() != 64) return false;
  for (size_t i = 0; i < value.length(); ++i)
    if (!((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f'))) return false;
  return true;
}
bool validEndpoint(const String &url) {
  if (!url.startsWith("https://") || url.length() > 256) return false;
  int slash = url.indexOf('/', 8);
  String authority = slash < 0 ? url.substring(8) : url.substring(8, slash);
  return authority.length() && authority.indexOf('@') < 0 && url.indexOf('#') < 0 &&
    url.indexOf('\r') < 0 && url.indexOf('\n') < 0 && url.indexOf(' ') < 0;
}
void processSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') {
      if (serialInput.length() < 1536 && !serialOverflow) serialInput += c;
      else { serialOverflow = true; serialInput = ""; }
      continue;
    }
    if (serialOverflow) { Serial.println("{\"event\":\"error\",\"error\":\"command_too_long\"}"); serialOverflow = false; continue; }
    JsonDocument doc;
    auto error = deserializeJson(doc, serialInput); serialInput = "";
    if (error) { Serial.println("{\"event\":\"error\",\"error\":\"invalid_json\"}"); continue; }
    String action = doc["command"] | "";
    if (action == "cameraSnapshot") { CameraUsb::snapshot(!(doc["preview"] | false)); continue; }
    if (action == "cameraStop") { CameraUsb::stop(); printStatus("camera_stopped"); continue; }
    if (action == "status") { printStatus(); continue; }
    if (action == "otaVerify") {
      JsonDocument manifest; manifest.set(doc["manifest"]);
      JsonDocument result; result["event"] = "ota_verification"; result["valid"] = TrackerOta::validManifest(manifest);
      serializeJson(result, Serial); Serial.println(); continue;
    }
    if (action == "slowUploadTest") {
      nextUploadDelayMs = 10000; maxGpsFixGapSeconds = 0; nextPostMs = 0;
      printStatus("slow_upload_test_scheduled"); continue;
    }
    if (action == "reconnectCellular") { restartCellular(); printStatus("cellular_reconnecting"); continue; }
    if (action == "diagnosticsStart" || action == "diagnosticsStop") {
      diagnosticsEnabled = action == "diagnosticsStart";
      diagnosticsUntil = millis() + 1800000;
      preferences.putBool("diagnostics", diagnosticsEnabled); diagnosticAt = 0;
      printStatus(diagnosticsEnabled ? "diagnostics_started" : "diagnostics_stopped"); continue;
    }
    if (action == "diagnosticsRead") {
      for (const char *path : {"/tracker-diagnostics-old.jsonl", "/tracker-diagnostics.jsonl"}) {
        File log = FFat.open(path, "r");
        uint8_t buffer[256];
        while (log && log.available()) { size_t size = log.read(buffer, sizeof(buffer)); if (!size) break; Serial.write(buffer, size); }
        if (log) log.close();
      }
      Serial.println("{\"event\":\"diagnostics_end\"}"); continue;
    }
    if (action == "gpsDiagnostic") {
      String response = command("AT+CGPSINFO", 5000);
      GpsFix fix;
      JsonDocument report;
      report["event"] = "gps_diagnostic";
      report["replyBytes"] = response.length();
      report["parseResult"] = int(parseGpsInfo(response.c_str(), fix));
      // Reveal framing/command mix-ups without exposing a location or timestamp.
      for (size_t i = 0; i < response.length(); ++i)
        if (response[i] >= '0' && response[i] <= '9') response.setCharAt(i, '#');
      report["replyShape"] = response;
      report["cellularDns"] = PPP.dnsIP().toString();
      if (PPP.hasIP()) PPP.setDefault();
      IPAddress resolved;
      report["endpointResolved"] = internetReady() && Network.hostByName("sightings.sasquatchcarpet.com", resolved) == 1;
      serializeJson(report, Serial); Serial.println(); continue;
    }
    if (action == "scanNetwork") { scanConfiguredNetwork(); continue; }
    if (action == "initializeStorage") {
      if (uploadInFlight) { Serial.println("{\"event\":\"error\",\"error\":\"upload_in_progress\"}"); continue; }
      if (storageReady) { Serial.println("{\"event\":\"error\",\"error\":\"storage_already_initialized\"}"); continue; }
      if (queueFile) queueFile.close();
      FFat.end();
      if (FFat.begin(true)) initQueue();
      printStatus("storage_initialized"); continue;
    }
    if (action == "configure") {
      String newSsid = doc["ssid"] | "", newPassword = doc["password"] | "";
      String newEndpoint = doc["endpoint"] | DEFAULT_ENDPOINT, newToken = doc["token"] | "";
      if (!doc["password"].is<const char *>() || newSsid.isEmpty() || newSsid.length() > 32 ||
          newPassword.length() > 63 || !validToken(newToken) ||
          newToken.indexOf('\r') >= 0 || newToken.indexOf('\n') >= 0 || !validEndpoint(newEndpoint)) {
        Serial.println("{\"event\":\"error\",\"error\":\"invalid_configuration\"}"); continue;
      }
      // One NVS blob avoids mixed old/new credentials after an interrupted update.
      JsonDocument stored;
      stored["ssid"] = newSsid; stored["password"] = newPassword;
      stored["endpoint"] = newEndpoint; stored["token"] = newToken;
      String encoded; serializeJson(stored, encoded);
      if (preferences.putString("config", encoded) != encoded.length()) {
        Serial.println("{\"event\":\"error\",\"error\":\"configuration_write_failed\"}"); continue;
      }
      ssid = newSsid; password = newPassword; endpoint = newEndpoint; token = newToken;
      configured = true; failures = 0; nextPostMs = 0; connectWifi();
      printStatus("configured"); continue;
    }
    Serial.println("{\"event\":\"error\",\"error\":\"unknown_command\"}");
  }
}
void formatUtc(int64_t epoch, char *buffer, size_t size) {
  time_t seconds = time_t(epoch); tm utc; gmtime_r(&seconds, &utc);
  strftime(buffer, size, "%Y-%m-%dT%H:%M:%SZ", &utc);
}
void uploadWorker(void *) {
  // This task owns HTTPS only. GPS, modem commands, flash, settings, and Serial
  // remain exclusively on loop(); queues transfer ownership of each request.
  NetworkClientSecure client;
  client.setCACert(TLS_ROOT_CA);
  HTTPClient http;
  http.setReuse(true);
  String previousEndpoint;
  uint32_t previousGeneration = UINT32_MAX;
  bool previousCellular = false;
  for (;;) {
    UploadRequest *request = nullptr;
    if (xQueueReceive(uploadRequests, &request, portMAX_DELAY) != pdTRUE) continue;
    const uint32_t started = millis();
    if (request->testDelayMs) vTaskDelay(pdMS_TO_TICKS(request->testDelayMs));
    if (request->endpoint != previousEndpoint || request->cellular != previousCellular || request->generation != previousGeneration) {
      client.stop();
      previousEndpoint = request->endpoint; previousCellular = request->cellular; previousGeneration = request->generation;
    }
    client.setHandshakeTimeout(request->cellular ? 15 : 5);
    http.setConnectTimeout(request->cellular ? 10000 : 4000);
    http.setTimeout(request->cellular ? 10000 : 5000);
    // Redirects stay disabled, and certificate/hostname validation stays enabled.
    if (http.begin(client, request->endpoint)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", "Bearer " + request->token);
      request->code = http.POST(request->payload);
      if (request->code > 0) {
        const String response = http.getString(); // Consume the body before reusing TCP.
        if (request->code == 200) {
          JsonDocument result;
          if (deserializeJson(result, response) || !result["ok"].is<bool>() || !result["ok"].as<bool>()) request->code = -2;
        }
      }
      char errorText[1];
      request->tlsError = request->code < 0 ? client.lastError(errorText, sizeof(errorText)) : 0;
      http.end();
    }
    if (request->code < 0) client.stop();
    if (request->code == 200 && request->checkOta) {
      client.stop();
      request->otaManifest = TrackerOta::poll(request->token, request->otaReport, request->otaHealthy);
    }
    request->durationMs = millis() - started;
    xQueueSend(uploadResults, &request, portMAX_DELAY);
  }
}
void collectUploadResults() {
  if (!uploaderReady) return;
  UploadRequest *request = nullptr;
  while (xQueueReceive(uploadResults, &request, 0) == pdTRUE) {
    uploadInFlight = false;
    lastHttpCode = request->code; lastTlsError = request->tlsError;
    lastUploadDurationMs = request->durationMs; lastHeartbeatMs = millis();
    if (lastHttpCode == 200) {
      for (size_t i = 0; i < request->count; ++i)
        if (uploadTicketIsCurrent(request->tickets[i], orders, QUEUE_SIZE)) acknowledge(request->tickets[i].slot);
      if (storageReady) queueFile.flush();
      failures = 0;
      if (request->checkOta) {
        TrackerOta::controlHealthy = request->otaHealthy;
        TrackerOta::offered = request->otaManifest;
      }
    } else if (failures < 5) ++failures;
    if (request->cellular) {
      if (lastHttpCode < 0) ++cellularUploadFailures; else cellularUploadFailures = 0;
      if (cellularUploadFailures >= 3) restartCellular();
    }
    if (lastHttpCode != 200) {
      uint32_t backoff = min(uint32_t(30000), uint32_t(1000) << failures);
      nextPostMs = millis() + min(uint32_t(30000), backoff + esp_random() % 500);
    } else {
      const bool moving = freshFix() && currentFix.speedMps > 0.5;
      const bool backlog = queued && request->count == BATCH_SIZE;
      nextPostMs = request->startedMs + ((moving || backlog) ? 2000 : 10000);
      // Respect the server's one-request/second limit after a slow request.
      if (int32_t(nextPostMs - millis()) < 1100) nextPostMs = millis() + 1100;
    }
    delete request;
    printStatus("telemetry");
  }
}
void postTelemetry() {
  if (!uploaderReady || uploadInFlight || !configured || !internetReady() || time(nullptr) < 1704067200) return;
  UploadRequest *request = new (std::nothrow) UploadRequest;
  if (!request) { nextPostMs = millis() + 2000; return; }
  batteryV = readBattery();
  JsonDocument body;
  body["firmware"] = FIRMWARE; body["bootId"] = bootId; body["uptimeMs"] = millis();
  if (std::isfinite(batteryV)) body["batteryV"] = batteryV; else body["batteryV"] = nullptr;
  body["gpsFix"] = freshFix();
  JsonArray points = body["points"].to<JsonArray>();
  request->count = selectUploadBatch(orders, QUEUE_SIZE, latestSlot, request->tickets, BATCH_SIZE);
  for (size_t i = 0; i < request->count; ++i) {
    Record record;
    if (!readRecord(request->tickets[i].slot, record)) { storageReady = false; delete request; return; }
    JsonObject point = points.add<JsonObject>();
    char recordedAt[25]; formatUtc(record.epoch, recordedAt, sizeof(recordedAt));
    point["bootId"] = String(record.bootId); point["seq"] = record.seq;
    point["recordedAt"] = String(recordedAt); point["lat"] = record.lat; point["lng"] = record.lng;
    if (std::isfinite(record.speedMps)) point["speedMps"] = record.speedMps; else point["speedMps"] = nullptr;
    if (std::isfinite(record.bearing)) point["bearing"] = record.bearing; else point["bearing"] = nullptr;
    point["satellites"] = nullptr; // CGPSINFO does not include a satellite count.
  }
  serializeJson(body, request->payload);
  request->endpoint = endpoint; request->token = token;
  lastUploadNetwork = activeNetwork();
  if (lastUploadNetwork == "cellular") { PPP.setDefault(); maintainCellularDns(true); }
  else WiFi.STA.setDefault();
  request->cellular = lastUploadNetwork == "cellular";
  request->checkOta = endpoint == DEFAULT_ENDPOINT && (!TrackerOta::lastCheck || millis() - TrackerOta::lastCheck >= 60000);
  if (request->checkOta) { request->otaReport = TrackerOta::report(); TrackerOta::lastCheck = millis(); }
  request->generation = cellularGeneration; request->startedMs = millis();
  request->testDelayMs = nextUploadDelayMs;
  if (xQueueSend(uploadRequests, &request, 0) == pdTRUE) { uploadInFlight = true; nextUploadDelayMs = 0; }
  else { delete request; nextPostMs = millis() + 1000; }
}
void setup() {
  Serial.setRxBufferSize(2048);
  Serial.begin(4000000);
  makeBootId();
  pinMode(MODEM_POWER, OUTPUT); digitalWrite(MODEM_POWER, HIGH);
  modem.setRxBufferSize(2048); modem.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  Wire.begin(15, 16); Wire.setTimeOut(50);
  preferences.begin("sq-tracker", false);
  diagnosticsEnabled = preferences.getBool("diagnostics", false);
  diagnosticsUntil = millis() + 1800000;
  JsonDocument stored;
  if (!deserializeJson(stored, preferences.getString("config", ""))) {
    ssid = stored["ssid"] | ""; password = stored["password"] | "";
    endpoint = stored["endpoint"] | DEFAULT_ENDPOINT; token = stored["token"] | "";
    configured = !ssid.isEmpty() && validToken(token) && validEndpoint(endpoint);
  }
  initQueue();
  TrackerOta::begin();
  uploadRequests = xQueueCreate(1, sizeof(UploadRequest *));
  uploadResults = xQueueCreate(1, sizeof(UploadRequest *));
  uploaderReady = uploadRequests && uploadResults && xTaskCreatePinnedToCore(uploadWorker, "trackerHTTPS", 16384, nullptr, 1, nullptr, 0) == pdPASS;
  if (!uploaderReady) {
    if (uploadRequests) vQueueDelete(uploadRequests);
    if (uploadResults) vQueueDelete(uploadResults);
    uploadRequests = nullptr; uploadResults = nullptr;
  }
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED &&
        info.wifi_sta_disconnected.reason != WIFI_REASON_ASSOC_LEAVE) {
      // Callback runs on another task. Ignore our deliberate disconnect/reconnects.
      lastWifiDisconnectReason.store(info.wifi_sta_disconnected.reason);
    }
  });
  WiFi.mode(WIFI_STA); WiFi.persistent(false); WiFi.setAutoReconnect(true);
  configTime(0, 0, "time.cloudflare.com", "pool.ntp.org", "time.google.com");
  connectWifi(); batteryV = readBattery(); printStatus("boot");
}
void loop() {
  collectUploadResults();
  if (cellularRestartPending && !uploadInFlight) restartCellular();
  processSerial();
  bool moving = freshFix() && currentFix.speedMps > 0.5;
  TrackerOta::health(configured && storageReady && uploaderReady && lastHttpCode == 200, moving);
  if (!uploadInFlight && !TrackerOta::pending && !TrackerOta::offered.isEmpty() &&
      internetReady() && int32_t(millis() - TrackerOta::retryAt) >= 0 && millis() - TrackerOta::parkedSince > 30000 && std::isfinite(batteryV) && batteryV >= 3.7) {
    JsonDocument manifest;
    if (!deserializeJson(manifest, TrackerOta::offered) && manifest["sequence"].as<uint32_t>() <= max(FIRMWARE_SEQUENCE, TrackerOta::failedSequence)) TrackerOta::offered = "";
    else { if (queueFile) queueFile.flush(); CameraUsb::stop(); TrackerOta::install(token); }
  }
  uint32_t now = millis();
  if (now - lastPollMs >= (modemReady ? 1000u : 5000u)) { lastPollMs = now; pollGps(); }
  connectCellular();
  if (PPP.hasIP() && !uploadInFlight && !wifiSuspendedForCellular) {
    WiFi.setAutoReconnect(false); WiFi.mode(WIFI_OFF);
    wifiSuspendedForCellular = true;
  }
  maintainCellularDns(false);
  if (configured && !PPP.hasIP() && WiFi.status() != WL_CONNECTED && millis() - lastConnectMs >= 15000) connectWifi();
  static bool hadInternet = false;
  if (internetReady() && !hadInternet) {
    if (PPP.hasIP()) PPP.setDefault(); else WiFi.STA.setDefault();
    configTime(0, 0, "time.cloudflare.com", "pool.ntp.org", "time.google.com");
    nextPostMs = 0;
  }
  hadInternet = internetReady();
  if (internetReady() && int32_t(millis() - nextPostMs) >= 0) postTelemetry();
  if (millis() - lastStatusMs >= 10000) { lastStatusMs = millis(); printStatus(); }
  // Low-brightness status: purple needs setup; blue waiting Internet; yellow waiting GPS;
  // green has a fresh fix; red signals persistent upload/storage failure.
  static uint32_t ledAt = 0;
  if (millis() - ledAt >= 1000) {
    ledAt = millis();
    if (!storageReady || !uploaderReady || failures >= 3) rgbLedWrite(STATUS_LED, 16, 0, 0);
    else if (!configured) rgbLedWrite(STATUS_LED, 8, 0, 8);
    else if (!internetReady()) rgbLedWrite(STATUS_LED, 0, 0, 16);
    else if (!freshFix()) rgbLedWrite(STATUS_LED, 12, 8, 0);
    else rgbLedWrite(STATUS_LED, 0, 12, 0);
  }
  delay(5);
}
