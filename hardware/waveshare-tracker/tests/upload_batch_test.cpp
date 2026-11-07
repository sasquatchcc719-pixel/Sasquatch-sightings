#include "../tracker/upload_batch.h"
#include <cassert>
#include <iostream>

int main() {
  uint64_t orders[] = {40, 10, 0, 20, 30, 0};
  UploadTicket batch[6];
  size_t count = selectUploadBatch(orders, 6, 0, batch, 6);
  assert(count == 4);
  assert(batch[0].slot == 0 && batch[1].slot == 1 && batch[2].slot == 3 && batch[3].slot == 4);
  // Simulate recording during a slow upload: the oldest slot gets overwritten.
  orders[1] = 41;
  for (size_t i = 0; i < count; ++i)
    if (uploadTicketIsCurrent(batch[i], orders, 6)) orders[batch[i].slot] = 0;
  assert(orders[1] == 41); // The old request must never acknowledge the new sample.
  assert(orders[0] == 0 && orders[3] == 0 && orders[4] == 0);
  count = selectUploadBatch(orders, 6, 1, batch, 6);
  assert(count == 1 && batch[0].slot == 1 && batch[0].order == 41);
  orders[1] = 0;
  assert(!uploadTicketIsCurrent(batch[0], orders, 6));
  assert(selectUploadBatch(orders, 6, -1, batch, 6) == 0);
  assert(!uploadTicketIsCurrent({-1, 1}, orders, 6));
  assert(!uploadTicketIsCurrent({6, 1}, orders, 6));
  orders[0] = 50; orders[1] = 20; orders[2] = 30;
  assert(selectUploadBatch(orders, 6, 0, batch, 2) == 2);
  assert(batch[0].slot == 0 && batch[1].slot == 1);
  assert(selectUploadBatch(orders, 6, 0, batch, 0) == 0);
  std::cout << "Upload ordering, bounded batches, and in-flight ring overwrite checks passed\n";
}
