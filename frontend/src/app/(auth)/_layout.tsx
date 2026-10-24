import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/store/auth';

export default function AuthGroupLayout() {
  const status = useAuth((s) => s.status);
  if (status === 'signedIn') return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
