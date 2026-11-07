#pragma once
#include <cstddef>
#include <cstdint>

struct UploadTicket { int slot; uint64_t order; };

inline size_t selectUploadBatch(const uint64_t *orders, size_t slots, int latest,
                               UploadTicket *out, size_t capacity) {
  size_t count = 0;
  if (capacity && latest >= 0 && size_t(latest) < slots && orders[latest])
    out[count++] = {latest, orders[latest]};
  while (count < capacity) {
    int oldest = -1;
    for (size_t i = 0; i < slots; ++i) {
      if (!orders[i]) continue;
      bool used = false;
      for (size_t j = 0; j < count; ++j) if (out[j].slot == int(i)) used = true;
      if (!used && (oldest < 0 || orders[i] < orders[oldest])) oldest = int(i);
    }
    if (oldest < 0) break;
    out[count++] = {oldest, orders[oldest]};
  }
  return count;
}

// New GPS samples may reuse a full ring slot while an upload is in flight.
inline bool uploadTicketIsCurrent(const UploadTicket &ticket, const uint64_t *orders, size_t slots) {
  return ticket.slot >= 0 && size_t(ticket.slot) < slots && ticket.order && orders[ticket.slot] == ticket.order;
}
