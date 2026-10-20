#include "../tracker/gps_parser.h"
#include <cassert>
#include <iostream>
int main() {
  GpsFix f;
  assert(parseGpsInfo("\r\n+CGPSINFO: 3850.123456,N,10449.987654,W,191026,213045.0,1920.0,10.0,275.5\r\nOK\r\n", f) == GpsResult::Fix);
  assert(std::abs(f.lat - 38.8353909333333) < 1e-9);
  assert(std::abs(f.lng + 104.833127566667) < 1e-9);
  assert(std::abs(f.speedMps - 5.14444444) < 1e-5);
  assert(f.epoch == 1792445445);
  assert(parseGpsInfo("+CGPSINFO: ,,,,,,,,\r\n", f) == GpsResult::NoFix);
  assert(parseGpsInfo("OK", f) == GpsResult::Invalid);
  assert(parseGpsInfo("+CGPSINFO: 3860.1,N,10449.9,W,191026,213045.0,0,0,0", f) == GpsResult::Invalid);
  assert(parseGpsInfo("+CGPSINFO: 3850.1,Q,10449.9,W,191026,213045.0,0,0,0", f) == GpsResult::Invalid);
  assert(parseGpsInfo("+CGPSINFO: 3850.1,N,10449.9,W,311126,213045.0,0,0,0", f) == GpsResult::Invalid);
  assert(parseGpsInfo("+CGPSINFO: 3850.1,N,10449.9,W,290224,213045.0,0,,", f) == GpsResult::Fix);
  assert(std::isnan(f.speedMps) && std::isnan(f.bearing));
  assert(parseGpsInfo("+CGPSINFO: 3850.1,N,10449.9,W,290225,213045.0,0,0,0", f) == GpsResult::Invalid);
  assert(parseGpsInfo("+CGPSINFO: 9000.01,N,10449.9,W,191026,213045.0,0,0,0", f) == GpsResult::Invalid);
  assert(parseGpsInfo("+CGPSINFO: 3850.1,N,10449.9,W,191026,243045.0,0,0,0", f) == GpsResult::Invalid);
  assert(parseGpsInfo("+CGPSINFO: 3850.1,N,10449.9,W,191026,213045.0,0,-1,0", f) == GpsResult::Invalid);
  assert(parseGpsInfo("+CGPSINFO: 3850.1,N,10449.9,W,191026,213045.0,0,300,0", f) == GpsResult::Fix);
  assert(std::isnan(f.speedMps));
  assert(gnssPowerIsOn("\r\n+CGNSSPWR: 1\r\n\r\nOK\r\n"));
  assert(gnssPowerIsOn("\r\n+CGNSSPWR:1\r\nOK\r\n"));
  assert(!gnssPowerIsOn("\r\n+CGNSSPWR: 0\r\nOK\r\n"));
  assert(!gnssPowerIsOn("\r\n+CGNSSPWR: 10\r\nOK\r\n"));
  assert(!gnssPowerIsOn("\r\n+CGNSSPWR: 1\r\nERROR\r\n"));
  assert(!gnssPowerIsOn("\r\nOK\r\n"));
  assert(recordCrc("123456789", 9) == 0xcbf43926);
  std::cout << "GPS parser and record CRC checks passed\n";
}
