import React from 'react';
import { View, Text, StyleSheet, Button } from 'react-native';

export default function LoginScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>
      <Button title="Go to Main Tabs" onPress={() => navigation.navigate('MainTabs')} />
      <Button title="Go to Signup" onPress={() => navigation.navigate('Signup')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
});
