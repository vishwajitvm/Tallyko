import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = 'http://127.0.0.1:8000/api/v1';

export default function AiUploadScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    // In a real app we'd use ImagePicker here. For MVP we simulate uploading a dummy file.
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: 'file://dummy/path/menu.jpg',
        name: 'menu.jpg',
        type: 'image/jpeg'
      });

      const response = await axios.post(`${API_URL}/ai/upload-menu`, formData, {
        headers: { 
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${token}` 
        }
      });
      Alert.alert("Success", response.data.message + "\nExtracted: " + response.data.extracted_items.length + " items");
    } catch (error) {
      console.error("Failed to upload menu", error);
      Alert.alert("Error", "AI Processing failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>AI Menu Upload</Text>
      </View>
      <View style={styles.content}>
        <Text style={[styles.description, { color: colors.secondary }]}>
          Upload a photo of your physical menu, and our AI will automatically extract all items, descriptions, and prices to build your digital catalog instantly.
        </Text>
        
        <TouchableOpacity 
          style={[styles.uploadBox, { backgroundColor: colors.surface, borderColor: colors.primary + '80' }]} 
          onPress={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : (
            <>
              <Text style={[styles.icon, { color: colors.primary }]}>📷</Text>
              <Text style={[styles.uploadText, { color: colors.text }]}>Tap to Upload Menu Photo</Text>
              <Text style={[styles.subText, { color: colors.secondary }]}>Supports JPG, PNG (Max 10MB)</Text>
            </>
          )}
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.primary, opacity: uploading ? 0.7 : 1 }]} 
          onPress={handleUpload}
          disabled={uploading}
        >
          <Text style={styles.buttonText}>{uploading ? "Processing..." : "Select Image"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: 40, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '800' },
  content: { flex: 1, padding: 20, alignItems: 'center' },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 24,
  },
  uploadBox: {
    width: '100%',
    height: 250,
    borderRadius: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  icon: { fontSize: 48, marginBottom: 15 },
  uploadText: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  subText: { fontSize: 14 },
  button: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});
