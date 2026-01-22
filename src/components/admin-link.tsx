import Link from 'next/link';
import { Button } from './ui/button';
import { createClient } from '@/supabase/server';

export async function AdminLink() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user) return null;

  return (
    <Button size="sm" variant="default" asChild>
      <Link href="/admin">Admin</Link>
    </Button>
  );
}
