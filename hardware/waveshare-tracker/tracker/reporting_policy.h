#pragma once
#include <stdint.h>

namespace ReportingPolicy {
constexpr uint32_t MOVING_UPLOAD_INTERVAL_MS = 30000;
constexpr uint32_t BACKLOG_UPLOAD_INTERVAL_MS = 10000;
constexpr uint32_t PARKED_UPLOAD_INTERVAL_MS = 300000;
constexpr uint32_t OTA_CHECK_INTERVAL_MS = 6u * 60u * 60u * 1000u;

inline bool shouldSaveFix(int64_t lastSavedEpoch, bool moving) {
  return moving || !lastSavedEpoch;
}

inline uint32_t uploadIntervalMs(bool moving, bool backlog) {
  if (backlog) return BACKLOG_UPLOAD_INTERVAL_MS;
  return moving ? MOVING_UPLOAD_INTERVAL_MS : PARKED_UPLOAD_INTERVAL_MS;
}

inline bool otaCheckDue(uint32_t now, uint32_t lastCheck) {
  return !lastCheck || now - lastCheck >= OTA_CHECK_INTERVAL_MS;
}
}
