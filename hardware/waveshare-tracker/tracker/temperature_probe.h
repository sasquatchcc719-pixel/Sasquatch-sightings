#pragma once
#include <OneWire.h>
#include <cmath>

namespace TemperatureProbe {
OneWire bus;
float celsius = NAN;
uint32_t phaseStartedMs = 0;
bool converting = false;

void poll(uint32_t now) {
  if (now - phaseStartedMs < (converting ? 750u : 1000u)) return;
  phaseStartedMs = now;

  if (!converting) {
    if (!bus.reset()) { celsius = NAN; return; }
    bus.skip(); // One externally powered DS18B20 on GPIO1.
    bus.write(0x44); // Convert T.
    converting = true;
    return;
  }

  converting = false;
  celsius = NAN;
  if (!bus.reset()) return;
  bus.skip();
  bus.write(0xBE); // Read scratchpad.
  uint8_t scratchpad[9];
  bus.read_bytes(scratchpad, sizeof(scratchpad));
  if (OneWire::crc8(scratchpad, 8) != scratchpad[8] ||
      (scratchpad[4] & 0x9F) != 0x1F) return;
  const int16_t raw = int16_t((uint16_t(scratchpad[1]) << 8) | scratchpad[0]);
  if (raw >= -55 * 16 && raw <= 125 * 16) celsius = raw / 16.0f;
}
}
