-- QuickBooks' own historical auto-numbering used 1000-series numbers years
-- ago (e.g. DocNumber 1003 was assigned to TxnId=7 and 1004 to TxnId=52 in
-- the QBO tenant). To avoid future collisions when our sequence hits those
-- values, jump the sequence past the known collision range.
SELECT setval('sasquatch_invoice_number_seq', 6100, true);
