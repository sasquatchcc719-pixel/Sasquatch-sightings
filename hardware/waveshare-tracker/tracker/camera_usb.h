#pragma once
#include <esp_camera.h>
#include "gps_parser.h"

// Explicit USB requests only. No camera network listener or automatic uploads.
namespace CameraUsb {
static bool ready = false;
inline void error(const char *message, esp_err_t code = ESP_FAIL) {
  JsonDocument reply;
  reply["event"] = "camera_error"; reply["error"] = message; reply["code"] = int(code);
  serializeJson(reply, Serial); Serial.println();
}
inline bool start() {
  if (ready) return true;
  if (!psramFound()) { error("psram_unavailable"); return false; }
  camera_config_t config = {};
  config.pin_pwdn = -1; config.pin_reset = -1;
  config.pin_xclk = 39;
  // The MAX17048 and camera share GPIO15/16. Reuse Wire's initialized bus0.
  config.pin_sccb_sda = -1; config.pin_sccb_scl = -1; config.sccb_i2c_port = 0;
  config.pin_d0 = 7; config.pin_d1 = 8; config.pin_d2 = 9; config.pin_d3 = 10;
  config.pin_d4 = 11; config.pin_d5 = 12; config.pin_d6 = 13; config.pin_d7 = 14;
  config.pin_vsync = 42; config.pin_href = 41; config.pin_pclk = 46;
  config.xclk_freq_hz = 20000000;
  config.ledc_timer = LEDC_TIMER_0; config.ledc_channel = LEDC_CHANNEL_0;
  config.pixel_format = PIXFORMAT_JPEG; config.frame_size = FRAMESIZE_VGA;
  config.jpeg_quality = 16; config.fb_count = 2;
  config.fb_location = CAMERA_FB_IN_PSRAM; config.grab_mode = CAMERA_GRAB_LATEST;
  esp_err_t result = esp_camera_init(&config);
  if (result != ESP_OK) { error("check_CAM_switch_and_ribbon", result); return false; }
  ready = true;
  delay(300); // Allow automatic exposure to begin settling.
  return true;
}
inline void stop() {
  if (ready) esp_camera_deinit();
  ready = false;
}
inline void snapshot(bool fresh = true) {
  const bool starting = !ready;
  if (!start()) return;
  // Fresh stills discard old frames; continuous preview consumes each next frame.
  for (int i = 0; i < ((starting || fresh) ? 2 : 0); ++i) {
    camera_fb_t *old = esp_camera_fb_get();
    if (!old) { error("capture_timeout"); return; }
    esp_camera_fb_return(old);
  }
  camera_fb_t *frame = esp_camera_fb_get();
  if (!frame) { error("capture_timeout"); return; }
  if (frame->format != PIXFORMAT_JPEG || frame->len < 4 || frame->len > 131072 ||
      frame->buf[0] != 0xff || frame->buf[1] != 0xd8) {
    esp_camera_fb_return(frame); error("invalid_or_oversized_frame"); return;
  }
  JsonDocument header;
  header["event"] = "camera_frame"; header["bytes"] = frame->len;
  header["width"] = frame->width; header["height"] = frame->height;
  header["crc32"] = recordCrc(frame->buf, frame->len);
  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor) header["sensorPid"] = sensor->id.PID;
  // Header line, exactly `bytes` raw JPEG bytes, then newline. No status interleaving.
  serializeJson(header, Serial); Serial.println();
  Serial.write(frame->buf, frame->len); Serial.println(); Serial.flush();
  esp_camera_fb_return(frame);
}
} // namespace CameraUsb
