import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator , Platform, FlatList, TextInput, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';
import * as ImagePicker from 'expo-image-picker';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function AiUploadScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  // View mode: 'upload' or 'manual'
  const [viewMode, setViewMode] = useState('upload');
  
  // Upload State
  const [uploading, setUploading] = useState(false);
  const [extractedItems, setExtractedItems] = useState(null);

  // Manual Entry State
  const [manualItem, setManualItem] = useState({ name: '', price: '', category: '', description: '' });
  const [generatingAI, setGeneratingAI] = useState(false);

  // Pick Image Logic
  const handlePickImage = async () => {
    try {
      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 1,
      });

      if (!result.canceled) {
        handleUpload(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert("Error", "Could not select image");
    }
  };

  const handleUpload = async (fileUri) => {
    setUploading(true);
    setExtractedItems(null);
    try {
      const formData = new FormData();
      
      if (Platform.OS === 'web') {
        // Web: browser FormData needs a Blob, not an object. 
        // Fetch the blob directly from the local blob:// URI
        const response = await fetch(fileUri);
        const blob = await response.blob();
        formData.append('file', blob, 'menu.jpg');
      } else {
        // Native: React Native's polyfilled FormData expects this special object format
        const filename = fileUri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : `image`;
        
        formData.append('file', {
          uri: Platform.OS === 'android' ? fileUri : fileUri.replace('file://', ''),
          name: filename,
          type
        });
      }

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

  const handleSaveToCatalog = async () => {
    try {
      setUploading(true);
      for (const item of extractedItems) {
        await axios.post(`${API_URL}/catalog/products`, {
          name: item.name,
          base_price: parseFloat(item.price),
          print_to_kitchen: false
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      Alert.alert("Saved", "All items have been added to your catalog!");
      setExtractedItems(null);
    } catch (error) {
      console.error("Save all error", error);
      Alert.alert("Error", "Failed to save items to catalog.");
    } finally {
      setUploading(false);
    }
  }
  
  const handleSaveManualItem = async () => {
    if (!manualItem.name || !manualItem.price) {
      Alert.alert("Error", "Dish name and price are required.");
      return;
    }
    
    try {
      setUploading(true);
      await axios.post(`${API_URL}/catalog/products`, {
        name: manualItem.name,
        base_price: parseFloat(manualItem.price),
        print_to_kitchen: false
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      Alert.alert("Saved", `${manualItem.name} added to catalog manually!`);
      setManualItem({ name: '', price: '', category: '', description: '' });
    } catch (error) {
      console.error("Save manual item error", error);
      Alert.alert("Error", "Failed to save item to catalog.");
    } finally {
      setUploading(false);
    }
  }

  const handleGenerateAI = async () => {
    if (!manualItem.name) {
      Alert.alert("Missing Input", "Please enter a dish name first to generate details.");
      return;
    }
    setGeneratingAI(true);
    // Simulate AI generation delay
    setTimeout(() => {
      setManualItem(prev => ({
        ...prev,
        description: `A delicious and freshly prepared ${prev.name.toLowerCase()}, seasoned to perfection.`,
        price: '12.99',
        category: 'Generated AI Category'
      }));
      setGeneratingAI(false);
    }, 1500);
  };

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
        <Text style={[styles.title, { color: colors.text }]}>Add to Menu</Text>
        <View style={styles.tabContainer}>
          <TouchableOpacity 
            style={[styles.tab, viewMode === 'upload' && { backgroundColor: colors.primary }]}
            onPress={() => setViewMode('upload')}
          >
            <Text style={[styles.tabText, viewMode === 'upload' && { color: '#fff' }]}>AI Upload</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, viewMode === 'manual' && { backgroundColor: colors.primary }]}
            onPress={() => setViewMode('manual')}
          >
            <Text style={[styles.tabText, viewMode === 'manual' && { color: '#fff' }]}>Manual Entry</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {viewMode === 'upload' ? (
        !extractedItems ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={[styles.description, { color: colors.secondary }]}>
              Upload a photo of your physical menu, and our AI will automatically extract all items, descriptions, and prices to build your digital catalog instantly.
            </Text>
            
            <TouchableOpacity 
              style={[styles.uploadBox, { backgroundColor: colors.surface, borderColor: colors.primary + '80' }]} 
              onPress={handlePickImage}
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
              onPress={handlePickImage}
              disabled={uploading}
            >
              <Text style={styles.buttonText}>{uploading ? "Processing..." : "Select Image"}</Text>
            </TouchableOpacity>
          </ScrollView>
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
        )
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.description, { color: colors.secondary }]}>
            Manually enter a dish name, then optionally hit Generate to let AI fill in the rest!
          </Text>
          
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Dish Name</Text>
            <View style={styles.row}>
              <TextInput 
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, flex: 1, marginRight: 10 }]}
                placeholder="e.g. Classic Cheeseburger"
                placeholderTextColor={colors.secondary}
                value={manualItem.name}
                onChangeText={(text) => setManualItem(prev => ({ ...prev, name: text }))}
              />
              <TouchableOpacity 
                style={[styles.aiButton, { backgroundColor: colors.secondary }]}
                onPress={handleGenerateAI}
                disabled={generatingAI}
              >
                {generatingAI ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.aiButtonText}>✨ Generate</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Price</Text>
            <TextInput 
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text }]}
              placeholder="0.00"
              keyboardType="decimal-pad"
              placeholderTextColor={colors.secondary}
              value={manualItem.price}
              onChangeText={(text) => setManualItem(prev => ({ ...prev, price: text }))}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Category</Text>
            <TextInput 
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text }]}
              placeholder="e.g. Mains"
              placeholderTextColor={colors.secondary}
              value={manualItem.category}
              onChangeText={(text) => setManualItem(prev => ({ ...prev, category: text }))}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Description</Text>
            <TextInput 
              style={[styles.textArea, { backgroundColor: colors.surface, color: colors.text }]}
              placeholder="Describe the dish..."
              placeholderTextColor={colors.secondary}
              multiline
              numberOfLines={4}
              value={manualItem.description}
              onChangeText={(text) => setManualItem(prev => ({ ...prev, description: text }))}
            />
          </View>

          <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary, marginTop: 20 }]} onPress={handleSaveManualItem}>
            <Text style={styles.buttonText}>Save Item</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: 40, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '800', marginBottom: 15 },
  tabContainer: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#555' },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  tabText: { fontWeight: 'bold', color: '#888' },
  content: { padding: 20 },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
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
  buttonOutlineText: { fontWeight: 'bold', fontSize: 16 },
  inputGroup: { marginBottom: 15 },
  label: { fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: { borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#555' },
  textArea: { borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#555', textAlignVertical: 'top' },
  aiButton: { paddingHorizontal: 15, paddingVertical: 12, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  aiButtonText: { color: '#fff', fontWeight: 'bold' }
});
