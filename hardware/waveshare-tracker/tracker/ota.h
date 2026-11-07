#pragma once
#include <esp_ota_ops.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>
#include "ota_public_key.h"

// Override Arduino's default immediate confirmation. Only main-loop health
// plus authenticated Sightings contact can confirm a newly booted OTA image.
extern "C" bool verifyRollbackLater() { return true; }

namespace TrackerOta {
constexpr char BOARD[] = "ESP32-S3-SIM7670G-4G-V2";
constexpr char URL[] = "https://sightings.sasquatchcarpet.com/api/devices/trackers/firmware";
Preferences state;
bool pending = false, controlHealthy = false, confirmed = false;
uint32_t failedSequence = 0, lastCheck = 0, parkedSince = 0, retryAt = 0;
uint8_t downloadFailures = 0;
String status = "ready", offered;

void begin() {
  state.begin("sq-ota", false);
  failedSequence = state.getUInt("failed", 0);
  const uint32_t attempt = state.getUInt("attempt", 0);
  esp_ota_img_states_t imageState;
  pending = esp_ota_get_state_partition(esp_ota_get_running_partition(), &imageState) == ESP_OK && imageState == ESP_OTA_IMG_PENDING_VERIFY;
  if (attempt > FIRMWARE_SEQUENCE) {
    failedSequence = max(failedSequence, attempt);
    state.putUInt("failed", failedSequence);
    status = "rolled_back";
  } else if (pending) status = "pending";
  else { confirmed = true; status = "confirmed"; }
}
String report() {
  JsonDocument doc;
  doc["version"] = FIRMWARE; doc["sequence"] = FIRMWARE_SEQUENCE; doc["state"] = status;
  String value; serializeJson(doc, value); return value;
}
class LimitedBody : public Stream {
 public:
  String value;
  size_t write(uint8_t c) override { return write(&c, 1); }
  size_t write(const uint8_t *data, size_t size) override {
    if (value.length() + size > 2048) return 0;
    return value.concat(reinterpret_cast<const char *>(data), size) ? size : 0;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
};
// Runs only on the HTTPS worker, with immutable snapshots supplied by loop().
String poll(const String &token, const String &report, bool &healthy) {
  healthy = false;
  NetworkClientSecure client; client.setCACert(TLS_ROOT_CA); client.setHandshakeTimeout(15);
  HTTPClient http; http.setConnectTimeout(10000); http.setTimeout(10000);
  if (!http.begin(client, URL)) return "";
  http.addHeader("Authorization", "Bearer " + token); http.addHeader("Content-Type", "application/json");
  int code = http.POST(report); http.getString(); http.end();
  if (code != 200) return "";
  if (!http.begin(client, URL)) return "";
  http.addHeader("Authorization", "Bearer " + token);
  code = http.GET();
  String body;
  if (code == 200 && http.getSize() <= 2048) {
    LimitedBody sink;
    if (http.writeToStream(&sink) >= 0) body = sink.value;
  }
  healthy = code == 204 || (code == 200 && body.length() > 0 && body.length() <= 2048);
  http.end(); return body;
}
bool hexDigest(const String &value) {
  if (value.length() != 64) return false;
  for (char c : value) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  return true;
}
bool validManifest(JsonDocument &doc) {
  const esp_partition_t *partition = esp_ota_get_next_update_partition(nullptr);
  if (!partition || !doc["sequence"].is<uint32_t>() || !doc["size"].is<uint32_t>()) return false;
  uint32_t sequence = doc["sequence"], size = doc["size"];
  String board = doc["board"] | "", version = doc["version"] | "", digest = doc["sha256"] | "";
  String id = doc["id"] | "", signature = doc["signature"] | "";
  if (board != BOARD || sequence <= FIRMWARE_SEQUENCE || sequence <= failedSequence || sequence > INT32_MAX ||
      !size || size > partition->size || version.isEmpty() || version.length() > 64 || !hexDigest(digest) || id.length() != 36) return false;
  for (size_t i = 0; i < id.length(); ++i) {
    char c = id[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
    else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  for (char c : version) if (!isalnum(static_cast<unsigned char>(c)) && c != '/' && c != '.' && c != '-') return false;
  String canonical = "sasquatch-tracker|" + id + "|" + board + "|" + String(sequence) + "|" + version + "|" + String(size) + "|" + digest;
  uint8_t hash[32], sig[80]; size_t sigLength = 0;
  if (signature.length() > 104 || mbedtls_base64_decode(sig, sizeof(sig), &sigLength,
      reinterpret_cast<const uint8_t *>(signature.c_str()), signature.length()) != 0) return false;
  mbedtls_sha256(reinterpret_cast<const uint8_t *>(canonical.c_str()), canonical.length(), hash, 0);
  mbedtls_pk_context pk; mbedtls_pk_init(&pk);
  bool valid = mbedtls_pk_parse_public_key(&pk, reinterpret_cast<const uint8_t *>(OTA_PUBLIC_KEY), sizeof(OTA_PUBLIC_KEY)) == 0 &&
    mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, hash, sizeof(hash), sig, sigLength) == 0;
  mbedtls_pk_free(&pk); return valid;
}
void sendState(const String &token) {
  NetworkClientSecure client; client.setCACert(TLS_ROOT_CA); client.setHandshakeTimeout(15);
  HTTPClient http; http.setConnectTimeout(10000); http.setTimeout(10000);
  if (http.begin(client, URL)) {
    http.addHeader("Authorization", "Bearer " + token); http.addHeader("Content-Type", "application/json");
    http.POST(report()); http.getString(); http.end();
  }
}
// Explicit maintenance window: the worker has released HTTPS, the van has been
// stationary, and main owns NVS/FFat. Interrupted writes never select the new slot.
void install(const String &token) {
  JsonDocument doc;
  if (deserializeJson(doc, offered) || !validManifest(doc)) { status = "rejected"; offered = ""; return; }
  offered = "";
  status = "installing"; sendState(token);
  const esp_partition_t *partition = esp_ota_get_next_update_partition(nullptr);
  NetworkClientSecure client; client.setCACert(TLS_ROOT_CA); client.setHandshakeTimeout(15);
  HTTPClient http; http.setConnectTimeout(10000); http.setTimeout(15000);
  String url = String(URL) + "/image?release=" + doc["id"].as<String>();
  uint32_t expected = doc["size"];
  esp_ota_handle_t handle = 0;
  bool started = false, ok = http.begin(client, url);
  if (ok) {
    http.addHeader("Authorization", "Bearer " + token);
    ok = http.GET() == 200 && http.getSize() == int(expected);
  }
  if (ok) { ok = esp_ota_begin(partition, expected, &handle) == ESP_OK; started = ok; }
  mbedtls_sha256_context sha; mbedtls_sha256_init(&sha); mbedtls_sha256_starts(&sha, 0);
  uint32_t received = 0, lastByte = millis(), start = millis(), progress = 0;
  uint8_t buffer[2048];
  auto stream = http.getStreamPtr();
  while (ok && received < expected) {
    int available = stream->available();
    if (available > 0) {
      size_t count = min(size_t(available), min(sizeof(buffer), size_t(expected - received)));
      int bytes = stream->read(buffer, count);
      if (bytes <= 0) { ok = false; break; }
      ok = esp_ota_write(handle, buffer, bytes) == ESP_OK;
      mbedtls_sha256_update(&sha, buffer, bytes); received += bytes; lastByte = millis();
    } else if (!http.connected() || millis() - lastByte > 15000) ok = false;
    if (received - progress >= 131072) {
      progress = received;
      Serial.printf("{\"event\":\"ota_download\",\"bytes\":%u,\"total\":%u}\n", received, expected);
    }
    if (millis() - start > 600000) ok = false;
    delay(1);
  }
  uint8_t hash[32]; char hex[65];
  mbedtls_sha256_finish(&sha, hash); mbedtls_sha256_free(&sha);
  for (int i = 0; i < 32; ++i) snprintf(hex + i * 2, 3, "%02x", hash[i]);
  ok = ok && received == expected && doc["sha256"].as<String>() == hex;
  http.end();
  if (started) {
    if (ok) { ok = esp_ota_end(handle) == ESP_OK; started = false; }
    else esp_ota_abort(handle);
  }
  uint32_t sequence = doc["sequence"];
  if (ok) ok = state.putUInt("attempt", sequence) == sizeof(uint32_t);
  if (ok) ok = esp_ota_set_boot_partition(partition) == ESP_OK;
  if (ok) { status = "pending"; sendState(token); if (PPP.handle() != nullptr) { PPP.mode(ESP_MODEM_MODE_COMMAND); PPP.end(); }
    delay(100); ESP.restart(); }
  downloadFailures = min(uint8_t(5), uint8_t(downloadFailures + 1));
  retryAt = millis() + (60000u << downloadFailures);
  status = "download_failed"; sendState(token);
}
void health(bool ready, bool moving) {
  if (moving) parkedSince = millis();
  if (pending && OTA_ROLLBACK_TEST && millis() > 5000) {
    if (PPP.handle() != nullptr) { PPP.mode(ESP_MODEM_MODE_COMMAND); PPP.end(); }
    ESP.restart();
  }
  if (pending && ready && controlHealthy && millis() > 60000) {
    if (esp_ota_mark_app_valid_cancel_rollback() == ESP_OK) {
      pending = false; confirmed = true; status = "confirmed";
      state.putUInt("attempt", FIRMWARE_SEQUENCE); lastCheck = 0;
    }
  }
  if (pending && millis() > 300000) {
    if (PPP.handle() != nullptr) { PPP.mode(ESP_MODEM_MODE_COMMAND); PPP.end(); }
    esp_ota_mark_app_invalid_rollback_and_reboot();
  }
}
}
