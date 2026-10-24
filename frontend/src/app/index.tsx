import { Redirect } from 'expo-router';
import { useAuth } from '@/store/auth';

export default function Index() {
  const status = useAuth((s) => s.status);
  const session = useAuth((s) => s.session);
  if (status !== 'signedIn' || !session) return <Redirect href="/login" />;
  if (session.accountType === 'platform') return <Redirect href="/admin" />;
  return <Redirect href={session.role === 'kitchen' ? '/kitchen' : '/pos'} />;
}
