import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from './src/001_auth_tenant/AuthContext';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import LoginScreen from './src/001_auth_tenant/LoginScreen';
import SignupScreen from './src/001_auth_tenant/SignupScreen';
import CatalogScreen from './src/002_catalog/CatalogScreen';
import BillingScreen from './src/003_billing/BillingScreen';
import TableMgmtScreen from './src/004_table_mgmt/TableMgmtScreen';
import InventoryScreen from './src/007_inventory/StockScreen';
import AnalyticsScreen from './src/010_analytics/AnalyticsScreen';
import BarcodeScannerScreen from './src/006_barcode_variants/BarcodeScannerScreen';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

import { TouchableOpacity, Text } from 'react-native';

const MainTabs = () => {
  const { colors } = useTheme();
  const { logout } = useAuth();
  
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.surface },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.secondary,
        headerRight: () => (
          <TouchableOpacity onPress={logout} style={{ marginRight: 15 }}>
            <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Logout</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tab.Screen name="Billing" component={BillingScreen} />
      <Tab.Screen name="Catalog" component={CatalogScreen} />
      <Tab.Screen name="Tables" component={TableMgmtScreen} />
      <Tab.Screen name="Inventory" component={InventoryScreen} />
      <Tab.Screen name="Scanner" component={BarcodeScannerScreen} />
      <Tab.Screen name="Analytics" component={AnalyticsScreen} />
    </Tab.Navigator>
  );
};

// We wrap the actual navigation in a component so it can consume useTheme hook
const AppNavigator = () => {
  const { colors } = useTheme();
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      >
        {user ? (
          <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Signup" component={SignupScreen} options={{ title: 'Create Account' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

