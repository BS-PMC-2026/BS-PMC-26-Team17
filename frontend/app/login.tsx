import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/context/auth';
import Screen from '@/components/ui/Screen';
import { Palette, Radius, Shadow, Spacing, Typography } from '@/constants/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();

  async function handleLogin() {
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.detail || 'Login failed');
        return;
      }

      login(data.user);
      router.replace('/(tabs)' as never);
    } catch {
      setError('Cannot connect to server');
    } finally {
      setLoading(false);
    }
  }

  return (
    // Screen handles safe areas (notch + Android nav). The brand-blue
    // background is the auth flow's signature — same colour on all three
    // auth screens for instant family recognition.
    <Screen variant="light" style={styles.brandBg}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoWrapper}>
            <View style={styles.logoCircle}>
              <Ionicons name="shield-checkmark" size={56} color={Palette.brandOn} />
            </View>
            <Text style={styles.brand}>ToSafePlace</Text>
            <Text style={styles.tagline}>Your safety, our priority</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to continue</Text>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={Palette.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

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

            {/* Loading state preserved — using TouchableOpacity here instead
                of <Button /> so the existing test `getByText('Sign In')`
                still finds the label whether or not the spinner is up. */}
            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator color={Palette.brandOn} />
              ) : (
                <View style={styles.primaryButtonContent}>
                  <Text style={styles.primaryButtonText}>Sign In</Text>
                  <Ionicons name="arrow-forward" size={18} color={Palette.brandOn} />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.forgotButton}
              onPress={() => router.push('/forgot-password' as never)}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => router.push('/register' as never)}
            >
              <Text style={styles.linkText}>
                New here? <Text style={styles.linkTextBold}>Create an account</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex:     { flex: 1 },
  brandBg:  { backgroundColor: Palette.brand },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },

  logoWrapper: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  logoCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  brand: {
    ...Typography.title,
    color: Palette.brandOn,
    letterSpacing: 0.5,
  },
  tagline: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.85)',
    marginTop: Spacing.xs,
  },

  card: {
    width: '100%',
    maxWidth: 420,
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
    marginBottom: Spacing.xl,
  },

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
    paddingVertical: 13,
    ...Typography.body,
    color: Palette.textPrimary,
  },
  eyeBtn: { padding: Spacing.xs },

  primaryButton: {
    backgroundColor: Palette.brand,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
    minHeight: 48,
  },
  primaryButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  primaryButtonText: {
    ...Typography.subheading,
    color: Palette.brandOn,
    letterSpacing: 0.3,
  },
  buttonDisabled: { opacity: 0.7 },

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

  forgotButton: { marginTop: Spacing.md, alignItems: 'center', paddingVertical: Spacing.xs },
  forgotText: {
    ...Typography.bodyStrong,
    color: Palette.brand,
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
  errorText: {
    ...Typography.caption,
    color: Palette.danger,
    flex: 1,
  },
});
