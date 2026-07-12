import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Platform, Modal, TextInput } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function CrmScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Add Customer Modal
  const [isAddModalVisible, setAddModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [addingCustomer, setAddingCustomer] = useState(false);

  // Customer Detail Modal
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerDetail, setCustomerDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isDetailModalVisible, setDetailModalVisible] = useState(false);

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

  const handleAddCustomer = async () => {
    if (!newName || !newPhone) {
      Alert.alert("Validation", "Name and Phone are required.");
      return;
    }
    setAddingCustomer(true);
    try {
      const payload = { name: newName, phone: newPhone, email: newEmail };
      await axios.post(`${API_URL}/crm/customers`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAddModalVisible(false);
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      fetchCustomers();
    } catch (error) {
      console.error("Failed to add customer", error);
      Alert.alert("Error", error.response?.data?.detail || "Could not add customer.");
    } finally {
      setAddingCustomer(false);
    }
  };

  const handleCustomerPress = async (customer) => {
    setSelectedCustomer(customer);
    setDetailModalVisible(true);
    setLoadingDetail(true);
    try {
      const response = await axios.get(`${API_URL}/crm/customers/${customer.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCustomerDetail(response.data);
    } catch (error) {
      console.error("Failed to fetch detail", error);
      Alert.alert("Error", "Could not load customer details.");
      setDetailModalVisible(false);
    } finally {
      setLoadingDetail(false);
    }
  };

  const renderCustomer = ({ item }) => (
    <TouchableOpacity 
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}
      onPress={() => handleCustomerPress(item)}
    >
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.phone, { color: colors.secondary }]}>{item.phone}</Text>
      </View>
      <View style={styles.loyalty}>
        <Text style={[styles.tier, { color: colors.primary }]}>{item.tier}</Text>
        <Text style={[styles.points, { color: colors.text }]}>{item.points} pts</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>CRM & Loyalty</Text>
        <TouchableOpacity 
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => setAddModalVisible(true)}
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

      {/* Add Customer Modal */}
      <Modal visible={isAddModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Add Customer</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              placeholder="Name"
              placeholderTextColor={colors.secondary}
              value={newName}
              onChangeText={setNewName}
            />
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              placeholder="Phone"
              placeholderTextColor={colors.secondary}
              value={newPhone}
              onChangeText={setNewPhone}
              keyboardType="phone-pad"
            />
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              placeholder="Email (optional)"
              placeholderTextColor={colors.secondary}
              value={newEmail}
              onChangeText={setNewEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setAddModalVisible(false)} style={styles.cancelBtn}>
                <Text style={{ color: colors.secondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAddCustomer} style={[styles.saveBtn, { backgroundColor: colors.primary }]} disabled={addingCustomer}>
                {addingCustomer ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff' }}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Customer Detail Modal */}
      <Modal visible={isDetailModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.detailModalContainer, { backgroundColor: colors.surface }]}>
            {loadingDetail || !customerDetail ? (
               <View style={styles.centerContainer}>
                 <ActivityIndicator size="large" color={colors.primary} />
               </View>
            ) : (
              <View style={styles.detailContent}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>{customerDetail.name}</Text>
                <Text style={{ color: colors.secondary, marginBottom: 10 }}>{customerDetail.phone} {customerDetail.email ? `| ${customerDetail.email}` : ''}</Text>
                <View style={[styles.detailLoyalty, { backgroundColor: colors.background }]}>
                  <Text style={[styles.tier, { color: colors.primary }]}>{customerDetail.tier} Member</Text>
                  <Text style={[styles.points, { color: colors.text }]}>{customerDetail.points} Points</Text>
                </View>
                
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Order History</Text>
                {customerDetail.orders.length === 0 ? (
                  <Text style={{ color: colors.secondary, marginTop: 10 }}>No orders yet.</Text>
                ) : (
                  <FlatList
                    data={customerDetail.orders}
                    keyExtractor={item => item.id}
                    renderItem={({ item }) => (
                      <View style={[styles.orderCard, { borderBottomColor: colors.border }]}>
                        <View>
                          <Text style={{ color: colors.text, fontWeight: 'bold' }}>{item.type} - {item.status}</Text>
                          <Text style={{ color: colors.secondary, fontSize: 12 }}>{new Date(item.created_at).toLocaleString()}</Text>
                        </View>
                        <Text style={{ color: colors.primary, fontWeight: 'bold' }}>${item.total_amount.toFixed(2)}</Text>
                      </View>
                    )}
                    style={{ flex: 1, width: '100%', marginTop: 10 }}
                  />
                )}
                
                <TouchableOpacity onPress={() => setDetailModalVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.primary }]}>
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>Close</Text>
                </TouchableOpacity>
              </View>
            )}
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
  listContainer: { paddingHorizontal: 20, paddingBottom: 20 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  points: { fontSize: 16, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContainer: { width: '85%', padding: 20, borderRadius: 16 },
  detailModalContainer: { width: '90%', height: '70%', padding: 20, borderRadius: 16 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  cancelBtn: { padding: 12, marginRight: 10 },
  saveBtn: { padding: 12, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  detailContent: { flex: 1, alignItems: 'flex-start', width: '100%' },
  detailLoyalty: { width: '100%', padding: 16, borderRadius: 12, marginBottom: 20, marginTop: 10 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold' },
  orderCard: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1 },
  closeBtn: { width: '100%', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 }
});
