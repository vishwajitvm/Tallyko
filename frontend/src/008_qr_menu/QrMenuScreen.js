import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export default function QrMenuScreen() {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>QR Menu Settings</Text>
      </View>
      <View style={styles.content}>
        <View style={[styles.qrPlaceholder, { backgroundColor: colors.surface, borderColor: colors.secondary + '40' }]}>
          <Text style={[styles.qrText, { color: colors.secondary }]}>Scan to view menu</Text>
          <View style={styles.mockQrCode} />
        </View>
        
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]}>
          <Text style={styles.buttonText}>Download QR Code</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.buttonOutline, { borderColor: colors.primary }]}>
          <Text style={[styles.buttonOutlineText, { color: colors.primary }]}>Regenerate QR</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: 40, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '800' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  qrPlaceholder: {
    width: 250,
    height: 250,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
    borderStyle: 'dashed',
  },
  qrText: { fontSize: 16, marginBottom: 20 },
  mockQrCode: {
    width: 150,
    height: 150,
    backgroundColor: '#000',
    borderRadius: 10,
  },
  button: {
    width: '100%',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 15,
  },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  buttonOutline: {
    width: '100%',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
  },
  buttonOutlineText: { fontWeight: 'bold', fontSize: 16 }
});
