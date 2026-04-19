import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import axios from 'axios';

const API_URL = 'http://192.168.1.241:8000'; // שנה ל-IP שלך מ: ipconfig getifaddr en0

export default function HomeScreen() {
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    router.replace('/login' as never);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ToSafePlace 🏠</Text>
      {user ? (
        <Text style={styles.welcome}>Welcome, {user.name} 👋</Text>
      ) : null}

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      {loading && <ActivityIndicator size="large" color="#1a73e8" />}
      {message ? <Text style={styles.success}>✅ {message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={() => router.replace('/login' as never)}>
        <Text style={styles.buttonText}>Go to Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#0a7ea4',
    marginBottom: 10,
  },
  welcome: {
    fontSize: 16,
    color: '#555',
    marginBottom: 40,
  },
  logoutButton: {
    backgroundColor: '#e74c3c',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 10,
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
