#include "../tracker/modem_reply.h"
#include "../tracker/gps_parser.h"
#include <cassert>
#include <iostream>
#include <string>

int main() {
  const std::string response = "\r\n+CGPSINFO: 3850.123456,N,10449.987654,W,191026,213045.0,1920.0,10.0,275.5\r\n\r\nOK\r\n";
  for (size_t split = 0; split < response.size(); ++split) {
    ModemReply reply;
    assert(reply.append(response.data(), split) == ModemReply::Result::Pending);
    assert(reply.append(response.data() + split, response.size() - split) == ModemReply::Result::Ok);
    GpsFix fix;
    assert(parseGpsInfo(reply.data, fix) == GpsResult::Fix);
    assert(fix.epoch == 1792445445);
  }
  ModemReply bytes;
  for (size_t i = 0; i < response.size(); ++i)
    assert(bytes.append(response.data() + i, 1) == (i + 1 == response.size() ? ModemReply::Result::Ok : ModemReply::Result::Pending));
  GpsFix fix;
  assert(parseGpsInfo(bytes.data, fix) == GpsResult::Fix);
  ModemReply blank;
  const std::string noFix = "\r\n+CGPSINFO: ,,,,,,,,\r\nOK\r\n";
  assert(blank.append(noFix.data(), noFix.size()) == ModemReply::Result::Ok);
  assert(parseGpsInfo(blank.data, fix) == GpsResult::NoFix);
  ModemReply error;
  assert(error.append("\r\n+CME ERR", 10) == ModemReply::Result::Pending);
  assert(error.append("OR: 3\r\n", 7) == ModemReply::Result::Error);
  ModemReply incidental;
  const std::string notDone = "\r\n+STATUS: BOOK\r\nOK";
  assert(incidental.append(notDone.data(), notDone.size()) == ModemReply::Result::Pending);
  assert(incidental.append("\r\n", 2) == ModemReply::Result::Ok);
  ModemReply overflow;
  std::string oversized(1025, 'x');
  assert(overflow.append(oversized.data(), oversized.size()) == ModemReply::Result::Error);
  assert(overflow.size == 0);
  std::cout << "Fragmented GPS replies, terminal lines, no-fix replies, and bounded buffers passed\n";
}
