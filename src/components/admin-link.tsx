import Link from 'next/link';
import { Button } from './ui/button';
import { createClient } from '@/supabase/server';

export async function AdminLink() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  // Always show admin button - auth pages will handle login redirect
  return (
    <Button 
      size="sm" 
      variant={user ? "default" : "outline"} 
      asChild
    >
      <Link href="/admin">Admin</Link>
    </Button>
  );
}
