import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

const AuthContext = createContext();

// Typically, in React Native using Expo on Android simulator, localhost points to the simulator itself.
// Since backend is exposed on port 8000 via docker-compose, we can use 10.0.2.2 for Android simulator or localhost for web/iOS.
// For now we'll use a configurable base URL, assuming it runs on localhost/127.0.0.1 for Web.
// If testing on a physical device or simulator, you may need to use your local IP address.
const API_URL = 'http://127.0.0.1:8000/api/v1'; 

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if token exists on load
    const loadToken = async () => {
      try {
        const storedToken = await AsyncStorage.getItem('@tallyko_token');
        if (storedToken) {
          setToken(storedToken);
          // Ideally verify token or fetch user info here
          setUser({ email: 'user@example.com' }); // Mock user load
        }
      } catch (e) {
        console.error("Failed to load token:", e);
      } finally {
        setLoading(false);
      }
    };
    loadToken();
  }, []);

  const login = async (email, password) => {
    try {
      const response = await axios.post(`${API_URL}/auth/login`, {
        email,
        password
      });
      const data = response.data;
      if (data.access_token) {
        setToken(data.access_token);
        setUser({ email: data.user.email });
        await AsyncStorage.setItem('@tallyko_token', data.access_token);
        return { success: true };
      }
      return { success: false, error: 'Login failed' };
    } catch (error) {
      console.error('Login error', error);
      return { 
        success: false, 
        error: error.response?.data?.detail || error.message || 'Network error'
      };
    }
  };

  const signup = async (email, password, vendorName, phone) => {
    try {
      const response = await axios.post(`${API_URL}/auth/register`, {
        email,
        password,
        vendor_name: vendorName,
        phone
      });
      const data = response.data;
      if (data.id) {
        // Auto-login after signup
        return await login(email, password);
      }
      return { success: false, error: 'Signup failed' };
    } catch (error) {
      console.error('Signup error', error);
      return { 
        success: false, 
        error: error.response?.data?.detail || error.message || 'Network error' 
      };
    }
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    await AsyncStorage.removeItem('@tallyko_token');
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
