import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, Alert, Platform, FlatList, Image } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function OnlineStoreScreen() {
  const { colors } = useTheme();
  const { token, user } = useAuth(); // Assume user object has tenant_id or we mock it
  
  const [storeEnabled, setStoreEnabled] = useState(false);
  const [storeLink, setStoreLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('settings'); // 'settings' or 'customer'
  const [catalog, setCatalog] = useState(null);

  useEffect(() => {
    fetchStoreSettings();
  }, []);

  const fetchStoreSettings = async () => {
    try {
      const response = await axios.get(`${API_URL}/online-store/settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStoreEnabled(response.data.enabled);
      setStoreLink(response.data.link);
    } catch (error) {
      console.error("Failed to fetch store settings", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalog = async () => {
    try {
      const tenantId = user?.tenant_id || "00000000-0000-0000-0000-000000000000";
      const response = await axios.get(`${API_URL}/online-store/${tenantId}/catalog`);
      setCatalog(response.data);
    } catch (error) {
      console.error("Failed to fetch public catalog", error);
    }
  };

  useEffect(() => {
    if (viewMode === 'customer') {
      fetchCatalog();
    }
  }, [viewMode]);

  const toggleStore = async (newValue) => {
    setStoreEnabled(newValue);
    try {
      await axios.put(`${API_URL}/online-store/settings`, 
        { enabled: newValue },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      setStoreEnabled(!newValue);
      Alert.alert("Error", "Could not update store status.");
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const renderProduct = ({ item }) => (
    <View style={[styles.productCard, { backgroundColor: colors.surface }]}>
      <Image source={{ uri: item.image }} style={styles.productImage} />
      <View style={styles.productInfo}>
        <Text style={[styles.productName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.productPrice, { color: colors.primary }]}>${item.price.toFixed(2)}</Text>
      </View>
      <TouchableOpacity style={[styles.addButton, { backgroundColor: colors.primary }]}>
        <Text style={styles.addButtonText}>Add</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Online Store</Text>
        
        <View style={[styles.tabContainer, { backgroundColor: colors.surface }]}>
          <TouchableOpacity 
            style={[styles.tab, viewMode === 'settings' && { backgroundColor: colors.primary }]}
            onPress={() => setViewMode('settings')}
          >
            <Text style={[styles.tabText, { color: viewMode === 'settings' ? '#fff' : colors.text }]}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, viewMode === 'customer' && { backgroundColor: colors.primary }]}
            onPress={() => setViewMode('customer')}
          >
            <Text style={[styles.tabText, { color: viewMode === 'customer' ? '#fff' : colors.text }]}>Customer View</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {viewMode === 'settings' ? (
        <View style={styles.content}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingTitle, { color: colors.text }]}>Enable Online Store</Text>
                <Text style={[styles.settingDesc, { color: colors.secondary }]}>Allow customers to order online</Text>
              </View>
              <Switch
                value={storeEnabled}
                onValueChange={toggleStore}
                trackColor={{ false: '#767577', true: colors.primary }}
                thumbColor={'#fff'}
              />
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.secondary + '30', opacity: storeEnabled ? 1 : 0.5 }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Store Link</Text>
            <View style={[styles.linkBox, { backgroundColor: colors.background }]}>
              <Text style={[styles.linkText, { color: colors.primary }]} numberOfLines={1}>
                {storeLink || "tallyko.com/store/mock"}
              </Text>
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} disabled={!storeEnabled}>
                <Text style={styles.actionBtnText}>Copy Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.customerContent}>
          {!storeEnabled ? (
            <Text style={[styles.warningText, { color: colors.error || 'red' }]}>Store is currently offline.</Text>
          ) : (
            <>
              <Text style={[styles.storeTitle, { color: colors.text }]}>{catalog?.store_name || "Storefront"}</Text>
              {catalog?.products?.length > 0 ? (
                <FlatList
                  data={catalog.products}
                  keyExtractor={item => item.id.toString()}
                  renderItem={renderProduct}
                  contentContainerStyle={{ paddingBottom: 20 }}
                />
              ) : (
                <Text style={{ color: colors.secondary, textAlign: 'center', marginTop: 20 }}>No products available.</Text>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: 40, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '800', marginBottom: 15 },
  tabContainer: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  tab: {
    flex: 1,
    padding: 10,
    alignItems: 'center',
  },
  tabText: {
    fontWeight: 'bold',
  },
  content: { padding: 20 },
  customerContent: { flex: 1, padding: 20, paddingTop: 0 },
  storeTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 15 },
  warningText: { textAlign: 'center', fontSize: 16, marginTop: 20 },
  card: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingInfo: { flex: 1 },
  settingTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  settingDesc: { fontSize: 14 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 15 },
  linkBox: {
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  linkText: { fontSize: 16, fontWeight: '500' },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionBtnText: { color: '#fff', fontWeight: 'bold' },
  productCard: {
    flexDirection: 'row',
    padding: 10,
    borderRadius: 12,
    marginBottom: 15,
    alignItems: 'center',
  },
  productImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 15,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  productPrice: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 5,
  },
  addButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  }
});
