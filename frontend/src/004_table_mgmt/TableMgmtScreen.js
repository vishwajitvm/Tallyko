import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function TableMgmtScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Table Management Screen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold' },
});
