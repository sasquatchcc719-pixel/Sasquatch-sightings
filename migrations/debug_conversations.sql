-- Debug: Show all conversations grouped by phone number
-- Run this in Supabase SQL Editor to see if you have duplicate conversations

SELECT 
  phone_number,
  COUNT(*) as conversation_count,
  STRING_AGG(id::text, ', ') as conversation_ids,
  STRING_AGG(status, ', ') as statuses,
  STRING_AGG(COALESCE(jsonb_array_length(messages)::text, '0'), ', ') as message_counts
FROM conversations
GROUP BY phone_number
ORDER BY conversation_count DESC;

-- Show detailed view of all conversations
SELECT 
  id,
  phone_number,
  status,
  jsonb_array_length(messages) as message_count,
  created_at,
  updated_at
FROM conversations
ORDER BY updated_at DESC;
