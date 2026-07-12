import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Alert , Platform } from 'react-native';
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

  const fetchTables = async () => {
    try {
      const response = await axios.get(`${API_URL}/tables`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTables(response.data);
    } catch (error) {
      console.error("Failed to fetch tables", error);
      // Fallback data if endpoint is not fully implemented yet
      setTables([
        { id: '1', name: 'Table 1', capacity: 4, is_active: true },
        { id: '2', name: 'Table 2', capacity: 2, is_active: true },
        { id: '3', name: 'Table 3', capacity: 6, is_active: true },
      ]);
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

  const renderTable = ({ item }) => (
    <View style={[styles.tableCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
      <View style={styles.tableInfo}>
        <Text style={[styles.tableName, { color: colors.text }]}>{item.name}</Text>
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
          onPress={() => Alert.alert("Coming Soon", "Add Table screen is in development.")}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 40,
  },
  title: { 
    fontSize: 28, 
    fontWeight: '800' 
  },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
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
    paddingHorizontal: 10,
    paddingBottom: 20,
  },
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
  tableInfo: {
    alignItems: 'center',
    marginBottom: 10,
  },
  tableName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  tableCapacity: {
    fontSize: 14,
  },
  statusContainer: {
    marginTop: 5,
  },
  tableStatus: {
    fontSize: 12,
    fontWeight: 'bold',
  },
});
