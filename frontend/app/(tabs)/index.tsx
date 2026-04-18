import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import axios from 'axios';

const API_URL = 'http://192.168.1.241:8000'; // שנה ל-IP שלך מ: ipconfig getifaddr en0

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
      <TouchableOpacity style={styles.button} onPress={() => router.replace('/login' as never)}>
        <Text style={styles.buttonText}>Go to Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 32, fontWeight: 'bold', color: '#1a73e8', marginBottom: 20 },
  success: { fontSize: 18, color: 'green', marginTop: 10 },
  error: { fontSize: 18, color: 'red', marginTop: 10 },
  button: { marginTop: 24, backgroundColor: '#1a73e8', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 10 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});