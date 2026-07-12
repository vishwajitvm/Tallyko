import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export default function BarcodeScannerScreen() {
  const { colors } = useTheme();
  const [manualCode, setManualCode] = useState('');

  const handleManualSearch = () => {
    if (!manualCode) return;
    Alert.alert("Product Found", `Simulated lookup for barcode: ${manualCode}`);
    setManualCode('');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Barcode Scanner</Text>
        <Text style={[styles.subtitle, { color: colors.secondary }]}>Scan item to view or edit</Text>
      </View>
      
      <View style={styles.content}>
        {/* Mock Camera View */}
        <View style={[styles.cameraMock, { backgroundColor: '#000', borderColor: colors.primary }]}>
          <View style={[styles.scanLine, { backgroundColor: colors.primary }]} />
          <Text style={styles.cameraText}>Camera Active...</Text>
          <Text style={styles.cameraSubtext}>(Simulated for Emulator/Web)</Text>
        </View>

        <Text style={[styles.orText, { color: colors.secondary }]}>— OR —</Text>

        <View style={styles.manualEntry}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.secondary + '50' }]}
            placeholder="Enter Barcode Manually"
            placeholderTextColor={colors.secondary}
            value={manualCode}
            onChangeText={setManualCode}
            keyboardType="numeric"
          />
          <TouchableOpacity 
            style={[styles.searchBtn, { backgroundColor: colors.primary }]} 
            onPress={handleManualSearch}
          >
            <Text style={styles.searchBtnText}>Lookup</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: 40, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '800' },
  subtitle: { fontSize: 16, marginTop: 5 },
  content: { padding: 20, alignItems: 'center' },
  cameraMock: {
    width: '100%',
    height: 300,
    borderRadius: 20,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
    position: 'relative',
    overflow: 'hidden'
  },
  scanLine: {
    position: 'absolute',
    top: '50%',
    width: '100%',
    height: 2,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
  },
  cameraText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  cameraSubtext: { color: '#aaa', fontSize: 14, marginTop: 5 },
  orText: { fontSize: 16, fontWeight: 'bold', marginBottom: 30 },
  manualEntry: {
    flexDirection: 'row',
    width: '100%',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    marginRight: 10,
  },
  searchBtn: {
    paddingHorizontal: 25,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  searchBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
