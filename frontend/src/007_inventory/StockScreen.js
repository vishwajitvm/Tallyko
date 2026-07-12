import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Alert, Platform, Modal, TextInput } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function StockScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quantityToAdd, setQuantityToAdd] = useState('');

  const fetchInventory = async () => {
    try {
      const response = await axios.get(`${API_URL}/inventory`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setInventory(response.data);
    } catch (error) {
      console.error("Failed to fetch inventory", error);
      Alert.alert("Error", "Could not load inventory.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchInventory();
  };

  const handleReceiveStock = async () => {
    if (!selectedProduct || !quantityToAdd || isNaN(quantityToAdd) || parseInt(quantityToAdd) <= 0) {
      Alert.alert('Invalid Input', 'Please enter a valid quantity.');
      return;
    }

    try {
      await axios.post(`${API_URL}/inventory/receive`, {
        product_id: selectedProduct.id,
        quantity: parseInt(quantityToAdd),
        location_id: '00000000-0000-0000-0000-000000000000' // Mock location for now
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      Alert.alert("Success", "Stock received successfully!");
      setModalVisible(false);
      setQuantityToAdd('');
      setSelectedProduct(null);
      fetchInventory();
    } catch (error) {
      console.error("Failed to receive inventory", error);
      Alert.alert("Error", "Could not receive inventory.");
    }
  };

  const renderStockItem = ({ item }) => {
    const isLowStock = item.stock_count <= item.low_stock_threshold;
    
    return (
      <View style={[styles.stockCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
        <View style={styles.stockInfo}>
          <Text style={[styles.stockName, { color: colors.text }]}>{item.name}</Text>
          <Text style={[styles.stockCategory, { color: colors.secondary }]}>Barcode: {item.barcode || 'N/A'}</Text>
        </View>
        <View style={styles.stockCountContainer}>
          <Text style={[styles.stockCount, { color: isLowStock ? '#FF3B30' : '#34C759' }]}>
            {item.stock_count} in stock
          </Text>
          {isLowStock && (
            <Text style={[styles.lowStockWarning, { color: '#FF3B30' }]}>Low Stock</Text>
          )}
          <TouchableOpacity 
            style={[styles.smallReceiveButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              setSelectedProduct(item);
              setModalVisible(true);
            }}
          >
            <Text style={styles.smallReceiveButtonText}>Receive</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Inventory</Text>
      </View>

      {loading && !refreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : inventory.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.emptyText, { color: colors.secondary }]}>No items in inventory.</Text>
        </View>
      ) : (
        <FlatList
          data={inventory}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderStockItem}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        />
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => {
          setModalVisible(false);
          setQuantityToAdd('');
          setSelectedProduct(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalView, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Receive Stock</Text>
            {selectedProduct && <Text style={{ color: colors.text, marginBottom: 15 }}>Product: {selectedProduct.name}</Text>}
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              placeholder="Quantity to add"
              placeholderTextColor={colors.secondary}
              keyboardType="numeric"
              value={quantityToAdd}
              onChangeText={setQuantityToAdd}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.border }]}
                onPress={() => {
                  setModalVisible(false);
                  setQuantityToAdd('');
                  setSelectedProduct(null);
                }}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.primary }]}
                onPress={handleReceiveStock}
              >
                <Text style={styles.modalButtonText}>Receive</Text>
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
  addButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  addButtonText: { color: '#fff', fontWeight: 'bold' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16 },
  listContainer: { paddingHorizontal: 20, paddingBottom: 20 },
  stockCard: {
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
  stockInfo: { flex: 1 },
  stockName: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  stockCategory: { fontSize: 14 },
  stockCountContainer: { alignItems: 'flex-end', paddingLeft: 16 },
  stockCount: { fontSize: 18, fontWeight: 'bold' },
  lowStockWarning: { fontSize: 12, fontWeight: 'bold', marginTop: 4 },
  smallReceiveButton: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  smallReceiveButtonText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalView: { width: '80%', padding: 20, borderRadius: 20, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15 },
  input: { width: '100%', height: 50, borderWidth: 1, borderRadius: 10, paddingHorizontal: 15, marginBottom: 20 },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  modalButton: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center', marginHorizontal: 5 },
  modalButtonText: { fontSize: 16, fontWeight: 'bold' }
});
