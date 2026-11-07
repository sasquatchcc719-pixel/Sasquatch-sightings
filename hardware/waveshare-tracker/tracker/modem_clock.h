#pragma once
#include "gps_parser.h"

// CCLK uses a signed timezone offset in quarter hours. This is only a TLS
// bootstrap clock; GPS observations keep their own receiver-supplied UTC.
inline bool parseModemClock(const char *response, int64_t &epoch) {
  const char *start = strstr(response, "+CCLK:");
  if (!start) return false;
  int year, month, day, hour, minute, second, quarters, consumed = 0;
  char sign;
  if (sscanf(start, "+CCLK: \"%2d/%2d/%2d,%2d:%2d:%2d%c%2d\"%n",
      &year, &month, &day, &hour, &minute, &second, &sign, &quarters, &consumed) != 8 || !consumed) return false;
  const int monthDays[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  if (year < 24 || year > 99 || month < 1 || month > 12 || day < 1 ||
      day > monthDays[month - 1] + (month == 2 && year % 4 == 0) ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 ||
      (sign != '+' && sign != '-') || quarters < 0 || quarters > (sign == '+' ? 56 : 48)) return false;
  epoch = daysSinceEpoch(2000 + year, month, day) * 86400 + hour * 3600 + minute * 60 + second
    - (sign == '+' ? 1 : -1) * quarters * 900;
  return true;
}
