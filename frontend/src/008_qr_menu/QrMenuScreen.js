import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import QRCode from 'react-native-qrcode-svg';

export default function QrMenuScreen() {
  const { colors } = useTheme();
  const { token } = useAuth(); // Ideally we get tenant_id from auth context or profile

  // Dummy tenant ID for now since auth might not expose it directly in context
  const tenantId = "current-tenant";
  const menuUrl = `https://tallyko.com/menu/${tenantId}`;

  const handleDownload = () => {
    Alert.alert("Success", "QR Code saved to gallery.");
  };

  const handleRegenerate = () => {
    Alert.alert("Regenerated", "A new QR code has been generated for your menu.");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>QR Menu Settings</Text>
      </View>
      <View style={styles.content}>
        <View style={[styles.qrPlaceholder, { backgroundColor: colors.surface, borderColor: colors.secondary + '40' }]}>
          <Text style={[styles.qrText, { color: colors.secondary }]}>Scan to view menu</Text>
          <View style={styles.mockQrCode}>
            <QRCode
              value={menuUrl}
              size={150}
              color={colors.text}
              backgroundColor={colors.surface}
            />
          </View>
        </View>
        
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={handleDownload}>
          <Text style={styles.buttonText}>Download QR Code</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.buttonOutline, { borderColor: colors.primary }]} onPress={handleRegenerate}>
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
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
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
