import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [telephone, setTelephone] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    setError('');

    if (!firstName || !lastName || !email || !password || !telephone || !address) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, password, telephone, address }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.detail || 'Registration failed');
        return;
      }

      router.push('/login' as never);
    } catch {
      setError('Cannot connect to server');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoWrapper}>
          <View style={styles.logoCircle}>
            <Ionicons name="shield-checkmark" size={48} color="#fff" />
          </View>
          <Text style={styles.brand}>ToSafePlace</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join us and stay safe</Text>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#e74c3c" />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.row}>
            <View style={[styles.inputWrapper, styles.halfInput]}>
              <Ionicons name="person-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="First Name"
                placeholderTextColor="#94a3b8"
                value={firstName}
                onChangeText={setFirstName}
              />
            </View>
            <View style={[styles.inputWrapper, styles.halfInput]}>
              <Ionicons name="person-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Last Name"
                placeholderTextColor="#94a3b8"
                value={lastName}
                onChangeText={setLastName}
              />
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons name="mail-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#94a3b8"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#94a3b8"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color="#94a3b8"
              />
            </TouchableOpacity>
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons name="call-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Telephone"
              placeholderTextColor="#94a3b8"
              value={telephone}
              onChangeText={setTelephone}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons name="location-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Address"
              placeholderTextColor="#94a3b8"
              value={address}
              onChangeText={setAddress}
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.buttonText}>Create Account</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/login' as never)}>
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkTextBold}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a7ea4' },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20, paddingVertical: 32 },
  logoWrapper: { alignItems: 'center', marginBottom: 20 },
  logoCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    marginBottom: 10,
  },
  brand: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#64748b', textAlign: 'center', marginTop: 4, marginBottom: 20 },
  row: { flexDirection: 'row', gap: 10 },
  halfInput: { flex: 1 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: '#0f172a' },
  eyeBtn: { padding: 4 },
  button: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#0a7ea4',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#0a7ea4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  divider: { flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  dividerText: { marginHorizontal: 12, color: '#94a3b8', fontSize: 12 },
  linkButton: { marginTop: 8, alignItems: 'center', paddingVertical: 6 },
  linkText: { color: '#64748b', fontSize: 14 },
  linkTextBold: { color: '#0a7ea4', fontWeight: '700' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  error: { color: '#e74c3c', fontSize: 13, flex: 1 },
});
