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
import KitchenScreen from './src/005_kot_kds/KitchenScreen';
import CrmScreen from './src/009_crm_loyalty/CrmScreen';
import AiUploadScreen from './src/011_ai_upload/AiUploadScreen';
import OnlineStoreScreen from './src/012_online_store/OnlineStoreScreen';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

import { TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const MainTabs = () => {
  const { colors } = useTheme();
  const { logout } = useAuth();
  
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
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
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === 'Billing') iconName = focused ? 'receipt' : 'receipt-outline';
          else if (route.name === 'Catalog') iconName = focused ? 'pricetags' : 'pricetags-outline';
          else if (route.name === 'Tables') iconName = focused ? 'restaurant' : 'restaurant-outline';
          else if (route.name === 'Kitchen') iconName = focused ? 'flame' : 'flame-outline';
          else if (route.name === 'Inventory') iconName = focused ? 'cube' : 'cube-outline';
          else if (route.name === 'Scanner') iconName = focused ? 'barcode' : 'barcode-outline';
          else if (route.name === 'CRM') iconName = focused ? 'people' : 'people-outline';
          else if (route.name === 'Analytics') iconName = focused ? 'stats-chart' : 'stats-chart-outline';
          else if (route.name === 'AI Menu') iconName = focused ? 'camera' : 'camera-outline';
          else if (route.name === 'Store') iconName = focused ? 'globe' : 'globe-outline';

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Billing" component={BillingScreen} />
      <Tab.Screen name="Catalog" component={CatalogScreen} />
      <Tab.Screen name="Tables" component={TableMgmtScreen} />
      <Tab.Screen name="Kitchen" component={KitchenScreen} />
      <Tab.Screen name="Inventory" component={InventoryScreen} />
      <Tab.Screen name="Scanner" component={BarcodeScannerScreen} />
      <Tab.Screen name="CRM" component={CrmScreen} />
      <Tab.Screen name="Analytics" component={AnalyticsScreen} />
      <Tab.Screen name="AI Menu" component={AiUploadScreen} />
      <Tab.Screen name="Store" component={OnlineStoreScreen} />
    </Tab.Navigator>
  );
};

// We wrap the actual navigation in a component so it can consume useTheme hook
const AppNavigator = () => {
  const { colors } = useTheme();
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
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
        {isAuthenticated ? (
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

