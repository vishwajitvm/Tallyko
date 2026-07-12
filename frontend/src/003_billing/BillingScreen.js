import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Alert , Platform } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function BillingScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = async () => {
    try {
      const response = await axios.get(`${API_URL}/billing/orders`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(response.data);
    } catch (error) {
      console.error("Failed to fetch orders", error);
      Alert.alert("Error", "Could not load orders. Please try again later.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrders();
  };

  const renderOrder = ({ item }) => (
    <View style={[styles.orderCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
      <View style={styles.orderInfo}>
        <Text style={[styles.orderId, { color: colors.text }]}>Order #{item.id.substring(0, 8)}</Text>
        <Text style={[styles.orderType, { color: colors.secondary }]}>Type: {item.type}</Text>
      </View>
      <View style={styles.statusContainer}>
        <Text style={[styles.orderStatus, { color: item.status === 'completed' ? '#34C759' : colors.primary }]}>
          {item.status.toUpperCase()}
        </Text>
        <Text style={[styles.orderTotal, { color: colors.text }]}>${parseFloat(item.total_amount).toFixed(2)}</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Billing & Orders</Text>
      </View>

      {loading && !refreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.emptyText, { color: colors.secondary }]}>No recent orders.</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderOrder}
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
  container: { 
    flex: 1, 
  },
  header: {
    padding: 20,
    paddingTop: 40,
    paddingBottom: 10,
  },
  title: { 
    fontSize: 28, 
    fontWeight: '800' 
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  orderCard: {
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
  orderInfo: {
    flex: 1,
  },
  orderId: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  orderType: {
    fontSize: 14,
  },
  statusContainer: {
    alignItems: 'flex-end',
  },
  orderStatus: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  orderTotal: {
    fontSize: 18,
    fontWeight: '800',
  }
});
