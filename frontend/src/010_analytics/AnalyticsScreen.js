import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView, Platform, TouchableOpacity, FlatList } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function AnalyticsScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [activeTab, setActiveTab] = useState('Dashboard');
  
  const [data, setData] = useState({
    total_revenue: 0,
    total_orders: 0,
    average_order_value: 0,
    top_products: []
  });
  
  const [reportsData, setReportsData] = useState([]);
  const [reportType, setReportType] = useState('sales');

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activeTab === 'Dashboard') {
      fetchAnalytics();
    } else {
      fetchReport(reportType);
    }
  }, [activeTab, reportType]);

  const fetchAnalytics = async () => {
    setLoading(true);
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

  const fetchReport = async (type) => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/analytics/reports/${type}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setReportsData(response.data);
    } catch (error) {
      console.error(`Failed to fetch ${type} report`, error);
      Alert.alert("Error", `Could not load ${type} report.`);
    } finally {
      setLoading(false);
    }
  };

  const renderDashboard = () => (
    <ScrollView style={[styles.content, { backgroundColor: colors.background }]}>
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

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Products</Text>
        {data.top_products.map((p, i) => (
          <View key={i} style={styles.listItem}>
            <Text style={{ color: colors.text }}>{p.name}</Text>
            <Text style={{ color: colors.primary, fontWeight: 'bold' }}>{p.sold} sold</Text>
          </View>
        ))}
        {data.top_products.length === 0 && <Text style={{ color: colors.secondary }}>No data</Text>}
      </View>
    </ScrollView>
  );

  const renderReports = () => (
    <View style={[styles.content, { flex: 1, backgroundColor: colors.background }]}>
      <View style={styles.reportTabs}>
        {['sales', 'wastage', 'staff'].map(t => (
          <TouchableOpacity key={t} onPress={() => setReportType(t)} style={[styles.reportTab, reportType === t && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}>
            <Text style={{ color: reportType === t ? colors.primary : colors.secondary }}>{t.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>
      
      <FlatList
        data={reportsData}
        keyExtractor={(item, index) => index.toString()}
        renderItem={({ item }) => (
          <View style={[styles.reportItem, { backgroundColor: colors.surface }]}>
            {Object.keys(item).map((k) => (
              <Text key={k} style={{ color: colors.text }}>{k}: {item[k]}</Text>
            ))}
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: colors.secondary, marginTop: 20 }}>No records found</Text>}
      />
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Analytics & Reports</Text>
        
        <View style={styles.mainTabs}>
          <TouchableOpacity onPress={() => setActiveTab('Dashboard')} style={[styles.mainTab, activeTab === 'Dashboard' && { backgroundColor: colors.primary }]}>
            <Text style={{ color: activeTab === 'Dashboard' ? '#fff' : colors.text }}>Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('Reports')} style={[styles.mainTab, activeTab === 'Reports' && { backgroundColor: colors.primary }]}>
            <Text style={{ color: activeTab === 'Reports' ? '#fff' : colors.text }}>Reports</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        activeTab === 'Dashboard' ? renderDashboard() : renderReports()
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, paddingTop: 40, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '800', marginBottom: 15 },
  mainTabs: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#ccc' },
  mainTab: { flex: 1, padding: 10, alignItems: 'center' },
  content: { padding: 20, flex: 1 },
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
  section: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  reportTabs: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 15 },
  reportTab: { paddingBottom: 5 },
  reportItem: { padding: 15, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
});
