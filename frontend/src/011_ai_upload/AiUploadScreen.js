import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator , Platform, FlatList } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function AiUploadScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [extractedItems, setExtractedItems] = useState(null);

  const handleUpload = async () => {
    setUploading(true);
    setExtractedItems(null);
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
      setExtractedItems(response.data.extracted_items);
      Alert.alert("Success", response.data.message);
    } catch (error) {
      console.error("Failed to upload menu", error);
      Alert.alert("Error", "AI Processing failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleSaveToCatalog = () => {
    Alert.alert("Saved", "Items have been added to your catalog (Mocked)");
    setExtractedItems(null);
  }

  const renderItem = ({ item }) => (
    <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
      <View style={styles.itemHeader}>
        <Text style={[styles.itemName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.itemPrice, { color: colors.primary }]}>${item.price.toFixed(2)}</Text>
      </View>
      <Text style={[styles.itemCat, { color: colors.secondary }]}>{item.category}</Text>
      {item.description && <Text style={[styles.itemDesc, { color: colors.text }]}>{item.description}</Text>}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>AI Menu Upload</Text>
      </View>
      
      {!extractedItems ? (
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
      ) : (
        <View style={styles.resultsContainer}>
          <Text style={[styles.resultsTitle, { color: colors.text }]}>Extracted Items</Text>
          <FlatList
            data={extractedItems}
            keyExtractor={(item, index) => index.toString()}
            renderItem={renderItem}
            contentContainerStyle={styles.listContainer}
          />
          <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary, marginTop: 10 }]} onPress={handleSaveToCatalog}>
            <Text style={styles.buttonText}>Save All to Catalog</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.buttonOutline, { borderColor: colors.primary, marginTop: 10 }]} onPress={() => setExtractedItems(null)}>
            <Text style={[styles.buttonOutlineText, { color: colors.primary }]}>Discard</Text>
          </TouchableOpacity>
        </View>
      )}
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
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  resultsContainer: { flex: 1, padding: 20 },
  resultsTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 15 },
  listContainer: { paddingBottom: 20 },
  itemCard: {
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  itemName: { fontSize: 18, fontWeight: 'bold' },
  itemPrice: { fontSize: 18, fontWeight: 'bold' },
  itemCat: { fontSize: 14, marginBottom: 5, fontStyle: 'italic' },
  itemDesc: { fontSize: 14 },
  buttonOutline: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
  },
  buttonOutlineText: { fontWeight: 'bold', fontSize: 16 }
});
