import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_API_URL || '';

export default function HomeScreen() {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${API_URL}/api/ping`)
      .then(res => {
        setMessage(res.data.message);
        setLoading(false);
      })
      .catch(err => {
        setError('❌ Cannot connect to API');
        setLoading(false);
      });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ToSafePlace 🏠</Text>
      {loading && <ActivityIndicator size="large" color="#1a73e8" />}
      {message ? <Text style={styles.success}>✅ {message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 32, fontWeight: 'bold', color: '#1a73e8', marginBottom: 20 },
  success: { fontSize: 18, color: 'green', marginTop: 10 },
  error: { fontSize: 18, color: 'red', marginTop: 10 },
});