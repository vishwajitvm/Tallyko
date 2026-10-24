import React from 'react';
import { View } from 'react-native';
import { Text } from './ui/Text';
import { Button } from './ui/Button';

interface State { error: Error | null }

/** Last line of defence: a render crash shows a recovery screen instead of a blank app. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Tallyko] UI crash', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
        <Text variant="h2" align="center">Something went wrong on this screen</Text>
        <Text tone="muted" align="center">Your bills are safe. Try again, and if it keeps happening, restart the app.</Text>
        <Button title="Try again" icon="refresh" onPress={() => this.setState({ error: null })} />
      </View>
    );
  }
}
