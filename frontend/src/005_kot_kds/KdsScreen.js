import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Alert , Platform } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function KdsScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = async () => {
    try {
      const response = await axios.get(`${API_URL}/kitchen/kds/orders`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(response.data);
    } catch (error) {
      console.error("Failed to fetch KDS orders", error);
      Alert.alert("Error", "Could not load kitchen orders.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // In a real app we'd poll or use WebSockets for KDS
    const interval = setInterval(fetchOrders, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrders();
  };

  const [processingOrders, setProcessingOrders] = useState(new Set());

  const completeOrder = async (orderId) => {
    if (processingOrders.has(orderId)) return;
    setProcessingOrders(prev => new Set(prev).add(orderId));
    try {
      await axios.put(`${API_URL}/kitchen/kds/orders/${orderId}/status`, 
        { status: 'completed' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      // Remove from list or refresh
      setOrders(orders.filter(o => o.id !== orderId));
    } catch (error) {
      console.error("Failed to update order status", error);
      Alert.alert("Error", "Could not mark order as completed.");
    } finally {
      setProcessingOrders(prev => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  const renderOrder = ({ item }) => {
    const isProcessing = processingOrders.has(item.id);
    return (
      <View style={[styles.orderCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
        <View style={styles.orderHeader}>
          <Text style={[styles.orderId, { color: colors.text }]}>Order #{item.id.substring(0, 8)}</Text>
          <Text style={[styles.orderType, { backgroundColor: colors.secondary + '20', color: colors.secondary }]}>
            {item.type}
          </Text>
        </View>
        
        {/* Mocking items since API currently returns empty array for items */}
        <View style={styles.itemList}>
          {item.items && item.items.length > 0 ? (
            item.items.map((prod, idx) => (
              <Text key={idx} style={[styles.itemText, { color: colors.text }]}>
                {prod.quantity}x {prod.name}
              </Text>
            ))
          ) : (
            <Text style={{ color: colors.secondary, fontStyle: 'italic', marginVertical: 10 }}>
              (Items would be listed here)
            </Text>
          )}
        </View>

        <TouchableOpacity 
          style={[styles.completeBtn, { backgroundColor: isProcessing ? '#999' : '#34C759' }]} 
          onPress={() => completeOrder(item.id)}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.completeBtnText}>Mark Completed</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Kitchen Display</Text>
      </View>

      {loading && !refreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.emptyText, { color: colors.secondary }]}>No pending orders!</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderOrder}
          numColumns={2}
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
  header: { padding: 20, paddingTop: 40, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '800' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 18, fontWeight: '600' },
  listContainer: { paddingHorizontal: 10, paddingBottom: 20 },
  orderCard: {
    flex: 1,
    margin: 10,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    minHeight: 200,
    justifyContent: 'space-between'
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  orderId: { fontSize: 18, fontWeight: 'bold' },
  orderType: {
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden'
  },
  itemList: {
    flex: 1,
  },
  itemText: {
    fontSize: 16,
    marginBottom: 4,
  },
  completeBtn: {
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 15,
  },
  completeBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  }
});
