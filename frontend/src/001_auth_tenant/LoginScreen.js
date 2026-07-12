import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

const API_URL = 'http://localhost:8000/api/v1';

export default function LoginScreen({ navigation }) {
  const { colors, name: themeName, setTheme } = useTheme();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || data.detail || 'Login failed');
      }
      
      // In a real app, save token to SecureStore here
      navigation.navigate('MainTabs');
    } catch (err) {
      Alert.alert('Login Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const themes = ['light', 'dark', 'red', 'blue', 'green', 'yellow'];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.primary }]}>Tallyko POS</Text>
      
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          placeholder="Email"
          placeholderTextColor={colors.secondary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          placeholder="Password"
          placeholderTextColor={colors.secondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>
        
        <TouchableOpacity onPress={() => navigation.navigate('Signup')} style={styles.linkContainer}>
          <Text style={[styles.link, { color: colors.secondary }]}>
            Don't have an account? <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Sign Up</Text>
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.themeSelector}>
        <Text style={[styles.themeLabel, { color: colors.text }]}>Select Theme:</Text>
        <View style={styles.themeRow}>
          {themes.map(t => (
            <TouchableOpacity 
              key={t}
              onPress={() => setTheme(t)}
              style={[
                styles.themeBubble, 
                { backgroundColor: t === 'dark' ? '#000' : t === 'light' ? '#fff' : t },
                themeName === t && { borderWidth: 2, borderColor: colors.primary }
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 40,
  },
  card: {
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    marginBottom: 15,
    fontSize: 16,
  },
  button: {
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  linkContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  link: {
    fontSize: 14,
  },
  themeSelector: {
    marginTop: 50,
    alignItems: 'center',
  },
  themeLabel: {
    fontSize: 16,
    marginBottom: 10,
  },
  themeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  themeBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#ccc',
  },
});
