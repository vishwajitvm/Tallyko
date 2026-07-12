import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Alert, Platform, Modal, TextInput, Switch } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function CatalogScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  const [modalVisible, setModalVisible] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductCategoryId, setNewProductCategoryId] = useState(null);
  const [newProductBarcode, setNewProductBarcode] = useState('');
  const [isAddingProduct, setIsAddingProduct] = useState(false);

  const fetchCatalogData = async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [productsRes, categoriesRes] = await Promise.all([
        axios.get(`${API_URL}/catalog/products`, { headers }),
        axios.get(`${API_URL}/catalog/categories`, { headers })
      ]);
      setProducts(productsRes.data);
      setCategories(categoriesRes.data);
    } catch (error) {
      console.error("Failed to fetch catalog data", error);
      Alert.alert("Error", "Could not load catalog. Please try again later.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCatalogData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchCatalogData();
  };

  const getCategoryName = (id) => {
    if (!id) return 'Uncategorized';
    const cat = categories.find(c => c.id === id);
    return cat ? cat.name : 'Unknown';
  };

  const handleAddProduct = async () => {
    if (!newProductName || !newProductPrice) {
      Alert.alert("Validation Error", "Name and Price are required.");
      return;
    }
    
    setIsAddingProduct(true);
    try {
      const response = await axios.post(`${API_URL}/catalog/products`, {
        name: newProductName,
        base_price: parseFloat(newProductPrice),
        category_id: newProductCategoryId || null,
        barcode: newProductBarcode || null,
        print_to_kitchen: false
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setProducts([...products, response.data]);
      setModalVisible(false);
      setNewProductName('');
      setNewProductPrice('');
      setNewProductBarcode('');
      setNewProductCategoryId(null);
    } catch (error) {
      console.error("Add product error", error);
      Alert.alert("Error", "Could not add product.");
    } finally {
      setIsAddingProduct(false);
    }
  };

  const renderProduct = ({ item }) => (
    <View style={[styles.productCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
      <View style={styles.productInfo}>
        <Text style={[styles.productName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.productCategory, { color: colors.secondary }]}>
          {getCategoryName(item.category_id)}
        </Text>
      </View>
      <View style={styles.priceContainer}>
        <Text style={[styles.productPrice, { color: colors.primary }]}>${parseFloat(item.base_price).toFixed(2)}</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Catalog</Text>
        <TouchableOpacity 
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.addButtonText}>+ Add Product</Text>
        </TouchableOpacity>
      </View>

      {loading && !refreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : products.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.emptyText, { color: colors.secondary }]}>No products found.</Text>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderProduct}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        />
      )}

      {/* Add Product Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>New Product</Text>
            
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.secondary + '50' }]}
              placeholder="Product Name"
              placeholderTextColor={colors.secondary}
              value={newProductName}
              onChangeText={setNewProductName}
            />
            
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.secondary + '50' }]}
              placeholder="Base Price (e.g. 10.50)"
              placeholderTextColor={colors.secondary}
              keyboardType="numeric"
              value={newProductPrice}
              onChangeText={setNewProductPrice}
            />
            
            {/* Category Selection (Simplified to first category if exists or none) */}
            {categories.length > 0 && (
              <View style={styles.categorySelector}>
                <Text style={{ color: colors.text, marginBottom: 8 }}>Select Category:</Text>
                <FlatList
                  data={categories}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={c => c.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.catBadge,
                        { borderColor: colors.primary },
                        newProductCategoryId === item.id ? { backgroundColor: colors.primary } : null
                      ]}
                      onPress={() => setNewProductCategoryId(item.id)}
                    >
                      <Text style={{ color: newProductCategoryId === item.id ? '#fff' : colors.primary }}>
                        {item.name}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.secondary + '30' }]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.primary }]}
                onPress={handleAddProduct}
                disabled={isAddingProduct}
              >
                {isAddingProduct ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>Save Product</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 40,
  },
  title: { fontSize: 28, fontWeight: '800' },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  addButtonText: { color: '#fff', fontWeight: 'bold' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16 },
  listContainer: { paddingHorizontal: 20, paddingBottom: 20 },
  productCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  productInfo: { flex: 1 },
  productName: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  productCategory: { fontSize: 14 },
  priceContainer: { paddingLeft: 16 },
  productPrice: { fontSize: 18, fontWeight: 'bold' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: 300,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    marginBottom: 16,
  },
  categorySelector: {
    marginBottom: 20,
  },
  catBadge: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  modalButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 8,
  }
});
