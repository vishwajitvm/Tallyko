import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = 'http://127.0.0.1:8000/api/v1';

export default function CrmScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      const response = await axios.get(`${API_URL}/crm/customers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCustomers(response.data);
    } catch (error) {
      console.error("Failed to fetch customers", error);
      Alert.alert("Error", "Could not load customers.");
    } finally {
      setLoading(false);
    }
  };

  const renderCustomer = ({ item }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.phone, { color: colors.secondary }]}>{item.phone}</Text>
      </View>
      <View style={styles.loyalty}>
        <Text style={[styles.tier, { color: colors.primary }]}>{item.tier}</Text>
        <Text style={[styles.points, { color: colors.text }]}>{item.points} pts</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>CRM & Loyalty</Text>
        <TouchableOpacity 
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => Alert.alert("Coming Soon", "Add Customer screen is in development.")}
        >
          <Text style={styles.addButtonText}>+ Customer</Text>
        </TouchableOpacity>
      </View>
      
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : customers.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={{ color: colors.secondary }}>No customers found.</Text>
        </View>
      ) : (
        <FlatList
          data={customers}
          keyExtractor={(item) => item.id}
          renderItem={renderCustomer}
          contentContainerStyle={styles.listContainer}
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
  listContainer: { paddingHorizontal: 20, paddingBottom: 20 },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  info: { flex: 1 },
  name: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  phone: { fontSize: 14 },
  loyalty: { alignItems: 'flex-end', justifyContent: 'center' },
  tier: { fontSize: 12, fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase' },
  points: { fontSize: 16, fontWeight: 'bold' }
});
