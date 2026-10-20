#include <Arduino.h>
#include <ArduinoJson.h>
#include <FFat.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <Preferences.h>
#include <WiFi.h>
#include <Wire.h>
#include <esp_system.h>
#include <esp_wifi.h>
#include <atomic>
#include <sys/time.h>
#include <time.h>
#include "gps_parser.h"
#include "camera_usb.h"
#include "tls_root.h"

// Waveshare V2 schematic; these differ from older board revisions.
constexpr int MODEM_RX = 17, MODEM_TX = 18, MODEM_POWER = 21, STATUS_LED = 38;
constexpr size_t QUEUE_SIZE = 5000, BATCH_SIZE = 32;
constexpr uint32_t RECORD_MAGIC = 0x53515431;
constexpr char FIRMWARE[] = "sasquatch-waveshare-v2/0.2.1";
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
float batteryV = NAN;

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
  if (fix.epoch != lastRecordedEpoch) { saveFix(fix); lastRecordedEpoch = fix.epoch; }
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
  doc["configured"] = configured; doc["wifiConnected"] = WiFi.status() == WL_CONNECTED;
  doc["wifiStatus"] = int(WiFi.status());
  doc["lastWifiDisconnectReason"] = lastWifiDisconnectReason.load();
  doc["cameraReady"] = CameraUsb::ready;
  doc["modemReady"] = modemReady; doc["gpsFix"] = freshFix();
  doc["clockReady"] = time(nullptr) >= 1704067200;
  doc["storageReady"] = storageReady; doc["queued"] = queued;
  doc["discardedOldest"] = dropped; doc["lastHttpCode"] = lastHttpCode;
  if (std::isfinite(batteryV)) doc["batteryV"] = batteryV; else doc["batteryV"] = nullptr;
  serializeJson(doc, Serial); Serial.println();
}
void connectWifi() {
  if (!configured) return;
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
    if (action == "scanNetwork") { scanConfiguredNetwork(); continue; }
    if (action == "initializeStorage") {
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
void postTelemetry() {
  if (!configured || WiFi.status() != WL_CONNECTED || time(nullptr) < 1704067200) return;
  JsonDocument body;
  body["firmware"] = FIRMWARE; body["bootId"] = bootId; body["uptimeMs"] = millis();
  if (std::isfinite(batteryV)) body["batteryV"] = batteryV; else body["batteryV"] = nullptr;
  body["gpsFix"] = freshFix();
  JsonArray points = body["points"].to<JsonArray>();
  int selected[BATCH_SIZE]; size_t selectedCount = 0;
  if (latestSlot >= 0 && orders[latestSlot]) selected[selectedCount++] = latestSlot;
  while (selectedCount < BATCH_SIZE) {
    int oldest = -1;
    for (size_t i = 0; i < QUEUE_SIZE; ++i) {
      if (!orders[i]) continue;
      bool used = false;
      for (size_t j = 0; j < selectedCount; ++j) if (selected[j] == int(i)) { used = true; break; }
      if (!used && (oldest < 0 || orders[i] < orders[oldest])) oldest = i;
    }
    if (oldest < 0) break;
    selected[selectedCount++] = oldest;
  }
  for (size_t i = 0; i < selectedCount; ++i) {
    Record record;
    if (!readRecord(selected[i], record)) { storageReady = false; return; }
    JsonObject point = points.add<JsonObject>();
    char recordedAt[25]; formatUtc(record.epoch, recordedAt, sizeof(recordedAt));
    point["bootId"] = String(record.bootId); point["seq"] = record.seq;
    point["recordedAt"] = String(recordedAt); point["lat"] = record.lat; point["lng"] = record.lng;
    if (std::isfinite(record.speedMps)) point["speedMps"] = record.speedMps; else point["speedMps"] = nullptr;
    if (std::isfinite(record.bearing)) point["bearing"] = record.bearing; else point["bearing"] = nullptr;
    point["satellites"] = nullptr; // CGPSINFO does not include a satellite count.
  }
  String payload; serializeJson(body, payload);
  NetworkClientSecure client; client.setCACert(TLS_ROOT_CA); client.setHandshakeTimeout(5);
  HTTPClient http; http.setConnectTimeout(4000); http.setTimeout(5000);
  // Redirects stay disabled so credentials never follow an unexpected destination.
  if (!http.begin(client, endpoint)) { lastHttpCode = -1; }
  else {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", "Bearer " + token);
    lastHttpCode = http.POST(payload);
    if (lastHttpCode == 200) {
      JsonDocument result;
      auto error = deserializeJson(result, http.getString());
      if (!error && result["ok"].is<bool>() && result["ok"].as<bool>()) {
        for (size_t i = 0; i < selectedCount; ++i) acknowledge(selected[i]);
        if (storageReady) queueFile.flush();
        failures = 0;
      } else lastHttpCode = -2;
    }
    http.end();
  }
  lastHeartbeatMs = millis();
  if (lastHttpCode != 200) {
    if (failures < 5) ++failures;
    uint32_t backoff = min(uint32_t(30000), uint32_t(1000) << failures);
    nextPostMs = millis() + min(uint32_t(30000), backoff + esp_random() % 500);
  } else nextPostMs = millis() + ((queued || (freshFix() && currentFix.speedMps > 0.5)) ? 2000 : 10000);
  printStatus("telemetry");
}
void setup() {
  Serial.setRxBufferSize(2048);
  Serial.begin(921600);
  makeBootId();
  pinMode(MODEM_POWER, OUTPUT); digitalWrite(MODEM_POWER, HIGH);
  modem.setRxBufferSize(2048); modem.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  Wire.begin(15, 16); Wire.setTimeOut(50);
  preferences.begin("sq-tracker", false);
  JsonDocument stored;
  if (!deserializeJson(stored, preferences.getString("config", ""))) {
    ssid = stored["ssid"] | ""; password = stored["password"] | "";
    endpoint = stored["endpoint"] | DEFAULT_ENDPOINT; token = stored["token"] | "";
    configured = !ssid.isEmpty() && validToken(token) && validEndpoint(endpoint);
  }
  initQueue();
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
  processSerial();
  uint32_t now = millis();
  if (now - lastPollMs >= (modemReady ? 1000u : 5000u)) { lastPollMs = now; pollGps(); }
  if (configured && WiFi.status() != WL_CONNECTED && millis() - lastConnectMs >= 15000) connectWifi();
  if (WiFi.status() == WL_CONNECTED && int32_t(millis() - nextPostMs) >= 0) { batteryV = readBattery(); postTelemetry(); }
  if (millis() - lastStatusMs >= 10000) { lastStatusMs = millis(); printStatus(); }
  // Low-brightness status: purple needs setup; blue waiting Wi-Fi; yellow waiting GPS;
  // green has a fresh fix; red signals persistent upload/storage failure.
  static uint32_t ledAt = 0;
  if (millis() - ledAt >= 1000) {
    ledAt = millis();
    if (!storageReady || failures >= 3) rgbLedWrite(STATUS_LED, 16, 0, 0);
    else if (!configured) rgbLedWrite(STATUS_LED, 8, 0, 8);
    else if (WiFi.status() != WL_CONNECTED) rgbLedWrite(STATUS_LED, 0, 0, 16);
    else if (!freshFix()) rgbLedWrite(STATUS_LED, 12, 8, 0);
    else rgbLedWrite(STATUS_LED, 0, 12, 0);
  }
  delay(5);
}
