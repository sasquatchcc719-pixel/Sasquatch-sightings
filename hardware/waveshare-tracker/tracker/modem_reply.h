#pragma once
#include <cstddef>
#include <cstring>

// CMUX can split one AT response line across multiple receive callbacks.
// Retain every fragment until a complete terminal line arrives.
struct ModemReply {
  enum class Result { Pending, Ok, Error };
  char data[1025] = {};
  size_t size = 0, scanned = 0;
  Result result = Result::Pending;

  Result append(const void *bytes, size_t length) {
    if (result != Result::Pending) return result;
    if (length > sizeof(data) - 1 - size) return result = Result::Error;
    memcpy(data + size, bytes, length); size += length; data[size] = 0;
    while (scanned < size) {
      const char *end = static_cast<const char *>(memchr(data + scanned, '\n', size - scanned));
      if (!end) break;
      size_t count = size_t(end - (data + scanned));
      if (count && data[scanned + count - 1] == '\r') --count;
      const char *line = data + scanned;
      scanned = size_t(end - data) + 1;
      if (count == 2 && memcmp(line, "OK", 2) == 0) return result = Result::Ok;
      if ((count == 5 && memcmp(line, "ERROR", 5) == 0) ||
          (count >= 11 && (memcmp(line, "+CME ERROR:", 11) == 0 || memcmp(line, "+CMS ERROR:", 11) == 0)))
        return result = Result::Error;
    }
    return result;
  }
};
