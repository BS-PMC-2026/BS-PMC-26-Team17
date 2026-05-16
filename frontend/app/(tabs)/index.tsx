import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAuth } from '@/context/auth';
import axios from 'axios';
export default function HomeScreen() {
  const { user, logout } = useAuth();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${process.env.EXPO_PUBLIC_API_URL}/api/ping`)
      .then(res => {
        setMessage(res.data.message);
        setLoading(false);
      })
      .catch(() => {
        setError('❌ Cannot connect to API');// for chekcing if API is working
        setLoading(false);
      });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ToSafePlace 🏠</Text>

      {loading && <ActivityIndicator size="large" color="#1a73e8" />}
      {message ? <Text style={styles.success}>✅ {message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {user && (
        <Text style={{ marginTop: 16, fontSize: 16, color: '#444' }}>
          Hello, {user.name} 👋
        </Text>
      )}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: '#e24b4a' }]}
        onPress={() => logout()}
      >
        <Text style={styles.buttonText}>Logout</Text>
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
  success: {
    fontSize: 18,
    color: 'green',
    marginTop: 10,
  },
  error: {
    fontSize: 18,
    color: 'red',
    marginTop: 10,
  },
  button: {
    marginTop: 24,
    backgroundColor: '#1a73e8',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
