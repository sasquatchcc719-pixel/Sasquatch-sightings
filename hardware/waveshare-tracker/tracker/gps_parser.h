#pragma once
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

struct GpsFix {
  double lat = 0, lng = 0;
  float speedMps = NAN, bearing = NAN;
  int64_t epoch = 0;
};
enum class GpsResult { Invalid, NoFix, Fix };

inline bool parseNumber(const char *s, double &value) {
  if (!s || !*s) return false;
  char *end;
  value = strtod(s, &end);
  return *end == '\0' && std::isfinite(value);
}
inline bool parseCoordinate(const char *s, const char *direction, bool latitude, double &value) {
  double raw;
  if (!parseNumber(s, raw) || raw < 0 || strlen(direction) != 1) return false;
  const int degrees = int(raw / 100);
  const double minutes = raw - degrees * 100;
  const char d = direction[0];
  if (minutes >= 60 || (latitude ? d != 'N' && d != 'S' : d != 'E' && d != 'W')) return false;
  value = degrees + minutes / 60;
  if (value > (latitude ? 90 : 180)) return false;
  if (d == 'S' || d == 'W') value = -value;
  return true;
}
inline int64_t daysSinceEpoch(int year, unsigned month, unsigned day) {
  year -= month <= 2;
  const int era = year / 400;
  const unsigned yoe = unsigned(year - era * 400);
  const unsigned doy = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1;
  return int64_t(era) * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
}
inline GpsResult parseGpsInfo(const char *line, GpsFix &fix) {
  const char *start = strstr(line, "+CGPSINFO:");
  if (!start) return GpsResult::Invalid;
  start += strlen("+CGPSINFO:");
  while (*start == ' ') ++start;
  char copy[256];
  size_t length = strcspn(start, "\r\n");
  if (length >= sizeof(copy)) return GpsResult::Invalid;
  memcpy(copy, start, length); copy[length] = 0;
  char *fields[9]; size_t count = 1; fields[0] = copy;
  for (size_t i = 0; i < length; ++i) if (copy[i] == ',') {
    copy[i] = 0;
    if (count < 9) fields[count++] = copy + i + 1;
    else return GpsResult::Invalid;
  }
  if (count != 9) return GpsResult::Invalid;
  bool empty = true;
  for (const auto field : fields) if (*field) empty = false;
  if (empty) return GpsResult::NoFix;
  GpsFix candidate;
  if (!parseCoordinate(fields[0], fields[1], true, candidate.lat) ||
      !parseCoordinate(fields[2], fields[3], false, candidate.lng)) return GpsResult::Invalid;
  if (strlen(fields[4]) != 6 || strlen(fields[5]) < 6) return GpsResult::Invalid;
  for (int i = 0; i < 6; ++i) if (fields[4][i] < '0' || fields[4][i] > '9' || fields[5][i] < '0' || fields[5][i] > '9') return GpsResult::Invalid;
  const auto pair = [](const char *p) { return (p[0] - '0') * 10 + p[1] - '0'; };
  int day = pair(fields[4]), month = pair(fields[4] + 2), year = 2000 + pair(fields[4] + 4);
  int hour = pair(fields[5]), minute = pair(fields[5] + 2), second = pair(fields[5] + 4);
  const int monthDays[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  if (year < 2024 || month < 1 || month > 12 || day < 1 ||
      day > monthDays[month - 1] + (month == 2 && year % 4 == 0) || hour > 23 || minute > 59 || second > 59) return GpsResult::Invalid;
  double utc;
  if (!parseNumber(fields[5], utc)) return GpsResult::Invalid;
  candidate.epoch = daysSinceEpoch(year, month, day) * 86400 + hour * 3600 + minute * 60 + second;
  double n;
  if (*fields[7]) {
    if (!parseNumber(fields[7], n) || n < 0 || n > 1000) return GpsResult::Invalid;
    // Keep a valid position when the receiver reports an implausible speed;
    // the telemetry API accepts at most 150 m/s.
    const double metersPerSecond = n * 0.514444444;
    if (metersPerSecond <= 150) candidate.speedMps = metersPerSecond;
  }
  if (*fields[8]) {
    if (!parseNumber(fields[8], n) || n < 0 || n > 360) return GpsResult::Invalid;
    candidate.bearing = n == 360 ? 0 : n;
  }
  fix = candidate;
  return GpsResult::Fix;
}
inline bool gnssPowerIsOn(const char *response) {
  if (!strstr(response, "\r\nOK\r\n")) return false;
  const char *p = strstr(response, "+CGNSSPWR:");
  if (!p) return false;
  p += strlen("+CGNSSPWR:");
  while (*p == ' ') ++p;
  if (*p++ != '1') return false;
  while (*p == ' ') ++p;
  return *p == '\r' || *p == '\n';
}
inline uint32_t recordCrc(const void *data, size_t size) {
  uint32_t crc = 0xffffffff;
  const auto bytes = static_cast<const uint8_t *>(data);
  for (size_t i = 0; i < size; ++i) {
    crc ^= bytes[i];
    for (int bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}
