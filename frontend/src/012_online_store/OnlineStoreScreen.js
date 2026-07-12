import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, Alert , Platform } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function OnlineStoreScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [storeEnabled, setStoreEnabled] = useState(false);
  const [storeLink, setStoreLink] = useState('');
  const [loading, setLoading] = useState(true);

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
      Alert.alert("Error", "Could not load online store settings.");
    } finally {
      setLoading(false);
    }
  };

  const toggleStore = async (newValue) => {
    // Optimistic UI update
    setStoreEnabled(newValue);
    try {
      await axios.put(`${API_URL}/online-store/settings`, 
        { enabled: newValue },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      console.error("Failed to update store settings", error);
      // Revert on failure
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Online Store</Text>
      </View>
      
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
              {storeLink || "tallyko.com/store/your-tenant-id"}
            </Text>
          </View>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} disabled={!storeEnabled}>
              <Text style={styles.actionBtnText}>Copy Link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtnOutline, { borderColor: colors.primary }]} disabled={!storeEnabled}>
              <Text style={[styles.actionBtnOutlineText, { color: colors.primary }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: 40, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '800' },
  content: { padding: 20 },
  card: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
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
    marginRight: 10,
  },
  actionBtnText: { color: '#fff', fontWeight: 'bold' },
  actionBtnOutline: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 2,
  },
  actionBtnOutlineText: { fontWeight: 'bold' },
});
