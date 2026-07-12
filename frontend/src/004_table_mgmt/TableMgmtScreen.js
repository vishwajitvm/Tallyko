import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Alert, Platform, Modal, TextInput } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function TableMgmtScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [newTableNumber, setNewTableNumber] = useState('');
  const [newTableCapacity, setNewTableCapacity] = useState('4');
  const [isAddingTable, setIsAddingTable] = useState(false);

  const fetchTables = async () => {
    try {
      const response = await axios.get(`${API_URL}/tables`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTables(response.data);
    } catch (error) {
      console.error("Failed to fetch tables", error);
      Alert.alert("Error", "Could not load tables from server.");
      setTables([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTables();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTables();
  };

  const handleAddTable = async () => {
    if (!newTableNumber || !newTableCapacity) {
      Alert.alert("Validation Error", "Table Number and Capacity are required.");
      return;
    }
    
    setIsAddingTable(true);
    try {
      const response = await axios.post(`${API_URL}/tables`, {
        table_number: newTableNumber,
        capacity: parseInt(newTableCapacity, 10),
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setTables([...tables, response.data]);
      setModalVisible(false);
      setNewTableNumber('');
      setNewTableCapacity('4');
    } catch (error) {
      console.error("Add table error", error);
      Alert.alert("Error", "Could not add table.");
    } finally {
      setIsAddingTable(false);
    }
  };

  const renderTable = ({ item }) => (
    <View style={[styles.tableCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
      <View style={styles.tableInfo}>
        <Text style={[styles.tableName, { color: colors.text }]}>{item.table_number}</Text>
        <Text style={[styles.tableCapacity, { color: colors.secondary }]}>Capacity: {item.capacity}</Text>
      </View>
      <View style={styles.statusContainer}>
        <Text style={[styles.tableStatus, { color: item.is_active ? '#34C759' : colors.primary }]}>
          {item.is_active ? 'ACTIVE' : 'INACTIVE'}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Tables</Text>
        <TouchableOpacity 
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.addButtonText}>+ Add Table</Text>
        </TouchableOpacity>
      </View>

      {loading && !refreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : tables.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.emptyText, { color: colors.secondary }]}>No tables found.</Text>
        </View>
      ) : (
        <FlatList
          data={tables}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderTable}
          numColumns={2}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        />
      )}

      {/* Add Table Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>New Table</Text>
            
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.secondary + '50' }]}
              placeholder="Table Number / Name"
              placeholderTextColor={colors.secondary}
              value={newTableNumber}
              onChangeText={setNewTableNumber}
            />
            
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.secondary + '50' }]}
              placeholder="Capacity (e.g. 4)"
              placeholderTextColor={colors.secondary}
              keyboardType="numeric"
              value={newTableCapacity}
              onChangeText={setNewTableCapacity}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.secondary + '30' }]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.primary }]}
                onPress={handleAddTable}
                disabled={isAddingTable}
              >
                {isAddingTable ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>Save Table</Text>
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
  listContainer: { paddingHorizontal: 10, paddingBottom: 20 },
  tableCard: {
    flex: 1,
    margin: 10,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  tableInfo: { alignItems: 'center', marginBottom: 10 },
  tableName: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  tableCapacity: { fontSize: 14 },
  statusContainer: { marginTop: 5 },
  tableStatus: { fontSize: 12, fontWeight: 'bold' },
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
