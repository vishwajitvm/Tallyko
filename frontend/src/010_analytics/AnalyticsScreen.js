import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView , Platform } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function AnalyticsScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [data, setData] = useState({
    total_revenue: 0,
    total_orders: 0,
    average_order_value: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const response = await axios.get(`${API_URL}/analytics/dashboard`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setData(response.data);
    } catch (error) {
      console.error("Failed to fetch analytics", error);
      Alert.alert("Error", "Could not load analytics data.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Analytics Dashboard</Text>
        <Text style={[styles.subtitle, { color: colors.secondary }]}>Today's Overview</Text>
      </View>
      
      <View style={styles.content}>
        <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
          <Text style={[styles.kpiLabel, { color: colors.secondary }]}>Total Revenue</Text>
          <Text style={[styles.kpiValue, { color: colors.primary }]}>
            ${data.total_revenue.toFixed(2)}
          </Text>
        </View>

        <View style={styles.row}>
          <View style={[styles.kpiCard, styles.halfCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
            <Text style={[styles.kpiLabel, { color: colors.secondary }]}>Total Orders</Text>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {data.total_orders}
            </Text>
          </View>
          <View style={[styles.kpiCard, styles.halfCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
            <Text style={[styles.kpiLabel, { color: colors.secondary }]}>Avg Order Value</Text>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              ${data.average_order_value.toFixed(2)}
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, paddingTop: 40, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '800' },
  subtitle: { fontSize: 16, marginTop: 5 },
  content: { padding: 20 },
  kpiCard: {
    padding: 25,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  halfCard: {
    width: '48%',
  },
  kpiLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  kpiValue: {
    fontSize: 32,
    fontWeight: 'bold',
  },
});
