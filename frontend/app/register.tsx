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

import Screen from '@/components/ui/Screen';
import { Palette, Radius, Shadow, Spacing, Typography } from '@/constants/theme';

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
    <Screen variant="light" style={styles.brandBg}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoWrapper}>
          <View style={styles.logoCircle}>
            <Ionicons name="shield-checkmark" size={48} color={Palette.brandOn} />
          </View>
          <Text style={styles.brand}>ToSafePlace</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join us and stay safe</Text>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={Palette.danger} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.row}>
            <View style={[styles.inputWrapper, styles.halfInput]}>
              <Ionicons name="person-outline" size={18} color={Palette.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="First Name"
                placeholderTextColor={Palette.textTertiary}
                value={firstName}
                onChangeText={setFirstName}
              />
            </View>
            <View style={[styles.inputWrapper, styles.halfInput]}>
              <Ionicons name="person-outline" size={18} color={Palette.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Last Name"
                placeholderTextColor={Palette.textTertiary}
                value={lastName}
                onChangeText={setLastName}
              />
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons name="mail-outline" size={20} color={Palette.textTertiary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={Palette.textTertiary}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color={Palette.textTertiary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Palette.textTertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={Palette.textTertiary}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons name="call-outline" size={20} color={Palette.textTertiary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Telephone"
              placeholderTextColor={Palette.textTertiary}
              value={telephone}
              onChangeText={setTelephone}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons name="location-outline" size={20} color={Palette.textTertiary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Address"
              placeholderTextColor={Palette.textTertiary}
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
              <ActivityIndicator color={Palette.brandOn} />
            ) : (
              <>
                <Text style={styles.buttonText}>Create Account</Text>
                <Ionicons name="arrow-forward" size={18} color={Palette.brandOn} />
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1 },
  brandBg: { backgroundColor: Palette.brand },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    paddingVertical: Spacing.xxl,
  },
  logoWrapper: { alignItems: 'center', marginBottom: Spacing.lg },
  logoCircle: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    marginBottom: Spacing.sm,
  },
  brand: {
    fontSize: 22, fontWeight: '800',
    color: Palette.brandOn,
    letterSpacing: 0.5,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Palette.card,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    ...Shadow.md,
  },
  title: {
    ...Typography.title,
    color: Palette.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.body,
    color: Palette.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  row: { flexDirection: 'row', gap: Spacing.sm },
  halfInput: { flex: 1 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Palette.borderSubtle,
    borderRadius: Radius.md,
    backgroundColor: Palette.bgSubtle,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  inputIcon: { marginRight: Spacing.sm },
  input: {
    flex: 1,
    paddingVertical: 12,
    ...Typography.body,
    color: Palette.textPrimary,
  },
  eyeBtn: { padding: Spacing.xs },
  button: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Palette.brand,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
    minHeight: 48,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    ...Typography.subheading,
    color: Palette.brandOn,
    letterSpacing: 0.3,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Palette.borderSubtle },
  dividerText: {
    marginHorizontal: Spacing.md,
    ...Typography.small,
    color: Palette.textTertiary,
  },
  linkButton: { marginTop: Spacing.sm, alignItems: 'center', paddingVertical: Spacing.xs },
  linkText: {
    ...Typography.body,
    color: Palette.textSecondary,
  },
  linkTextBold: {
    color: Palette.brand,
    fontWeight: '700',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Palette.dangerSoft,
    borderWidth: 1,
    borderColor: Palette.danger,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  error: {
    ...Typography.caption,
    color: Palette.danger,
    flex: 1,
  },
});
