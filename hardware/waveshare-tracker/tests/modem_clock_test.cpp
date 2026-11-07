#include "../tracker/modem_clock.h"
#include <cassert>
#include <iostream>

int main() {
  int64_t epoch;
  assert(parseModemClock("\r\n+CCLK: \"26/11/06,18:00:00-28\"\r\nOK\r\n", epoch));
  assert(epoch == daysSinceEpoch(2026, 11, 7) * 86400 + 3600);
  assert(parseModemClock("+CCLK: \"26/11/07,09:00:00+32\"", epoch));
  assert(epoch == daysSinceEpoch(2026, 11, 7) * 86400 + 3600);
  assert(parseModemClock("+CCLK: \"24/02/29,12:30:45+00\"", epoch));
  assert(!parseModemClock("+CCLK: \"25/02/29,12:30:45+00\"", epoch));
  assert(!parseModemClock("+CCLK: \"23/11/06,18:00:00-28\"", epoch));
  assert(!parseModemClock("+CCLK: \"26/13/06,18:00:00-28\"", epoch));
  assert(!parseModemClock("+CCLK: \"26/11/31,18:00:00-28\"", epoch));
  assert(!parseModemClock("+CCLK: \"26/11/06,24:00:00-28\"", epoch));
  assert(!parseModemClock("+CCLK: \"26/11/06,18:00:00x28\"", epoch));
  assert(!parseModemClock("+CCLK: \"26/11/06,18:00:00+99\"", epoch));
  assert(!parseModemClock("+CCLK: \"26/11/06,18:00:00+00", epoch));
  assert(!parseModemClock("ERROR", epoch));
  std::cout << "Modem clock UTC, timezone, leap date, and invalid reply checks passed\n";
}
