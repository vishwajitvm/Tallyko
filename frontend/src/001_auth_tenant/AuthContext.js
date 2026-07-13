import { Platform } from 'react-native';
import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

const setStorageItem = async (key, value) => {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
};

const getStorageItem = async (key) => {
  if (Platform.OS === 'web') {
    return await AsyncStorage.getItem(key);
  } else {
    return await SecureStore.getItemAsync(key);
  }
};

const removeStorageItem = async (key) => {
  if (Platform.OS === 'web') {
    return await AsyncStorage.removeItem(key);
  } else {
    return await SecureStore.deleteItemAsync(key);
  }
};

export const AuthContext = createContext({
  isAuthenticated: false,
  token: null,
  tenant: null,
  user: null,
  login: async () => {},
  logout: async () => {},
  register: async () => {}
});

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const bootstrapAsync = async () => {
      try {
        const storedToken = await getStorageItem('tallyko_token');
        if (storedToken) {
          setToken(storedToken);
          setIsAuthenticated(true);
        }
      } catch (e) {
        console.log('Restoring token failed');
      }
      setIsLoading(false);
    };

    bootstrapAsync();
  }, []);

  const login = async (email, password) => {
    try {
      const response = await axios.post(`${API_URL}/auth/login`, { email, password });
      const data = response.data;
      if (data && data.access_token) {
        await setStorageItem('tallyko_token', data.access_token);
        setToken(data.access_token);
        setIsAuthenticated(true);
        return { success: true };
      }
      return { success: false, message: 'Invalid token received' };
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.detail || error.message 
      };
    }
  };

  const register = async (vendorName, email, password, phone) => {
    try {
      const response = await axios.post(`${API_URL}/auth/register`, { 
        vendor_name: vendorName,
        email, 
        password,
        phone
      });
      const data = response.data;
      if (data && data.access_token) {
        await setStorageItem('tallyko_token', data.access_token);
        setToken(data.access_token);
        setIsAuthenticated(true);
        return { success: true };
      }
      return { success: false, message: 'Invalid response from server' };
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.detail || error.message 
      };
    }
  };

  const logout = async () => {
    await removeStorageItem('tallyko_token');
    setToken(null);
    setIsAuthenticated(false);
    setTenant(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, token, tenant, user, login, logout, register, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
