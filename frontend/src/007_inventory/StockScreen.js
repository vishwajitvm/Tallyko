import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Alert , Platform } from 'react-native';
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
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Inventory</Text>
        <TouchableOpacity style={[styles.addButton, { backgroundColor: colors.primary }]}>
          <Text style={styles.addButtonText}>Receive Stock</Text>
        </TouchableOpacity>
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
  lowStockWarning: { fontSize: 12, fontWeight: 'bold', marginTop: 4 }
});
