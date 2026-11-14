#include <cassert>
#include "../tracker/reporting_policy.h"

int main() {
  using namespace ReportingPolicy;

  assert(shouldSaveFix(0, false));
  assert(shouldSaveFix(1000, true));
  assert(!shouldSaveFix(1000, false));

  assert(uploadIntervalMs(true, false) == 30000);
  assert(uploadIntervalMs(false, true) == 10000);
  assert(uploadIntervalMs(false, false) == 300000);

  assert(otaCheckDue(1000, 0));
  assert(!otaCheckDue(OTA_CHECK_INTERVAL_MS - 1, 1));
  assert(otaCheckDue(OTA_CHECK_INTERVAL_MS + 1, 1));

  assert(temperatureSampleDue(1, 0));
  assert(!temperatureSampleDue(TEMPERATURE_SAMPLE_INTERVAL_MS, 1));
  assert(temperatureSampleDue(TEMPERATURE_SAMPLE_INTERVAL_MS + 1, 1));
}
